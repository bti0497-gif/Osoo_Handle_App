import React, { useMemo, useState } from 'react';
import { usePopupNoticeWatcher } from './usePopupNoticeWatcher';

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
  const [sessionHidden, setSessionHidden] = useState([]);
  const [hideForToday, setHideForToday] = useState(false);
  const {
    posts,
    forcedNoticeId,
    clearForcedNotice,
    now,
    isDismissed,
    dismissFor24Hours,
  } = usePopupNoticeWatcher(currentUser);

  const currentPost = useMemo(() => posts.find((post) => {
    const id = String(post.id);
    if (sessionHidden.includes(id)) return false;
    return !isDismissed(id, now);
  }) || null, [posts, sessionHidden, now, isDismissed]);

  const forcedPost = forcedNoticeId
    ? posts.find((post) => String(post.id) === forcedNoticeId) || null
    : null;
  const visiblePost = forcedPost || currentPost;
  if (!visiblePost || (activeTab !== 'dashboard' && !forcedPost)) return null;
  const close = () => {
    const id = String(visiblePost.id);
    if (hideForToday) dismissFor24Hours(id);
    setSessionHidden((items) => [...items, id]);
    clearForcedNotice();
    setHideForToday(false);
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
        <h3 style={{ margin: 0, color: '#172033', fontSize: 16, lineHeight: 1.4 }}>{visiblePost.title}</h3>
        {stripHtml(visiblePost.content) && <p style={{ margin: '10px 0 0', color: '#475569', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-line', maxHeight: 100, overflow: 'hidden' }}>{stripHtml(visiblePost.content)}</p>}
      </div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 16 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 12, cursor: 'pointer' }}>
        <input type="checkbox" checked={hideForToday} onChange={(event) => setHideForToday(event.target.checked)} /> 오늘 하루 보지 않기
      </label>
      <div style={{ display: 'flex', gap: 7 }}>
        <button type="button" onClick={() => { close(); onOpenBoard?.(); }} style={{ border: '1px solid #cbd5e1', background: '#fff', color: '#334155', borderRadius: 7, padding: '7px 11px', fontWeight: 800, cursor: 'pointer' }}>게시판 보기</button>
        <button type="button" onClick={close} style={{ border: 0, background: '#2563eb', color: '#fff', borderRadius: 7, padding: '7px 14px', fontWeight: 800, cursor: 'pointer' }}>확인</button>
      </div>
    </div>
  </aside>;
}
