const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { boardUploadsSegments } = require('./drivePathService.cjs');

const KEY_FILE = path.join(__dirname, '../config/google-key.json');
const WORKSPACE_ROOT = path.join(__dirname, '../..');
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

function findOAuthClientSecretFile() {
  try {
    const files = fs.readdirSync(WORKSPACE_ROOT);
    const match = files.find((name) => /^client_secret_.*\.json$/i.test(String(name || '').trim()));
    return match ? path.join(WORKSPACE_ROOT, match) : '';
  } catch (_) {
    return '';
  }
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
  if (!drive) throw new Error('Google Drive ?몄쬆 ?뺣낫媛 ?ㅼ젙?섏? ?딆븯?듬땲??');
  const normalizedParentId = String(parentFolderId || '').trim();
  const normalizedName = String(folderName || '').trim();
  if (!normalizedParentId) throw new Error('Google Drive parent folder ID媛 鍮꾩뼱 ?덉뒿?덈떎.');
  if (!normalizedName) throw new Error('Google Drive folder name??鍮꾩뼱 ?덉뒿?덈떎.');

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
  let currentFolder = { id: rootFolderId, name: '', webViewLink: '' };

  for (const segment of segments) {
    currentFolder = await getOrCreateFolder(currentFolder.id, segment);
  }

  return currentFolder;
}

async function uploadBufferToFolder({ folderId, fileName, buffer, mimeType }) {
  if (!drive) throw new Error('Google Drive ?몄쬆 ?뺣낫媛 ?ㅼ젙?섏? ?딆븯?듬땲??');
  if (!folderId) throw new Error('Google Drive folder ID媛 ?꾩슂?⑸땲??');
  if (!fileName) throw new Error('Google Drive file name???꾩슂?⑸땲??');

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
  findFileInFolder,
  getOrCreateFolderPath,
  uploadBufferToFolder,
  getOrCreateBoardUploadsFolder
};
