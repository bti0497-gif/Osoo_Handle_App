import { useCallback, useEffect, useRef } from 'react';
import { AuthModel } from './AuthModel';

// Best-effort metadata only. Never delay login or retain input values.
export function useLoginInputDiagnostic() {
    const intervalId = useRef(null);
    const sequence = useRef(0);
    useEffect(() => () => { sequence.current += 1; }, []);
    const beginInterval = useCallback(() => {
        const current = ++sequence.current;
        intervalId.current = null;
        AuthModel.beginInputInterval().then((response) => {
            if (current === sequence.current) intervalId.current = response?.intervalId || null;
        }).catch(() => {});
    }, []);
    const takeIntervalId = useCallback(() => {
        const id = intervalId.current;
        intervalId.current = null;
        sequence.current += 1;
        return id;
    }, []);
    return { beginInterval, takeIntervalId };
}
