import { useEffect, useRef } from 'react';
import { AuthModel } from '../auth/AuthModel';

const INPUT_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

const describeElement = (element) => {
  if (!(element instanceof Element)) return { tag: null };
  return {
    tag: element.tagName?.toLowerCase() || null,
    type: element.getAttribute('type') || null,
    id: String(element.id || '').slice(0, 80) || null,
    name: String(element.getAttribute('name') || '').slice(0, 80) || null,
    className: String(element.className || '').slice(0, 160) || null,
    disabled: 'disabled' in element ? Boolean(element.disabled) : null,
    readOnly: 'readOnly' in element ? Boolean(element.readOnly) : null,
    contentEditable: element.getAttribute('contenteditable') || null,
    connected: element.isConnected,
  };
};

const getDomSnapshot = (sourceTarget) => ({
  documentHasFocus: document.hasFocus(),
  visibilityState: document.visibilityState,
  activeElement: describeElement(document.activeElement),
  eventTarget: describeElement(sourceTarget),
  modalCount: document.querySelectorAll('[role="dialog"], [role="alertdialog"], .unified-record-modal').length,
  focusedInputCount: document.querySelectorAll(`:is(${INPUT_SELECTOR}):focus`).length,
});

export function FocusDiagnostics() {
  const sequenceRef = useRef(0);
  const recoveryPendingRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    const record = async (event, target, details = {}) => {
      if (disposed) return;
      const sequence = sequenceRef.current + 1;
      sequenceRef.current = sequence;
      let nativeState = null;
      try {
        nativeState = await window.electronAPI?.getWindowFocusState?.();
      } catch {
        nativeState = { available: false, error: 'focus-state-unavailable' };
      }
      if (disposed) return;
      void AuthModel.recordLoginUiDiagnostic(`focus-${event}`, {
        sequence,
        ...getDomSnapshot(target),
        nativeState,
        ...details,
      });
    };

    const handlePointerDown = (event) => {
      const input = event.target instanceof Element ? event.target.closest(INPUT_SELECTOR) : null;
      if (!input) return;
      if (!document.hasFocus() && !recoveryPendingRef.current) {
        void record('input-focus-anomaly', input, { button: event.button });
        recoveryPendingRef.current = true;
        void (async () => {
          let recoveryResult = { recovered: false, reason: 'api-unavailable' };
          try {
            recoveryResult = await window.electronAPI?.recoverWindowFocus?.() || recoveryResult;
            await new Promise((resolve) => window.requestAnimationFrame(resolve));
            if (input.isConnected && !input.disabled && !input.readOnly) {
              input.focus({ preventScroll: true });
            }
          } catch (error) {
            recoveryResult = {
              recovered: false,
              reason: String(error?.message || error || 'focus-recovery-failed').slice(0, 160),
            };
          } finally {
            recoveryPendingRef.current = false;
            if (!recoveryResult.recovered || !document.hasFocus()) {
              void record('native-focus-recovery-failed', input, { recoveryResult });
            }
          }
        })();
      }
    };
    const handleAppDiagnostic = (event) => {
      const detail = event.detail && typeof event.detail === 'object' ? event.detail : {};
      void record(String(detail.event || 'app-state').slice(0, 60), document.activeElement, {
        appState: detail.details && typeof detail.details === 'object' ? detail.details : {},
      });
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('osoo:focus-diagnostic', handleAppDiagnostic);

    return () => {
      disposed = true;
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('osoo:focus-diagnostic', handleAppDiagnostic);
    };
  }, []);

  return null;
}
