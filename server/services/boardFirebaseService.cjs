'use strict';

/**
 * boardFirebaseService.cjs
 * ─────────────────────────────────────────────────────────────────────
 * 게시판(posts / comments) Firebase Firestore CRUD 서비스
 *
 * 가시성 규칙 (visible_sites 필드 활용):
 *   - 중앙관리자(admin):      모든 글 조회 가능
 *   - 현장관리자(manager):    visible_sites array-contains-any ['ALL', 내현장명]
 *
 * Firebase 정렬 특징 대응:
 *   - Firestore에서 여러 필드 필터 및 다중 필드 정렬을 수행할 때 복합 인덱스 요구 문제를 방지하기 위해,
 *     Firestore에서는 기본 조건(is_deleted, visible_sites)만으로 조회한 후
 *     서버 메모리(JS Array.sort) 상에서 정렬(is_notice DESC, created_at DESC)을 수행합니다.
 *     (저빈도 사내 게시판 용도이므로 메모리 및 속도 부하가 거의 없습니다)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');

const ADMIN_ROLES = new Set(['admin', 'group_admin', 'super_admin', 'central_admin']);

// ── 서비스 계정 키 파일 위치 ──────────────────────────────────────
const serviceAccountPath = path.join(__dirname, '..', 'config', 'firebase-service-account.json');

let db = null;
let initialized = false;

// ── SDK 초기화 (안전 예외 처리 포함) ──────────────────────────────────
try {
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    initialized = true;
    console.log('[FirebaseService] Firebase Admin SDK가 성공적으로 초기화되었습니다.');
  } else {
    console.warn('\n================================================================');
    console.warn('[WARNING] Firebase 서비스 계정 키 파일이 누락되었습니다.');
    console.warn(`위치: ${serviceAccountPath}`);
    console.warn('소통게시판 Firebase 백엔드가 정상 기동되지 않을 수 있습니다.');
    console.warn('================================================================\n');
  }
} catch (err) {
  console.error('[FirebaseService] SDK 초기화 중 치명적 오류 발생:', err.message);
}

function ensureInitialized() {
  if (!initialized || !db) {
    throw new Error('Firebase 서비스가 설정되지 않았습니다. server/config/firebase-service-account.json 키 파일을 확인해 주세요.');
  }
}

// ── UUID 생성 헬퍼 ───────────────────────────────────────────────
function newUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

// ── visible_sites 배열 계산 ───────────────────────────────────────
function calculateVisibleSites(data) {
  // target_site가 지정되어 있고 빈 문자열이 아닌 경우
  if (data.target_site && String(data.target_site).trim() !== '') {
    return [String(data.target_site).trim()];
  }
  
  // target_site가 전체인 경우
  if (ADMIN_ROLES.has(String(data.author_role || '').trim())) {
    return ['ALL']; // 중앙관리자 전체공지
  } else {
    return [data.author_site || 'UNKNOWN']; // 현장관리자 본인 글 (해당 현장만 노출)
  }
}

function isAdmin(user) {
  return ADMIN_ROLES.has(String(user?.role || '').trim());
}

// ─────────────────────────────────────────────────────────────────────
// Posts
// ─────────────────────────────────────────────────────────────────────

/**
 * 게시글 목록 조회
 */
async function getPosts(role, siteName, userName = '') {
  ensureInitialized();

  let query = db.collection('posts').where('is_deleted', '==', false);

  if (!ADMIN_ROLES.has(String(role || '').trim())) {
    // 현장관리자: 전체공지('ALL')이거나 내 현장 타겟인 글만 조회
    query = query.where('visible_sites', 'array-contains-any', ['ALL', siteName || '']);
  }

  const snapshot = await query.limit(500).get();
  const posts = [];
  snapshot.forEach(doc => {
    posts.push({ id: doc.id, ...doc.data() });
  });

  const visiblePosts = ADMIN_ROLES.has(String(role || '').trim())
    ? posts
    : posts.filter((post) => {
      const authorName = String(post.author || '').trim();
      const authorRole = String(post.author_role || '').trim();
      const targetSite = String(post.target_site || '').trim();
      return authorName === String(userName || '').trim()
        || (ADMIN_ROLES.has(authorRole) && (!targetSite || targetSite === String(siteName || '').trim()));
    });

  // JS 메모리상에서 정렬 (is_notice 내림차순, created_at 내림차순)
  visiblePosts.sort((a, b) => {
    // 1. 공지사항 우선 (is_notice가 true인 것이 위로)
    const aNotice = a.is_notice ? 1 : 0;
    const bNotice = b.is_notice ? 1 : 0;
    if (aNotice !== bNotice) {
      return bNotice - aNotice;
    }
    // 2. 최신글 우선
    const aTime = a.created_at || '';
    const bTime = b.created_at || '';
    return bTime.localeCompare(aTime);
  });

  return visiblePosts;
}

