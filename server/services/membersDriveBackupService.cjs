'use strict';

const {
  drive,
  isDriveConfigured,
  getDriveRootFolderId,
  findFileInFolder,
  findFolderPath,
  getOrCreateFolderPath,
  uploadBufferToFolder,
} = require('./driveService.cjs');

const MEMBER_BACKUP_FILE_NAMES = [
  'members.json',
  'Wastewater_Member.json',
  'wastewater_members.json',
  '회원목록.json',
];

const MEMBER_BACKUP_FOLDERS = [
  [],
  ['.system', 'json'],
  ['.system', 'json', 'members'],
  ['시스템', '회원'],
];

function normalizeMember(row = {}) {
  return {
    id: String(row.id || row.member_id || row.name || '').trim(),
    name: String(row.name || row.member_name || '').trim(),
    password: String(row.password || row.pass || row.pwd || ''),
    role: String(row.role || 'user').trim() || 'user',
    site_name1: String(row.site_name1 || row.siteName || row.site_name || '').trim(),
    phone: String(row.phone || '').trim(),
    target_lat: row.target_lat ?? row.targetLat ?? null,
    target_lng: row.target_lng ?? row.targetLng ?? null,
    radius_m: row.radius_m ?? row.radiusM ?? null,
    notes: String(row.notes || '').trim(),
  };
}

function normalizeMembersPayload(payload) {
  if (Array.isArray(payload)) return payload.map(normalizeMember).filter((row) => row.name);
  if (Array.isArray(payload?.members)) return payload.members.map(normalizeMember).filter((row) => row.name);
  if (Array.isArray(payload?.data)) return payload.data.map(normalizeMember).filter((row) => row.name);
  if (payload?.member && typeof payload.member === 'object') return [normalizeMember(payload.member)].filter((row) => row.name);
  if (payload && typeof payload === 'object') {
    return Object.entries(payload)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([key, value]) => normalizeMember({ name: key, ...value }))
      .filter((row) => row.name);
  }
  return [];
}

async function readDriveJsonFile(fileId) {
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  const raw = Buffer.from(response.data).toString('utf8');
  return JSON.parse(raw);
}

async function findMemberBackupFile(fileName) {
  const rootFolderId = getDriveRootFolderId();
  if (!rootFolderId || !drive) return null;

  for (const segments of MEMBER_BACKUP_FOLDERS) {
    const folder = segments.length
      ? await findFolderPath(rootFolderId, segments)
      : { id: rootFolderId };
    if (!folder?.id) continue;
    const file = await findFileInFolder(folder.id, fileName);
    if (file?.id) return file;
  }
  return null;
}

async function getMembersFromDriveBackup() {
  if (!isDriveConfigured()) return [];

  for (const fileName of MEMBER_BACKUP_FILE_NAMES) {
    const file = await findMemberBackupFile(fileName);
    if (!file?.id) continue;
    const payload = await readDriveJsonFile(file.id);
    const members = normalizeMembersPayload(payload);
    if (members.length > 0) return members;
  }
  return [];
}

async function getMemberFromDrivePersonFile(name) {
  if (!isDriveConfigured()) return null;
  const normalizedName = String(name || '').trim();
  if (!normalizedName) return null;

  const rootFolderId = getDriveRootFolderId();
  const folders = [
    ['.system', 'json', 'person'],
    ['.system', 'json', 'members'],
    ['시스템', '회원'],
    [],
  ];

  for (const segments of folders) {
    const folder = segments.length
      ? await findFolderPath(rootFolderId, segments)
      : { id: rootFolderId };
    if (!folder?.id) continue;
    const file = await findFileInFolder(folder.id, `${normalizedName}.json`);
    if (!file?.id) continue;
    const payload = await readDriveJsonFile(file.id);
    const members = normalizeMembersPayload(payload);
    return members[0] || normalizeMember({ name: normalizedName, ...payload });
  }
  return null;
}

async function findMemberInDriveBackup(name, password) {
  const normalizedName = String(name || '').trim();
  const normalizedPassword = String(password || '');
  if (!normalizedName || !normalizedPassword) return null;

  const members = await getMembersFromDriveBackup();
  const matched = members.find((row) => (
    String(row.name || '').trim() === normalizedName
    && String(row.password || '') === normalizedPassword
  ));
  if (matched) return matched;

  const person = await getMemberFromDrivePersonFile(normalizedName);
  if (person && String(person.password || '') === normalizedPassword) return person;
  return null;
}

async function syncMembersBackupToDrive(members = []) {
  if (!isDriveConfigured() || !Array.isArray(members) || members.length === 0) {
    return { success: false, skipped: true };
  }

  const rootFolderId = getDriveRootFolderId();
  const folder = await getOrCreateFolderPath(rootFolderId, ['.system', 'json']);
  const payload = {
    updated_at: new Date().toISOString(),
    members: members.map(normalizeMember),
  };
  const file = await uploadBufferToFolder({
    folderId: folder.id,
    fileName: 'members.json',
    buffer: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
    mimeType: 'application/json',
  });
  return { success: true, fileId: file.id || null };
}

module.exports = {
  getMembersFromDriveBackup,
  findMemberInDriveBackup,
  syncMembersBackupToDrive,
};
