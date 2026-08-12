const { google } = require('googleapis');
const fs = require('fs');
const { boardUploadsSegments } = require('./drivePathService.cjs');
const {
  findOAuthClientSecretPath,
  getGoogleServiceAccountPath,
  loadRuntimeEnv,
} = require('../config/runtimeConfig.cjs');

loadRuntimeEnv();
const KEY_FILE = getGoogleServiceAccountPath();
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

function findOAuthClientSecretFile() {
  return findOAuthClientSecretPath();
}

function loadOAuthClientConfig() {
  const envClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const envClientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const envRedirectUri = String(process.env.GOOGLE_REDIRECT_URI || '').trim();

  if (envClientId && envClientSecret) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret,
      redirectUri: envRedirectUri || 'http://localhost'
    };
  }

  const fallbackFile = findOAuthClientSecretFile();
  if (!fallbackFile || !fs.existsSync(fallbackFile)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(fallbackFile, 'utf8'));
    const installed = raw.installed || raw.web || {};
    const redirectUris = Array.isArray(installed.redirect_uris) ? installed.redirect_uris : [];
    const clientId = String(installed.client_id || '').trim();
    const clientSecret = String(installed.client_secret || '').trim();
    const redirectUri = String(envRedirectUri || redirectUris[0] || 'http://localhost').trim();
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret, redirectUri };
  } catch (_) {
    return null;
  }
}

function createDriveAuth() {
  const refreshToken = String(process.env.GOOGLE_REFRESH_TOKEN || '').trim();
  const oauthClient = loadOAuthClientConfig();
  if (oauthClient && refreshToken) {
    const oauth2 = new google.auth.OAuth2(
      oauthClient.clientId,
      oauthClient.clientSecret,
      oauthClient.redirectUri
    );
    oauth2.setCredentials({ refresh_token: refreshToken });
    return { auth: oauth2, mode: 'oauth' };
  }

  const serviceAccountReady = fs.existsSync(KEY_FILE);
  if (serviceAccountReady) {
    const saAuth = new google.auth.GoogleAuth({
      keyFile: KEY_FILE,
      scopes: OAUTH_SCOPES,
    });
    return { auth: saAuth, mode: 'service_account' };
  }

  return { auth: null, mode: 'none' };
}

const { auth, mode: driveAuthMode } = createDriveAuth();
const drive = auth ? google.drive({ version: 'v3', auth }) : null;

