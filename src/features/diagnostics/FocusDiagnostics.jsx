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
  const recoveryActiveRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    const timers = new Set();

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

    const scheduleSnapshot = (event, target, delayMs) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        void record(event, target, { delayMs });
      }, delayMs);
      timers.add(timer);
    };

    const handlePointerDown = (event) => {
      const input = event.target instanceof Element ? event.target.closest(INPUT_SELECTOR) : null;
      if (!input) return;
      if (!document.hasFocus() && !recoveryPendingRef.current) {
        recoveryActiveRef.current = true;
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
            void record('native-focus-recovery', input, { recoveryResult });
          }
        })();
        scheduleSnapshot('input-focus-recovery-settled', input, 80);
        scheduleSnapshot('input-focus-recovery-settled', input, 300);
      }
    };
    const handleFocusIn = (event) => {
      if (!recoveryActiveRef.current) return;
      if (!(event.target instanceof Element) || !event.target.matches(INPUT_SELECTOR)) return;
      void record('input-focus-recovered', event.target);
    };
    const handleInput = (event) => {
      if (!recoveryActiveRef.current) return;
      if (!(event.target instanceof Element) || !event.target.matches(INPUT_SELECTOR)) return;
      recoveryActiveRef.current = false;
      void record('recovery-input-accepted', event.target, {
        valueLength: 'value' in event.target ? String(event.target.value || '').length : null,
      });
    };
    const handleWindowFocus = () => {
      if (recoveryActiveRef.current) void record('dom-window-focus', document.activeElement);
    };
    const handleWindowBlur = () => {
      if (recoveryActiveRef.current) void record('dom-window-blur', document.activeElement);
    };
    const handleVisibility = () => {
      if (recoveryActiveRef.current) void record('visibility-change', document.activeElement);
    };
    const handleAppDiagnostic = (event) => {
      const detail = event.detail && typeof event.detail === 'object' ? event.detail : {};
      void record(String(detail.event || 'app-state').slice(0, 60), document.activeElement, {
        appState: detail.details && typeof detail.details === 'object' ? detail.details : {},
      });
    };
    const unsubscribeNative = window.electronAPI?.onNativeFocusEvent?.((info) => {
      void record('native-event', document.activeElement, { nativeEvent: info });
    });

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('input', handleInput, true);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('osoo:focus-diagnostic', handleAppDiagnostic);
    void record('diagnostics-mounted', document.activeElement);

    return () => {
      disposed = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('input', handleInput, true);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('osoo:focus-diagnostic', handleAppDiagnostic);
      if (typeof unsubscribeNative === 'function') unsubscribeNative();
    };
  }, []);

  return null;
}
