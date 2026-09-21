'use strict';

/**
 * boardRoutes.cjs
 * ─────────────────────────────────────────────────────────────────────
 * 게시판 REST API (BigQuery 백엔드)
 *
 * GET    /api/board/posts              게시글 목록
 * POST   /api/board/posts              게시글 작성
 * PUT    /api/board/posts/:id          게시글 수정
 * DELETE /api/board/posts/:id          게시글 삭제 (소프트)
 * GET    /api/board/posts/:id          게시글 단건
 * GET    /api/board/posts/:id/comments 댓글 목록
 * POST   /api/board/posts/:id/comments 댓글 작성
 * DELETE /api/board/comments/:id       댓글 삭제 (소프트)
 *
 *
 * 요청 헤더: x-user-role, x-user-site, x-user-name
 * (프론트엔드 apiClient가 현재 로그인 사용자 정보를 헤더에 포함한다)
 */

const express = require('express');
const router  = express.Router();
const {
  getPosts, getPost, createPost, updatePost, deletePost,
  getComments, getComment, createComment, deleteComment
} = require('../services/boardService.cjs');
const { sanitizeBoardHtml } = require('../services/boardHtmlSanitizer.cjs');
const { getActiveUser, requireActiveUser } = require('../services/activeUserSessionService.cjs');

const ADMIN_ROLES = new Set(['admin', 'group_admin', 'super_admin', 'central_admin']);

// ── 요청에서 현재 사용자 추출 ──────────────────────────────────────
// 우선순위: 헤더 > body._user > query params
function extractUser(req) {
  const active = req.activeUser || getActiveUser();
  return {
    name: active?.name || 'unknown',
    role: active?.role || 'manager',
    site: active?.siteName || ''
  };
}

function handleError(res, err, context) {
  console.error(`[BoardRoutes] ${context}:`, err.message);
  res.status(err.status || 500).json({ success: false, message: err.message });
}

function isAdmin(user) {
  return ADMIN_ROLES.has(String(user?.role || '').trim());
}

function isAdminRole(role) {
  return ADMIN_ROLES.has(String(role || '').trim());
}

function isSuperAdmin(user) {
  return String(user?.role || '').trim() === 'admin';
}

function canViewPost(user, post) {
  if (!post || post.is_deleted) return false;
  if (isAdmin(user)) return true;

  const userSite = String(user?.site || '').trim();
  const userName = String(user?.name || '').trim();
  const visibleSites = Array.isArray(post.visible_sites) ? post.visible_sites.map((v) => String(v).trim()) : null;
  if (visibleSites) {
    const authorRole = String(post.author_role || '').trim();
    return String(post.author || '').trim() === userName
      || (isAdminRole(authorRole) && (
        visibleSites.includes('ALL') || (userSite && visibleSites.includes(userSite))
      ));
  }

  const targetSite = String(post.target_site || '').trim();
  const authorRole = String(post.author_role || '').trim();
  return String(post.author || '').trim() === userName
    || (isAdminRole(authorRole) && (!targetSite || targetSite === userSite));
}

function normalizeAttachments(value) {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '[]';
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? JSON.stringify(parsed) : '[]';
    } catch (_) {
      return '[]';
    }
  }
  return '[]';
}

function popupExpiry(isPopup, requestedDays) {
  if (!isPopup) return null;
  const days = Math.min(7, Math.max(1, Number.parseInt(requestedDays, 10) || 1));
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * 댓글 1:1 비밀 소통(프라이빗 스레드) 필터링
 * - 중앙관리자: 모든 댓글 열람 가능
 * - 현장근무자:
 *   1) 자신이 작성한 최상위 댓글 + 그 하위 답글(관리자 답변 포함)
 *   2) 관리자가 작성한 최상위 댓글(공지성 댓글) 및 그 하위에 본인/관리자가 단 답글
 *   3) 타인 근로자가 작성한 댓글 스레드는 완전히 제외
 */
function filterCommentsForUser(comments, user) {
  if (!Array.isArray(comments) || comments.length === 0) return [];
  if (isAdmin(user)) return comments;

  const currentUserName = String(user?.name || '').trim();
  if (!currentUserName) return [];

  const commentMap = new Map();
  for (const c of comments) {
    commentMap.set(c.id, c);
  }

  function getRootComment(c) {
    let curr = c;
    const visited = new Set();
    while (curr.parent_id && commentMap.has(curr.parent_id) && !visited.has(curr.parent_id)) {
      visited.add(curr.id);
      curr = commentMap.get(curr.parent_id);
    }
    return curr;
  }

  return comments.filter((c) => {
    const root = getRootComment(c);
    const rootAuthor = String(root.author || '').trim();
    const commentAuthor = String(c.author || '').trim();

    // 1. 최상위 댓글이 본인인 경우 -> 전체 스레드 열람 가능 (본인 댓글 + 관리자 답변 등)
    if (rootAuthor === currentUserName) {
      return true;
    }

    // 2. 최상위 댓글이 관리자인 경우 (전체 공지성 댓글)
    const isRootAdmin = isAdminRole(root.author_role) || rootAuthor === '최고관리자' || rootAuthor.toLowerCase() === 'admin';
    if (isRootAdmin) {
      if (c.id === root.id) return true; // 관리자 최상위 댓글 자체
      const isCommentAdmin = isAdminRole(c.author_role) || commentAuthor === '최고관리자' || commentAuthor.toLowerCase() === 'admin';
      if (commentAuthor === currentUserName || isCommentAdmin) {
        return true;
      }
    }

    return false;
  });
}

