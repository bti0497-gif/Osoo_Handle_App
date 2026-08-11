import React, { useEffect, useState } from 'react';
import SplashLoadingView from './SplashLoadingView';

const RECOVERY_LABELS = {
  'renderer-clean-boot': '앱 화면을 안전하게 다시 준비하고 있습니다...',
  'renderer-reloading': '업무 화면을 다시 열고 있습니다...',
  'renderer-recovery-failed': '앱 화면 복구를 확인하고 있습니다. 잠시만 기다려 주세요...',
  'external-recovery-handoff': '안전 복구를 위해 앱을 다시 시작하고 있습니다...',
};

const isEmergencyPhase = (phase) => Object.prototype.hasOwnProperty.call(RECOVERY_LABELS, phase);

export default function StartupRecoveryWidget() {
  const [state, setState] = useState({ phase: 'idle' });

  useEffect(() => {
    let disposed = false;
    const api = window.electronAPI;
    void api?.getStartupRecoveryState?.().then((next) => {
      if (!disposed && next?.phase) setState(next);
    }).catch(() => {});
    const unsubscribe = api?.onStartupRecoveryProgress?.((next) => {
      if (!disposed && next?.phase) setState(next);
    });
    const readyFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        void api?.reportRendererReady?.().catch(() => {});
      });
    });
    return () => {
      disposed = true;
      window.cancelAnimationFrame(readyFrame);
      unsubscribe?.();
    };
  }, []);

  if (!isEmergencyPhase(state.phase)) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10040 }} aria-live="polite">
      <SplashLoadingView percent={0} label={RECOVERY_LABELS[state.phase]} showProgress={false} />
    </div>
  );
}
