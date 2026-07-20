const ADMIN_ROLES = new Set(['admin', 'group_admin', 'super_admin', 'central_admin']);

let activeUser = null;

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function isAdminUser(user) {
  const role = normalizeRole(user?.role);
  const name = String(user?.name || '').trim().toLowerCase();
  return ADMIN_ROLES.has(role) || name === 'admin';
}

function setActiveUser(user = null, source = '') {
  if (!user) {
    activeUser = null;
    return activeUser;
  }

  activeUser = {
    id: user.id ?? null,
    name: String(user.name || '').trim(),
    role: normalizeRole(user.role || 'user'),
    siteName: user.site_name1 || user.site_name || '',
    source,
    updatedAt: new Date().toISOString(),
  };
  return activeUser;
}

function clearActiveUser(memberId = null) {
  if (!memberId || String(activeUser?.id || '') === String(memberId)) {
    activeUser = null;
  }
  return activeUser;
}

function getActiveUser() {
  return activeUser;
}

function isAdminSessionActive() {
  return isAdminUser(activeUser);
}

function requireActiveUser(req, res, next) {
  const user = getActiveUser();
  if (!user) {
    return res.status(401).json({ success: false, code: 'ACTIVE_SESSION_REQUIRED', message: '로그인 세션을 확인할 수 없습니다.' });
  }
  req.activeUser = user;
  return next();
}

function requireAdminSession(req, res, next) {
  const user = getActiveUser();
  if (!user) {
    return res.status(401).json({ success: false, code: 'ACTIVE_SESSION_REQUIRED', message: '로그인 세션을 확인할 수 없습니다.' });
  }
  if (!isAdminUser(user)) {
    return res.status(403).json({ success: false, code: 'ADMIN_SESSION_REQUIRED', message: '관리자 권한이 필요합니다.' });
  }
  req.activeUser = user;
  return next();
}

module.exports = {
  setActiveUser,
  clearActiveUser,
  getActiveUser,
  isAdminUser,
  isAdminSessionActive,
  requireActiveUser,
  requireAdminSession,
};
