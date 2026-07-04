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

module.exports = {
  setActiveUser,
  clearActiveUser,
  getActiveUser,
  isAdminUser,
  isAdminSessionActive,
};
