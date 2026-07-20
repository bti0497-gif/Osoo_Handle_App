import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BoardModel } from './BoardModel';

const ADMIN_ROLES = new Set(['admin', 'group_admin', 'super_admin', 'central_admin']);
const stripHtml = (value) => String(value || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .trim();

export function BoardPopupNotice({ currentUser, activeTab, onOpenBoard }) {
  const [posts, setPosts] = useState([]);
  const [sessionHidden, setSessionHidden] = useState([]);
  const [neverShowAgain, setNeverShowAgain] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const loadedKeyRef = useRef('');
  const userKey = `${currentUser?.id || currentUser?.name || 'unknown'}::${currentUser?.site_id || currentUser?.site_name1 || 'site'}`;

  useEffect(() => {
    if (activeTab !== 'dashboard' || ADMIN_ROLES.has(String(currentUser?.role || ''))) return;
    if (loadedKeyRef.current === userKey) return;
    let cancelled = false;
    let retryTimer = null;
    const load = (attempt = 0) => {
      BoardModel.fetchPosts(currentUser)
        .then((items) => {
          if (cancelled) return;
          loadedKeyRef.current = userKey;
          setPosts((items || []).filter((post) => post.is_popup === true || post.is_popup === 1)
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)));
        })
        .catch((error) => {
          if (cancelled) return;
          console.warn(`[Board Popup] 공지 조회 실패 (${attempt + 1}/3):`, error);
          if (attempt < 2) retryTimer = window.setTimeout(() => load(attempt + 1), 3000);
        });
    };
    load();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [activeTab, currentUser, userKey]);

  useEffect(() => {
    if (activeTab !== 'dashboard') return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, [activeTab]);

  const currentPost = useMemo(() => posts.find((post) => {
    const id = String(post.id);
    if (sessionHidden.includes(id)) return false;
    const expiresAt = new Date(post.popup_expires_at || 0).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
    return localStorage.getItem(`osoo.board-popup.dismissed.${userKey}.${id}`) !== '1';
  }) || null, [posts, sessionHidden, userKey, now]);

  if (!currentPost || activeTab !== 'dashboard') return null;
  const close = () => {
    const id = String(currentPost.id);
    if (neverShowAgain) localStorage.setItem(`osoo.board-popup.dismissed.${userKey}.${id}`, '1');
    setSessionHidden((items) => [...items, id]);
    setNeverShowAgain(false);
  };

  return <aside role="alertdialog" aria-live="assertive" aria-label="중앙 공지" style={{
    position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 4000,
    width: 'min(520px, calc(100vw - 32px))', background: '#fff', border: '1px solid #bfdbfe',
    borderTop: '6px solid #2563eb', borderRadius: 16, boxShadow: '0 24px 70px rgba(15,23,42,.32)', padding: 22,
  }}>
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span className="material-icons" style={{ color: '#2563eb' }}>campaign</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#2563eb', fontSize: 12, fontWeight: 900, marginBottom: 5 }}>중앙 공지</div>
        <h3 style={{ margin: 0, color: '#172033', fontSize: 16, lineHeight: 1.4 }}>{currentPost.title}</h3>
        {stripHtml(currentPost.content) && <p style={{ margin: '10px 0 0', color: '#475569', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-line', maxHeight: 100, overflow: 'hidden' }}>{stripHtml(currentPost.content)}</p>}
      </div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 16 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={neverShowAgain} onChange={(event) => setNeverShowAgain(event.target.checked)} /> 다시 보지 않기
      </label>
      <div style={{ display: 'flex', gap: 7 }}>
        <button type="button" onClick={() => { close(); onOpenBoard?.(); }} style={{ border: '1px solid #cbd5e1', background: '#fff', color: '#334155', borderRadius: 7, padding: '7px 11px', fontWeight: 800, cursor: 'pointer' }}>게시판 보기</button>
        <button type="button" onClick={close} style={{ border: 0, background: '#2563eb', color: '#fff', borderRadius: 7, padding: '7px 14px', fontWeight: 800, cursor: 'pointer' }}>확인</button>
      </div>
    </div>
  </aside>;
}