/**
 * 게시글 단건 조회
 */
async function getPost(id) {
  ensureInitialized();

  const doc = await db.collection('posts').doc(id).get();
  if (!doc.exists) return null;
  
  const data = doc.data();
  if (data.is_deleted) return null;

  return { id: doc.id, ...data };
}

/**
 * 게시글 작성
 */
async function createPost(data) {
  ensureInitialized();

  const now = new Date().toISOString();
  const id = newUUID();

  const visibleSites = calculateVisibleSites(data);

  const docData = {
    id,
    author:       data.author      || '',
    author_role:  data.author_role || 'manager',
    author_site:  data.author_site || '',
    target_site:  data.target_site || '',
    visible_sites: visibleSites,
    title:        data.title       || '',
    content:      data.content     || '',
    is_notice:    Boolean(data.is_notice),
    attachments:  data.attachments || '[]',
    parent_id:    data.parent_id   || null,
    is_deleted:   false,
    created_at:   now,
    updated_at:   now
  };

  await db.collection('posts').doc(id).set(docData);
  return docData;
}

/**
 * 게시글 수정
 */
async function updatePost(id, data) {
  ensureInitialized();

  const docRef = db.collection('posts').doc(id);
  const doc = await docRef.get();
  if (!doc.exists) throw new Error('게시글을 찾을 수 없습니다.');
  
  const existing = doc.data();
  const updateData = {
    updated_at: new Date().toISOString()
  };

  if (data.title !== undefined) updateData.title = data.title;
  if (data.content !== undefined) updateData.content = data.content;
  if (data.is_notice !== undefined) updateData.is_notice = Boolean(data.is_notice);
  if (data.attachments !== undefined) updateData.attachments = data.attachments;
  if (data.target_site !== undefined) {
    updateData.target_site = data.target_site;
    // target_site가 갱신되면 visible_sites 재계산
    updateData.visible_sites = calculateVisibleSites({
      author_role: existing.author_role,
      author_site: existing.author_site,
      target_site: data.target_site
    });
  }

  await docRef.update(updateData);
}

/**
 * 게시글 소프트 삭제
 */
async function deletePost(id) {
  ensureInitialized();

  await db.collection('posts').doc(id).update({
    is_deleted: true,
    updated_at: new Date().toISOString()
  });
}

// ─────────────────────────────────────────────────────────────────────
// Comments
// ─────────────────────────────────────────────────────────────────────

/**
 * 댓글 목록 조회
 */
async function getComments(postId) {
  ensureInitialized();

  const snapshot = await db.collection('comments')
    .where('post_id', '==', postId)
    .where('is_deleted', '==', false)
    .get();

  const comments = [];
  snapshot.forEach(doc => {
    comments.push({ id: doc.id, ...doc.data() });
  });

  // JS 메모리상에서 정렬 (created_at 오름차순)
  comments.sort((a, b) => {
    const aTime = a.created_at || '';
    const bTime = b.created_at || '';
    return aTime.localeCompare(bTime);
  });

  return comments;
}

/**
 * 댓글 생성
 */
async function createComment(postId, data) {
  ensureInitialized();

  const id = newUUID();
  const docData = {
    id,
    post_id:    postId,
    author:     data.author  || '',
    content:    data.content || '',
    parent_id:   data.parent_id || null,
    is_deleted: false,
    created_at: new Date().toISOString()
  };

  await db.collection('comments').doc(id).set(docData);
  return docData;
}

/**
 * 댓글 소프트 삭제
 */
async function deleteComment(id, user = {}) {
  ensureInitialized();

  const docRef = db.collection('comments').doc(id);
  const doc = await docRef.get();
  if (!doc.exists) throw new Error('댓글을 찾을 수 없습니다.');

  const comment = doc.data();
  if (!isAdmin(user) && String(comment.author || '') !== String(user.name || '')) {
    const err = new Error('댓글 삭제 권한 없음');
    err.status = 403;
    throw err;
  }

  await docRef.update({
    is_deleted: true
  });
}

module.exports = {
  getPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  getComments,
  createComment,
  deleteComment
};
