import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardModel } from './BoardModel';
import { updateBoardNewBadge } from './boardNewBadge';

const ADMIN_ROLES = new Set(['admin', 'group_admin', 'super_admin', 'central_admin']);
const DAY_MS = 24 * 60 * 60 * 1000;

const isPopupActive = (post, now) => {
  if (!(post?.is_popup === true || post?.is_popup === 1)) return false;
  const expiresAt = new Date(post.popup_expires_at || 0).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
};

export function usePopupNoticeWatcher(currentUser) {
  const [posts, setPosts] = useState([]);
  const [forcedNoticeId, setForcedNoticeId] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const knownPopupIdsRef = useRef(null);
  const userKey = useMemo(
    () => `${currentUser?.id || currentUser?.name || 'unknown'}::${currentUser?.site_id || currentUser?.site_name1 || 'site'}`,
    [currentUser]
  );
  const enabled = Boolean(currentUser) && !ADMIN_ROLES.has(String(currentUser?.role || ''));

  const dismissalKey = useCallback(
    (noticeId) => `osoo.board-popup.dismissed.${userKey}.${noticeId}`,
    [userKey]
  );
  const isDismissed = useCallback((noticeId, at = Date.now()) => {
    const raw = localStorage.getItem(dismissalKey(noticeId));
    if (!raw) return false;
    const until = Number(raw);
    if (Number.isFinite(until) && until > at) return true;
    localStorage.removeItem(dismissalKey(noticeId));
    return false;
  }, [dismissalKey]);
  const dismissFor24Hours = useCallback((noticeId) => {
    localStorage.setItem(dismissalKey(noticeId), String(Date.now() + DAY_MS));
  }, [dismissalKey]);

  useEffect(() => {
    if (!enabled) {
      setPosts([]);
      knownPopupIdsRef.current = null;
      return undefined;
    }

    // Popup observation is cache-only. The 30-minute idle scheduler owns the
    // remote board request and emits this event after refreshing the cache.
    const refreshFromLocalCache = () => {
      const items = BoardModel.getCachedPosts(currentUser);
      if (!items) return;
      const checkedAt = Date.now();
      const activePosts = items
        .filter((post) => isPopupActive(post, checkedAt))
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      updateBoardNewBadge(userKey, items, checkedAt);
      const activeIds = new Set(activePosts.map((post) => String(post.id)));

      if (knownPopupIdsRef.current) {
        for (const post of activePosts) {
          const id = String(post.id);
          if (knownPopupIdsRef.current.has(id) || isDismissed(id, checkedAt)) continue;
          window.electronAPI?.showPopupNotification?.({
            id,
            title: '\u{1F6A8} [\uC911\uC694 \uAE34\uAE09 \uACF5\uC9C0]',
            body: '\uC0C8 \uC911\uC694 \uBA54\uC2DC\uC9C0\uAC00 \uB4F1\uB85D\uB418\uC5C8\uC2B5\uB2C8\uB2E4.',
          }).catch((error) => console.warn('[Board Popup] 알림 표시 실패:', error));
        }
      }

      knownPopupIdsRef.current = activeIds;
      setPosts(activePosts);
      setNow(checkedAt);
    };

    refreshFromLocalCache();
    window.addEventListener('osoo:board-cache-updated', refreshFromLocalCache);
    return () => window.removeEventListener('osoo:board-cache-updated', refreshFromLocalCache);
  }, [enabled, currentUser, userKey, isDismissed]);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, [enabled]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onOpenPopupModal?.(({ noticeId }) => {
      const id = String(noticeId || '');
      if (!id || isDismissed(id)) return;
      setForcedNoticeId(id);
      setNow(Date.now());
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [userKey, isDismissed]);

  return {
    posts,
    forcedNoticeId,
    clearForcedNotice: () => setForcedNoticeId(''),
    now,
    userKey,
    isDismissed,
    dismissFor24Hours,
  };
}
