'use strict';

/**
 * 시나리오 실행 컨텍스트.
 * - 토큰/사이트 헤더를 붙이는 API 클라이언트
 * - 단계(step) 기록기: pass/fail, 소요 시간, errorCode, 재현 메시지
 * - 로그에 남기면 안 되는 값의 redaction
 */

const REDACTION_KEYS = /password|token|secret|credential|authorization/i;

function redactValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 0 ? '***redacted***' : value;
  return '***redacted***';
}

/** 중첩 객체에서 민감 키를 redaction 한다(결과 JSON에 password/token 원문이 남지 않도록). */
function redactSensitive(input, parentKey = '') {
  if (Array.isArray(input)) return input.map((item) => redactSensitive(item));
  if (input && typeof input === 'object') {
    const output = {};
    for (const [key, value] of Object.entries(input)) {
      output[key] = REDACTION_KEYS.test(key) ? redactValue(value) : redactSensitive(value, key);
    }
    return output;
  }
  return input;
}

function createScenarioContext({ baseUrl, token, siteId, fixtures }) {
  const steps = [];
  const httpLog = [];

  async function request(method, path, { query = {}, body = null, headers = {}, siteHeader = true } = {}) {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const requestHeaders = {
      'x-osoo-server-token': token,
      ...(siteHeader && siteId ? { 'x-osoo-site-id': siteId } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    };
    const startedAt = Date.now();
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30 * 1000),
      });
    } catch (error) {
      httpLog.push({ at: new Date().toISOString(), method, path: url.pathname, status: 0, durationMs: Date.now() - startedAt, error: String(error.message).slice(0, 120) });
      throw error;
    }
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* 비 JSON 응답 허용 */ }
    // 에이전트 인계용 증거: 요청/응답 요약(민감값은 redactSensitive로 마스킹).
    httpLog.push({
      at: new Date().toISOString(),
      method,
      path: url.pathname + (url.search || ''),
      status: response.status,
      durationMs: Date.now() - startedAt,
      ...(body ? { reqBody: JSON.stringify(redactSensitive(body)).slice(0, 200) } : {}),
      ...(json ? { resBody: JSON.stringify(redactSensitive(json)).slice(0, 240) } : { resText: text.slice(0, 120) }),
    });
    return { status: response.status, ok: response.ok, json, text };
  }

  function recordStep({ name, status, durationMs, errorCode = null, message = null, details = null }) {
    steps.push({
      name,
      status,
      at: new Date().toISOString(),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(message ? { message: String(message).slice(0, 500) } : {}),
      ...(details ? { details: redactSensitive(details) } : {}),
    });
    const mark = status === 'passed' ? 'PASS' : 'FAIL';
    console.log(`    [${mark}] ${name}${durationMs !== undefined ? ` (${durationMs}ms)` : ''}`);
  }

  /** 하나의 업무 단계를 실행하고 결과를 기록한다. */
  async function step(name, fn) {
    const startedAt = Date.now();
    const httpStart = httpLog.length;
    try {
      const details = await fn();
      recordStep({ name, status: 'passed', durationMs: Date.now() - startedAt, details, http: httpLog.slice(httpStart) });
      return true;
    } catch (error) {
      recordStep({
        name,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        errorCode: error.code || error.errorCode || 'STEP_FAILED',
        message: error.message,
        details: error.details || null,
        http: httpLog.slice(httpStart),
      });
      return false;
    }
  }

  /** 시나리오 내 단언. 실패 시 errorCode와 함께 step 이 실패로 기록된다. */
  function assert(condition, message, errorCode = 'ASSERT_FAILED', details = null) {
    if (!condition) {
      const error = new Error(message);
      error.errorCode = errorCode;
      if (details) error.details = redactSensitive(details);
      throw error;
    }
  }

  return {
    request,
    step,
    assert,
    steps,
    fixtures,
    get passedCount() { return steps.filter((item) => item.status === 'passed').length; },
    get failedCount() { return steps.filter((item) => item.status === 'failed').length; },
    get status() { return steps.some((item) => item.status === 'failed') ? 'failed' : 'passed'; },
  };
}

module.exports = { createScenarioContext, redactSensitive };
