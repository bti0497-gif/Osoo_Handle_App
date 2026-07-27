import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BoardModel } from './BoardModel';
import { updateBoardNewBadge } from './boardNewBadge';

const ADMIN_ROLES = new Set(['admin', 'group_admin', 'super_admin', 'central_admin']);
const POLL_INTERVAL_MS = 3 * 60 * 1000;
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

    let cancelled = false;
    let retryTimer = null;
    const poll = async (attempt = 0) => {
      try {
        const items = await BoardModel.fetchPosts(currentUser);
        if (cancelled) return;
        const checkedAt = Date.now();
        const activePosts = (items || [])
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
              title: '\u{1F6A8} [중앙 긴급 공지]',
              body: '새 중요 메시지가 등록되었습니다',
            }).catch((error) => console.warn('[Board Popup] 트레이 알림 실패:', error));
          }
        }

        knownPopupIdsRef.current = activeIds;
        setPosts(activePosts);
        setNow(checkedAt);
      } catch (error) {
        if (cancelled) return;
        console.warn(`[Board Popup] 공지 조회 실패 (${attempt + 1}/3):`, error);
        if (attempt < 2) {
          retryTimer = window.setTimeout(() => poll(attempt + 1), 3000);
        }
      }
    };

    poll();
    const interval = window.setInterval(() => poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      window.clearInterval(interval);
    };
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
