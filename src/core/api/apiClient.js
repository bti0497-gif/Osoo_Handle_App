/**
 * 중앙 HTTP 클라이언트
 * 모든 로컬 API 호출은 이 모듈을 통해 수행합니다.
 * serverConfig의 동적 포트를 내부적으로 사용하며, 에러 핸들링을 통합합니다.
 */
import { getApiBase, rediscoverServer } from './serverConfig.js';

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

async function request(endpoint, options = {}) {
  const { timeout = 30000, raw = false, ...fetchOptions } = options;

  const url = `${getApiBase()}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (raw) return response;

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      if (!response.ok) {
        throw new ApiError(
          '서버 응답이 JSON이 아닙니다. 백엔드 서버가 실행 중인지 확인해 주세요.',
          response.status
        );
      }
      return response;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(
        data.message || `요청 실패 (${response.status})`,
        response.status,
        data
      );
    }

    return data;
  } catch (err) {
    clearTimeout(timer);

    if (err instanceof ApiError) throw err;

    if (err.name === 'AbortError') {
      throw new ApiError('요청 시간이 초과되었습니다.', 0);
    }

    if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
      await rediscoverServer();
      throw new ApiError('서버 연결에 실패했습니다. 재연결을 시도합니다.', 0);
    }

    throw err;
  }
}

export const apiClient = {
  async get(endpoint, params = {}) {
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const url = query ? `${endpoint}?${query}` : endpoint;
    return request(url);
  },

  async post(endpoint, body, options = {}) {
    const isFormData = body instanceof FormData;
    return request(endpoint, {
      method: 'POST',
      headers: isFormData ? undefined : { 'Content-Type': 'application/json' },
      body: isFormData ? body : JSON.stringify(body),
      ...options,
    });
  },

  async upload(endpoint, formData, options = {}) {
    return request(endpoint, {
      method: 'POST',
      body: formData,
      timeout: 300000,
      ...options,
    });
  },

  async getRaw(endpoint, params = {}) {
    const query = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const url = query ? `${endpoint}?${query}` : endpoint;
    return request(url, { raw: true });
  },

  getBaseUrl() {
    return getApiBase();
  },

  ApiError,
};