module.exports = function () {

  // 이 세션은 로그인 성공 시 생성되며 출결 기록·BigQuery 동기화와 무관하다.
  router.use('/api/board', requireActiveUser);

  // 1. 게시글 목록
  router.get('/api/board/posts', async (req, res) => {
    const user = extractUser(req);
    try {
      const posts = await getPosts(user.role, user.site, user.name);
      res.json({ success: true, data: posts });
    } catch (err) { handleError(res, err, 'getPosts'); }
  });

  // 2. 게시글 단건
  router.get('/api/board/posts/:id', async (req, res) => {
    const user = extractUser(req);
    try {
      const post = await getPost(req.params.id, { incrementView: true });
      if (!post) return res.status(404).json({ success: false, message: '게시글 없음' });
      if (!canViewPost(user, post)) {
        return res.status(403).json({ success: false, message: '게시글 조회 권한 없음' });
      }
      res.json({ success: true, data: post });
    } catch (err) { handleError(res, err, 'getPost'); }
  });

  // 3. 게시글 작성
  router.post('/api/board/posts', async (req, res) => {
    const user = extractUser(req);
    const body = req.body || {};
    const adminUser = isAdmin(user);
    try {
      const post = await createPost({
        author:      user.name,
        author_role: user.role,
        author_site: adminUser ? 'CENTRAL' : user.site,
        target_site: adminUser ? (body.target_site ?? '') : '',
        title:       body.title        || '',
        content:     sanitizeBoardHtml(body.content),
        is_notice:   adminUser ? Boolean(body.is_notice) : false,
        is_popup:    adminUser ? Boolean(body.is_popup) : false,
        popup_expires_at: adminUser ? popupExpiry(Boolean(body.is_popup), body.popup_days) : null,
        attachments: normalizeAttachments(body.attachments),
        parent_id:   body.parent_id    || null
      });
      res.json({ success: true, data: post });
    } catch (err) { handleError(res, err, 'createPost'); }
  });

  // 4. 게시글 수정 (작성자 or admin만 허용)
  router.put('/api/board/posts/:id', async (req, res) => {
    const user = extractUser(req);
    const body = req.body || {};
    try {
      // 권한 확인: 원글 조회
      const existing = await getPost(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: '게시글 없음' });
      if (!canViewPost(user, existing)) {
        return res.status(403).json({ success: false, message: '게시글 조회 권한 없음' });
      }
      if (!isAdmin(user) && existing.author !== user.name) {
        return res.status(403).json({ success: false, message: '수정 권한 없음' });
      }

      await updatePost(req.params.id, {
        title:       body.title,
        content:     body.content === undefined ? undefined : sanitizeBoardHtml(body.content),
        is_notice:   isAdmin(user) ? body.is_notice : undefined,
        is_popup:    isAdmin(user) ? body.is_popup : undefined,
        popup_expires_at: isAdmin(user) && body.is_popup !== undefined
          ? popupExpiry(Boolean(body.is_popup), body.popup_days)
          : undefined,
        attachments: body.attachments != null ? normalizeAttachments(body.attachments) : undefined,
        target_site: isAdmin(user) ? body.target_site : undefined
      });
      res.json({ success: true });
    } catch (err) { handleError(res, err, 'updatePost'); }
  });

  // 5. 게시글 삭제
  router.delete('/api/board/posts/:id', async (req, res) => {
    const user = extractUser(req);
    try {
      const existing = await getPost(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: '게시글 없음' });
      if (!canViewPost(user, existing)) {
        return res.status(403).json({ success: false, message: '게시글 조회 권한 없음' });
      }
      if (!isSuperAdmin(user) && existing.author !== user.name) {
        return res.status(403).json({ success: false, message: '삭제 권한 없음' });
      }
      await deletePost(req.params.id);
      res.json({ success: true });
    } catch (err) { handleError(res, err, 'deletePost'); }
  });

  // 6. 댓글 목록
  router.get('/api/board/posts/:id/comments', async (req, res) => {
    const user = extractUser(req);
    try {
      const post = await getPost(req.params.id);
      if (!post) return res.status(404).json({ success: false, message: '게시글 없음' });
      if (!canViewPost(user, post)) {
        return res.status(403).json({ success: false, message: '댓글 조회 권한 없음' });
      }
      const comments = await getComments(req.params.id);
      const filteredComments = filterCommentsForUser(comments, user);
      res.json({ success: true, data: filteredComments });
    } catch (err) { handleError(res, err, 'getComments'); }
  });

  // 7. 댓글 작성
  router.post('/api/board/posts/:id/comments', async (req, res) => {
    const user = extractUser(req);
    const body = req.body || {};
    try {
      const post = await getPost(req.params.id);
      if (!post) return res.status(404).json({ success: false, message: '게시글 없음' });
      if (!canViewPost(user, post)) {
        return res.status(403).json({ success: false, message: '댓글 작성 권한 없음' });
      }
      const comment = await createComment(req.params.id, {
        author:      user.name,
        author_role: user.role,
        author_site: user.site,
        content:     body.content || '',
        parent_id:   body.parent_id || null
      });
      res.json({ success: true, data: comment });
    } catch (err) { handleError(res, err, 'createComment'); }
  });

  // 8. 댓글 삭제
  router.delete('/api/board/comments/:id', async (req, res) => {
    const user = extractUser(req);
    try {
      const comment = await getComment(req.params.id);
      if (!comment) return res.status(404).json({ success: false, message: '댓글 없음' });
      const post = await getPost(comment.post_id);
      if (!post) return res.status(404).json({ success: false, message: '게시글 없음' });
      if (!canViewPost(user, post)) {
        return res.status(403).json({ success: false, message: '댓글 삭제 권한 없음' });
      }
      await deleteComment(req.params.id, user);
      res.json({ success: true });
    } catch (err) { handleError(res, err, 'deleteComment'); }
  });

  return router;
};
