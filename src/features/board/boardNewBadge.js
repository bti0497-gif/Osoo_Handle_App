const DAY_MS = 24 * 60 * 60 * 1000;
const BADGE_EVENT = 'osoo:board-new-badge';

const badgeKey = (userKey) => `osoo.board.new-badge-until.${userKey}`;
const viewedKey = (userKey) => `osoo.board.last-viewed-at.${userKey}`;

export function isBoardPostNew(post, now = Date.now()) {
  const createdAt = new Date(post?.created_at || 0).getTime();
  return Number.isFinite(createdAt) && createdAt <= now && createdAt + DAY_MS > now;
}

export function hasBoardNewBadge(userKey, now = Date.now()) {
  const until = Number(localStorage.getItem(badgeKey(userKey)) || 0);
  if (Number.isFinite(until) && until > now) return true;
  localStorage.removeItem(badgeKey(userKey));
  return false;
}

export function updateBoardNewBadge(userKey, posts, now = Date.now()) {
  const lastViewedAt = Number(localStorage.getItem(viewedKey(userKey)) || 0);
  const newestUnviewedExpiry = (posts || []).reduce((latest, post) => {
    const createdAt = new Date(post?.created_at || 0).getTime();
    if (!isBoardPostNew(post, now) || createdAt <= lastViewedAt) {
      return latest;
    }
    return Math.max(latest, createdAt + DAY_MS);
  }, 0);

  if (newestUnviewedExpiry > now) {
    localStorage.setItem(badgeKey(userKey), String(newestUnviewedExpiry));
    window.dispatchEvent(new CustomEvent(BADGE_EVENT, { detail: { userKey, visible: true } }));
  }
}

export function clearBoardNewBadge(userKey) {
  localStorage.setItem(viewedKey(userKey), String(Date.now()));
  localStorage.removeItem(badgeKey(userKey));
  window.dispatchEvent(new CustomEvent(BADGE_EVENT, { detail: { userKey, visible: false } }));
}

export function subscribeBoardNewBadge(callback) {
  const listener = (event) => callback(event?.detail || {});
  window.addEventListener(BADGE_EVENT, listener);
  return () => window.removeEventListener(BADGE_EVENT, listener);
}
