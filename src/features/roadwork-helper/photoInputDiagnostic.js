// Temporary photo-input tracing: no file contents, credentials or form values.
function inspectPhotoInput(index, phase) {
    const key = '__osooPhotoInputTrace';
    const windows = [];
    const visit = (target) => {
        if (!target || windows.includes(target)) return;
        windows.push(target);
        try {
            for (const frame of target.document.querySelectorAll('iframe, frame')) visit(frame.contentWindow);
        } catch { /* Cross-origin frames are not inspected. */ }
    };
    visit(window);
    let owner;
    let button;
    for (const candidate of windows) {
        try {
            const found = candidate.document.getElementById(`dragDrop${index}_anchor2`);
            if (found) { owner = candidate; button = found; break; }
        } catch { /* Continue through accessible frames. */ }
    }
    if (!owner) return { phase, index, found: false };
    const snapshot = () => {
        const rect = button.getBoundingClientRect();
        const style = owner.getComputedStyle(button);
        return {
            elapsedMs: Date.now() - (owner[key]?.startedAt || Date.now()),
            focused: owner.document.hasFocus(),
            visibility: owner.document.visibilityState,
            userActive: Boolean(owner.navigator.userActivation?.isActive),
            disabled: Boolean(button.disabled || button.getAttribute('aria-disabled') === 'true'),
            connected: button.isConnected,
            display: style.display, visibilityStyle: style.visibility,
            pointerEvents: style.pointerEvents,
            x: Math.round(rect.x), y: Math.round(rect.y),
            width: Math.round(rect.width), height: Math.round(rect.height),
            viewportHeight: owner.innerHeight,
            fileInputCount: owner.document.querySelectorAll('input[type="file"]').length,
        };
    };
    if (phase === 'before') {
        owner[key]?.cleanup?.();
        const trace = { startedAt: Date.now(), events: [] };
        owner[key] = trace;
        const handler = (event) => {
            if (event.target !== button && !button.contains(event.target)) return;
            if (trace.events.length < 8) trace.events.push({ type: event.type, trusted: event.isTrusted, ...snapshot() });
        };
        owner.document.addEventListener('click', handler, true);
        const timer = owner.setTimeout(() => trace.cleanup(), 30000);
        trace.cleanup = () => {
            owner.document.removeEventListener('click', handler, true);
            owner.clearTimeout(timer);
            if (owner[key] === trace) delete owner[key];
        };
    }
    const result = { phase, index, found: true, ...snapshot(), clicks: owner[key]?.events || [] };
    if (phase === 'after') owner[key]?.cleanup?.();
    return result;
}

export async function capturePhotoInputDiagnostic(webview, index, phase) {
    try {
        return await webview.executeJavaScript(`(${inspectPhotoInput.toString()})(${Number(index)},${JSON.stringify(phase)})`);
    } catch {
        return { phase, index, inspectionFailed: true };
    }
}
