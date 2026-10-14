// Only fixed boolean markers leave the page. Never return HTML, cookies or input values.
export async function inspectRoadworkResponse(response) {
  const evidence = { responseRedirected: response.redirected === true, bodyInspected: false,
    bodySampleBytes: 0, bodySampleLimited: false, loginFormMarker: false,
    loginRedirectMarker: false, sessionExpiryMarker: false, bodyInspectionError: false };
  const type = response.headers?.get('content-type') || '';
  if (!/html|javascript|text/i.test(type)) return evidence;
  let reader;
  let timer;
  try {
    reader = response.clone().body?.getReader();
    if (!reader) return evidence;
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 1500;
    while (evidence.bodySampleBytes < 32768) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) { evidence.bodySampleLimited = true; break; }
      const part = await Promise.race([reader.read(), new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), remaining);
      })]);
      clearTimeout(timer);
      if (!part) { evidence.bodySampleLimited = true; break; }
      if (part.done) break;
      const bounded = part.value.subarray(0, 32768 - evidence.bodySampleBytes);
      evidence.bodySampleBytes += bounded.byteLength;
      text += decoder.decode(bounded, { stream: true });
      if (bounded.byteLength < part.value.byteLength) evidence.bodySampleLimited = true;
    }
    evidence.bodyInspected = true;
    evidence.bodySampleLimited ||= evidence.bodySampleBytes >= 32768;
    evidence.loginFormMarker = /<input\b[^>]*type\s*=\s*["']?password/i.test(text);
    evidence.loginRedirectMarker = /(?:location|url)[\s\S]{0,100}\/security\/login\.do/i.test(text);
    evidence.sessionExpiryMarker = /session\s*(?:expired|timeout)|세션.{0,12}(?:만료|종료)|로그인.{0,12}(?:만료|다시)/i.test(text);
  } catch { evidence.bodyInspectionError = true; }
  finally { clearTimeout(timer); try { reader?.cancel().catch(() => {}); } catch { /* evidence only */ } }
  return evidence;
}

export const ROADWORK_PAGE_EVIDENCE_SCRIPT = `(() => ({
  loginPath: /\\/security\\/login\\.do/i.test(location.pathname),
  loginFormInputPresent: Boolean(document.querySelector('input[type="password"]')),
  dailyFormPresent: Boolean(document.getElementById('DalyOpDllgPros') || document.getElementById('regDate_input')),
  documentReadyState: document.readyState,
}))()`;
