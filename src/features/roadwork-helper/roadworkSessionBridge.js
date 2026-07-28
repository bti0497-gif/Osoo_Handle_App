const STORAGE_PREFIX = 'osoo:roadwork-session-url:';
const LOGIN_PATH_PATTERN = /\/security\/login\.do(?:[?#]|$)/i;

function storageKey(partition) {
  return `${STORAGE_PREFIX}${String(partition || 'persist:osoo-roadwork')}`;
}

export function rememberRoadworkSessionUrl(partition, url) {
  const normalizedUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(normalizedUrl) || LOGIN_PATH_PATTERN.test(normalizedUrl)) return;

  try {
    window.sessionStorage.setItem(storageKey(partition), normalizedUrl);
  } catch {
    // The current webview remains the source of truth when renderer storage is unavailable.
  }
}

export function getRememberedRoadworkSessionUrl(partition) {
  try {
    const value = window.sessionStorage.getItem(storageKey(partition)) || '';
    return /^https?:\/\//i.test(value) && !LOGIN_PATH_PATTERN.test(value) ? value : '';
  } catch {
    return '';
  }
}

