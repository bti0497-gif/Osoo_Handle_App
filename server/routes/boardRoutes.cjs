'use strict';

/**
 * boardRoutes.cjs
 * ?????????????????????????????????????????????????????????????????????
 * 寃뚯떆??REST API (BigQuery 諛깆뿏??
 *
 * GET    /api/board/posts              寃뚯떆湲 紐⑸줉
 * POST   /api/board/posts              寃뚯떆湲 ?묒꽦
 * PUT    /api/board/posts/:id          寃뚯떆湲 ?섏젙
 * DELETE /api/board/posts/:id          寃뚯떆湲 ??젣 (?뚰봽??
 * GET    /api/board/posts/:id          寃뚯떆湲 ?④굔
 * GET    /api/board/posts/:id/comments ?볤? 紐⑸줉
 * POST   /api/board/posts/:id/comments ?볤? ?묒꽦
 * DELETE /api/board/comments/:id       ?볤? ??젣 (?뚰봽??
 *
 * ?붿껌 ?ㅻ뜑: x-user-role, x-user-site, x-user-name
 * (?꾨줎?몄뿏??apiClient媛 ?꾩옱 濡쒓렇???ъ슜???뺣낫瑜??ㅻ뜑???ы븿?쒕떎)
 */

const express = require('express');
const router  = express.Router();
const {
  getPosts, getPost, createPost, updatePost, deletePost,
  getComments, createComment, deleteComment
} = require('../services/boardBigQueryService.cjs');

// ?? ?붿껌?먯꽌 ?꾩옱 ?ъ슜??異붿텧 ??????????????????????????????????????
// ?곗꽑?쒖쐞: ?ㅻ뜑 > body._user > query params
function extractUser(req) {
  const u = req.body?._user || {};
  return {
    name: req.headers['x-user-name'] || u.name  || req.query._name || 'unknown',
    role: req.headers['x-user-role'] || u.role  || req.query._role || 'manager',
    site: req.headers['x-user-site'] || u.site  || req.query._site || ''
  };
}

// ?? ?ㅻ쪟 ?묐떟 ?ы띁 ????????????????????????????????????????????????
function handleError(res, err, context) {
  console.error(`[BoardRoutes] ${context}:`, err.message);
  res.status(500).json({ success: false, message: err.message });
}

module.exports = function () {

  // 1. 寃뚯떆湲 紐⑸줉
  router.get('/api/board/posts', async (req, res) => {
    const user = extractUser(req);
    try {
      const posts = await getPosts(user.role, user.site);
      res.json({ success: true, data: posts });
    } catch (err) { handleError(res, err, 'getPosts'); }
  });

  // 2. 寃뚯떆湲 ?④굔
  router.get('/api/board/posts/:id', async (req, res) => {
    try {
      const post = await getPost(req.params.id);
      if (!post) return res.status(404).json({ success: false, message: '寃뚯떆湲 ?놁쓬' });
      res.json({ success: true, data: post });
    } catch (err) { handleError(res, err, 'getPost'); }
  });

  // 3. 寃뚯떆湲 ?묒꽦
  router.post('/api/board/posts', async (req, res) => {
    const user = extractUser(req);
    const body = req.body || {};
    try {
      const post = await createPost({
        author:      user.name,
        author_role: user.role,
        author_site: user.role === 'admin' ? 'CENTRAL' : user.site,
        target_site: body.target_site  ?? '',   // '' = ?꾩껜, ?뱀젙 ?꾩옣紐?= ?寃?
        title:       body.title        || '',
        content:     body.content      || '',
        is_notice:   Boolean(body.is_notice),
        attachments: JSON.stringify(body.attachments || []),
        parent_id:   body.parent_id    || null
      });
      res.json({ success: true, data: post });
    } catch (err) { handleError(res, err, 'createPost'); }
  });

  // 4. 寃뚯떆湲 ?섏젙 (?묒꽦??or admin留??덉슜)
  router.put('/api/board/posts/:id', async (req, res) => {
    const user = extractUser(req);
    const body = req.body || {};
    try {
      // 沅뚰븳 ?뺤씤: ?먭? 議고쉶
      const existing = await getPost(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: '寃뚯떆湲 ?놁쓬' });
      if (user.role !== 'admin' && existing.author !== user.name) {
        return res.status(403).json({ success: false, message: '?섏젙 沅뚰븳 ?놁쓬' });
      }

      await updatePost(req.params.id, {
        title:       body.title,
        content:     body.content,
        is_notice:   body.is_notice,
        attachments: body.attachments != null ? JSON.stringify(body.attachments) : undefined,
        target_site: body.target_site
      });
      res.json({ success: true });
    } catch (err) { handleError(res, err, 'updatePost'); }
  });

  // 5. 寃뚯떆湲 ??젣
  router.delete('/api/board/posts/:id', async (req, res) => {
    const user = extractUser(req);
    try {
      const existing = await getPost(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: '寃뚯떆湲 ?놁쓬' });
      if (user.role !== 'admin' && existing.author !== user.name) {
        return res.status(403).json({ success: false, message: '??젣 沅뚰븳 ?놁쓬' });
      }
      await deletePost(req.params.id);
      res.json({ success: true });
    } catch (err) { handleError(res, err, 'deletePost'); }
  });

  // 6. ?볤? 紐⑸줉
  router.get('/api/board/posts/:id/comments', async (req, res) => {
    try {
      const comments = await getComments(req.params.id);
      res.json({ success: true, data: comments });
    } catch (err) { handleError(res, err, 'getComments'); }
  });

  // 7. ?볤? ?묒꽦
  router.post('/api/board/posts/:id/comments', async (req, res) => {
    const user = extractUser(req);
    const body = req.body || {};
    try {
      const comment = await createComment(req.params.id, {
        author:  user.name,
        content: body.content || ''
      });
      res.json({ success: true, data: comment });
    } catch (err) { handleError(res, err, 'createComment'); }
  });

  // 8. ?볤? ??젣
  router.delete('/api/board/comments/:id', async (req, res) => {
    const user = extractUser(req);
    try {
      await deleteComment(req.params.id);
      res.json({ success: true });
    } catch (err) { handleError(res, err, 'deleteComment'); }
  });

  return router;
};
