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
  const { timeout = 30000, raw = false, _hasRetried = false, ...fetchOptions } = options;

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
    const isJsonContentType = contentType && contentType.includes('application/json');
    if (!isJsonContentType) {
      const textSnippet = await response
        .text()
        .then((t) => t.slice(0, 400).replace(/\s+/g, ' ').trim())
        .catch(() => '');
      // JSON이 아닌 응답(404 HTML 등)이 오면 포트가 바뀌었을 가능성이 큼
      await rediscoverServer();
      if (!_hasRetried) {
        return request(endpoint, {
          ...options,
          _hasRetried: true,
        });
      }
      let hint =
        '서버 응답 형식이 올바르지 않습니다. 서버 재탐색을 시도했습니다. 잠시 후 다시 시도해 주세요.';
      if (textSnippet.includes('Cannot POST') || textSnippet.includes('cannot post')) {
        hint = `백엔드에 해당 API가 없습니다(Cannot POST). 코드 반영 후 npm run dev:all 등으로 서버를 재시작했는지 확인해 주세요. (${endpoint})`;
      } else if (textSnippet.includes('Cannot GET') || textSnippet.includes('cannot get')) {
        hint = `요청 경로를 서버가 찾지 못했습니다. 백엔드 재시작 또는 연결 URL을 확인해 주세요. (${endpoint})`;
      }
      throw new ApiError(hint, response.status);
    }

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(
        data.userMessage || data.message || data.error || `요청 실패 (${response.status})`,
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
      if (!_hasRetried) {
        return request(endpoint, {
          ...options,
          _hasRetried: true,
        });
      }
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

  async put(endpoint, body, options = {}) {
    return request(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...options,
    });
  },

  async delete(endpoint, options = {}) {
    return request(endpoint, { method: 'DELETE', ...options });
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
