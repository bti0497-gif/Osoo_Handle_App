// Passive, fixed-category evidence only: never read form values, URLs or raw messages.
export const ROADWORK_ACTION_PREFIX = '[osoo-roadwork-action]';

function installActionEvidence() {
  const prefix = '[osoo-roadwork-action]';
  const key = '__osooRoadworkActionEvidenceV1';
  const visit = (win, depth = 0) => {
    if (depth > 2) return;
    try {
      const doc = win.document;
      if (!doc[key]) {
        const state = { last: '', at: 0, feedback: '' };
        doc[key] = state;
        const emit = (kind, trusted = false) => {
          const now = Date.now();
          if (state.last === kind && now - state.at < 1500) return;
          state.last = kind;
          state.at = now;
          // Logging does not intercept clicks, submissions, network or portal functions.
          win.console.info(prefix + JSON.stringify({ kind, at: now, trusted }));
        };
        doc.addEventListener('click', (event) => {
          const el = event.target?.closest?.('button,a,input[type="button"],input[type="submit"],[role="button"]');
          if (!el) return;
          const label = String(el.getAttribute('aria-label') || el.getAttribute('title')
            || el.textContent || '').trim().slice(0, 80);
          // Use fixed control metadata only, not input.value (including submit values).
          const marker = label + ' ' + String(el.id || '').slice(0, 80);
          if (/로그\s*아웃|log\s*out|sign\s*out/i.test(marker)) emit('logout-intent', event.isTrusted === true);
          else if (/^(?:저장|등록|수정\s*저장|일지\s*저장)$/.test(label)
            || /(?:^|_)(?:btn)?save(?:$|_)/i.test(el.id || '')) emit('save-intent', event.isTrusted === true);
        }, true);
        const scanFeedback = () => {
          const nodes = Array.from(doc.querySelectorAll('[role="alert"],[role="alertdialog"],[role="dialog"]')).slice(0, 10);
          const kinds = new Set();
          for (const node of nodes) {
            if (!node.getClientRects().length) continue;
            const text = String(node.textContent || '').slice(0, 300);
            if (/세션.{0,12}(?:만료|종료)|로그인.{0,12}(?:만료|다시)/.test(text)) kinds.add('session-expiry-message');
            else if (/(?:저장|등록).{0,16}(?:실패|오류)|(?:실패|오류).{0,16}(?:저장|등록)/.test(text)) kinds.add('save-error-message');
            else if (/(?:저장|등록)(?:이|가)?\s*(?:정상적으로\s*)?(?:완료되었습니다|되었습니다|성공)/.test(text)) kinds.add('save-success-message');
          }
          const signature = [...kinds].sort().join(',');
          if (signature !== state.feedback) {
            state.feedback = signature;
            kinds.forEach(kind => emit(kind));
          }
        };
        state.scanFeedback = scanFeedback;
      }
      doc[key].scanFeedback();
      Array.from(win.frames).slice(0, 12).forEach(frame => visit(frame, depth + 1));
    } catch { /* Cross-origin frames are intentionally not inspected. */ }
  };
  visit(window);
}

export const ROADWORK_ACTION_EVIDENCE_SCRIPT = `(${installActionEvidence.toString()})()`;

export function parseRoadworkActionEvidence(message, now = Date.now()) {
  if (typeof message !== 'string' || !message.startsWith(ROADWORK_ACTION_PREFIX) || message.length > 256) return null;
  try {
    const data = JSON.parse(message.slice(ROADWORK_ACTION_PREFIX.length));
    if (!['logout-intent', 'save-intent', 'save-success-message', 'save-error-message', 'session-expiry-message'].includes(data.kind)) return null;
    if (!Number.isFinite(data.at) || Math.abs(now - data.at) > 30000) return null;
    return { kind: data.kind, at: new Date(data.at).toISOString(), trusted: data.trusted === true };
  } catch { return null; }
}