function escapeDriveQueryValue(value) {
  return String(value || '').replace(/'/g, "\\'");
}

function getDriveRootFolderId() {
  return String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
}

function isDriveConfigured() {
  return Boolean(
    drive &&
    getDriveRootFolderId()
  );
}

async function getOrCreateFolder(parentFolderId, folderName) {
  if (!drive) throw new Error('Google Drive 인증 정보가 설정되지 않았습니다.');
  const normalizedParentId = String(parentFolderId || '').trim();
  const normalizedName = String(folderName || '').trim();
  if (!normalizedParentId) throw new Error('Google Drive parent folder ID가 비어 있습니다.');
  if (!normalizedName) throw new Error('Google Drive folder name이 비어 있습니다.');

  const res = await drive.files.list({
    q: [
      "mimeType='application/vnd.google-apps.folder'",
      `name='${escapeDriveQueryValue(normalizedName)}'`,
      `'${normalizedParentId}' in parents`,
      'trashed=false'
    ].join(' and '),
    fields: 'files(id, name, webViewLink)',
    spaces: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    pageSize: 10
  });

  if ((res.data.files || []).length > 0) {
    return res.data.files[0];
  }

  const folder = await drive.files.create({
    resource: {
      name: normalizedName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [normalizedParentId]
    },
    fields: 'id, name, webViewLink',
    supportsAllDrives: true
  });

  return folder.data;
}

async function findFolderInFolder(parentFolderId, folderName) {
  if (!drive) return null;
  const normalizedParentId = String(parentFolderId || '').trim();
  const normalizedName = String(folderName || '').trim();
  if (!normalizedParentId || !normalizedName) return null;

  const response = await drive.files.list({
    q: [
      "mimeType='application/vnd.google-apps.folder'",
      `name='${escapeDriveQueryValue(normalizedName)}'`,
      `'${normalizedParentId}' in parents`,
      'trashed=false'
    ].join(' and '),
    fields: 'files(id, name, webViewLink)',
    spaces: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    pageSize: 10
  });

  return (response.data.files || [])[0] || null;
}

async function findFileInFolder(parentFolderId, fileName) {
  if (!drive) return null;
  const normalizedParentId = String(parentFolderId || '').trim();
  const normalizedName = String(fileName || '').trim();
  if (!normalizedParentId || !normalizedName) return null;

  const response = await drive.files.list({
    q: [
      `name='${escapeDriveQueryValue(normalizedName)}'`,
      `'${normalizedParentId}' in parents`,
      'trashed=false'
    ].join(' and '),
    fields: 'files(id, name, webViewLink, webContentLink)',
    spaces: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    pageSize: 10
  });

  return (response.data.files || [])[0] || null;
}

async function getOrCreateFolderPath(rootFolderId, segments = []) {
  // 관리사진 월 폴더는 여러 사진 작업이 동시에 시작될 수 있다. Drive는 같은
  // 이름의 폴더 생성을 막지 않으므로, 이 경로만 생성 후 중복을 정리한다.
  if (segments[0] === '관리사진' && segments.length === 3) {
    const management = await getOrCreateFolder(rootFolderId, segments[0]);
    const year = await getOrCreateFolder(management.id, segments[1]);
    return reconcileManagementMonthFolder(year.id, segments[2]);
  }
  let currentFolder = { id: rootFolderId, name: '', webViewLink: '' };

  for (const segment of segments) {
    currentFolder = await getOrCreateFolder(currentFolder.id, segment);
  }

  return currentFolder;
}

async function reconcileManagementMonthFolder(parentFolderId, monthName) {
  const listFolders = async () => (await drive.files.list({
    q: ["mimeType='application/vnd.google-apps.folder'", `name='${escapeDriveQueryValue(monthName)}'`, `'${parentFolderId}' in parents`, 'trashed=false'].join(' and '),
    fields: 'files(id,name,createdTime)', spaces: 'drive', includeItemsFromAllDrives: true, supportsAllDrives: true, pageSize: 100
  })).data.files || [];
  let folders = await listFolders();
  if (folders.length === 0) {
    await getOrCreateFolder(parentFolderId, monthName);
    folders = await listFolders();
  }
  const contents = await Promise.all(folders.map(async (folder) => ({
    folder,
    files: (await drive.files.list({ q: `'${folder.id}' in parents and trashed=false`, fields: 'files(id,name)', spaces: 'drive', includeItemsFromAllDrives: true, supportsAllDrives: true, pageSize: 100 })).data.files || []
  })));
  contents.sort((a, b) => b.files.length - a.files.length || String(a.folder.createdTime).localeCompare(String(b.folder.createdTime)));
  const canonical = contents[0];
  const names = new Set(canonical.files.map((file) => file.name));
  for (const duplicate of contents.slice(1)) {
    for (const file of duplicate.files) {
      if (names.has(file.name)) continue; // 동일 파일명은 원본을 보존하고 자동 덮어쓰지 않는다.
      await drive.files.update({ fileId: file.id, addParents: canonical.folder.id, removeParents: duplicate.folder.id, supportsAllDrives: true, fields: 'id' });
      names.add(file.name);
    }
    const remaining = (await drive.files.list({ q: `'${duplicate.folder.id}' in parents and trashed=false`, fields: 'files(id)', spaces: 'drive', includeItemsFromAllDrives: true, supportsAllDrives: true, pageSize: 1 })).data.files || [];
    if (remaining.length === 0) await drive.files.delete({ fileId: duplicate.folder.id, supportsAllDrives: true });
  }
  return canonical.folder;
}

async function findFolderPath(rootFolderId, segments = []) {
  let currentFolder = { id: rootFolderId, name: '', webViewLink: '' };
  for (const segment of segments) {
    currentFolder = await findFolderInFolder(currentFolder.id, segment);
    if (!currentFolder) return null;
  }
  return currentFolder;
}

async function uploadBufferToFolder({ folderId, fileName, buffer, mimeType }) {
  if (!drive) throw new Error('Google Drive 인증 정보가 설정되지 않았습니다.');
  if (!folderId) throw new Error('Google Drive folder ID가 필요합니다.');
  if (!fileName) throw new Error('Google Drive file name이 필요합니다.');

  const { Readable } = require('stream');
  const existingFile = await findFileInFolder(folderId, fileName);
  const mediaBody = Readable.from(buffer);
  const response = existingFile
    ? await drive.files.update({
        fileId: existingFile.id,
        media: { mimeType: mimeType || 'application/octet-stream', body: mediaBody },
        fields: 'id, name, webViewLink, webContentLink',
        supportsAllDrives: true
      })
    : await drive.files.create({
        resource: { name: fileName, parents: [folderId] },
        media: { mimeType: mimeType || 'application/octet-stream', body: mediaBody },
        fields: 'id, name, webViewLink, webContentLink',
        supportsAllDrives: true
      });

  return response.data;
}

async function getOrCreateBoardUploadsFolder() {
  const parentFolderId = getDriveRootFolderId();

  try {
    const folder = await getOrCreateFolderPath(parentFolderId, boardUploadsSegments());
    return folder.id;
  } catch (error) {
    console.error('Error getting/creating Board_Uploads folder:', error);
    throw error;
  }
}

module.exports = {
  drive,
  driveAuthMode,
  isDriveConfigured,
  getDriveRootFolderId,
  getOrCreateFolder,
  findFolderInFolder,
  findFileInFolder,
  getOrCreateFolderPath,
  findFolderPath,
  uploadBufferToFolder,
  getOrCreateBoardUploadsFolder
};
