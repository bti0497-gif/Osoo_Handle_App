import { useEffect, useRef } from 'react';
import { ROADWORK_ACTION_EVIDENCE_SCRIPT, parseRoadworkActionEvidence } from './roadworkActionEvidence';

export function useRoadworkActionEvidence(webviewRef, generation, recordDiagnostic) {
  const evidenceRef = useRef([]);
  useEffect(() => {
    const webview = webviewRef.current;
    evidenceRef.current = [];
    if (!webview) return undefined;
    let busy = false;
    let disposed = false;
    const inspect = async () => {
      if (busy || disposed) return;
      busy = true;
      try { await webview.executeJavaScript(ROADWORK_ACTION_EVIDENCE_SCRIPT); }
      catch { /* Navigation and not-yet-ready pages are expected. */ }
      finally { busy = false; }
    };
    const onConsole = (event) => {
      if (disposed) return;
      const evidence = parseRoadworkActionEvidence(event.message);
      if (!evidence) return;
      const previous = evidenceRef.current.at(-1);
      if (previous?.kind === evidence.kind && Date.parse(evidence.at) - Date.parse(previous.at) < 1500) return;
      evidenceRef.current = [...evidenceRef.current.slice(-9), evidence];
      recordDiagnostic('portal-action-observed', {
        ...evidence,
        diagnosticRevision: 1,
        interpretation: 'Passive UI evidence, not proof of server-side save or session termination. Missing evidence does not rule out a user action.',
      });
    };
    webview.addEventListener('console-message', onConsole);
    webview.addEventListener('dom-ready', inspect);
    void inspect();
    const interval = window.setInterval(inspect, 2000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      webview.removeEventListener('console-message', onConsole);
      webview.removeEventListener('dom-ready', inspect);
    };
  }, [webviewRef, generation, recordDiagnostic]);
  return evidenceRef;
}
