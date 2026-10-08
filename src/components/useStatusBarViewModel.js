import { useEffect, useState } from 'react';
import { StatusBarModel } from './StatusBarModel';

export function useStatusBarViewModel() {
    const [system, setSystem] = useState({ server: 'checking', memory: null, sustainedLow: false });
    useEffect(() => {
        let stopped = false;
        let timer;
        let lowSince = null;
        const poll = async () => {
            try {
                const response = await StatusBarModel.getSystemStatus();
                const memory = response?.memory;
                if (!response?.success || !Number.isFinite(memory?.freePercent)
                    || !Number.isFinite(memory?.freeBytes) || memory.totalBytes <= 0) {
                    throw new Error('Invalid system status');
                }
                const now = Date.now();
                lowSince = memory.freePercent < 5 ? (lowSince ?? now) : null;
                if (!stopped) setSystem({ server: 'ready', memory, sustainedLow: lowSince !== null && now - lowSince >= 300000 });
            } catch {
                lowSince = null;
                if (!stopped) setSystem({ server: 'unavailable', memory: null, sustainedLow: false });
            } finally {
                if (!stopped) timer = setTimeout(poll, 30000);
            }
        };
        poll();
        return () => { stopped = true; clearTimeout(timer); };
    }, []);
    const percent = system.memory?.freePercent;
    const level = percent == null ? 'unknown' : percent < 5 ? 'low' : percent < 10 ? 'warning' : 'normal';
    return { ...system, level };
}
