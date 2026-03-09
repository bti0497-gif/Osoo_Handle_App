const { google } = require('googleapis');
require('dotenv').config({ path: '.env.local' });

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

const drive = google.drive({ version: 'v3', auth: oauth2Client });

function escapeDriveQueryValue(value) {
  return String(value || '').replace(/'/g, "\\'");
}

function getDriveRootFolderId() {
  return String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
}

function isDriveConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN &&
    getDriveRootFolderId()
  );
}

async function getOrCreateFolder(parentFolderId, folderName) {
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

async function findFileInFolder(parentFolderId, fileName) {
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
  const folderName = 'Board_Uploads';

  try {
    const folder = await getOrCreateFolder(parentFolderId, folderName);
    return folder.id;
  } catch (error) {
    console.error('Error getting/creating Board_Uploads folder:', error);
    throw error;
  }
}

module.exports = {
  drive,
  isDriveConfigured,
  getDriveRootFolderId,
  getOrCreateFolder,
  findFileInFolder,
  getOrCreateFolderPath,
  uploadBufferToFolder,
  getOrCreateBoardUploadsFolder
};
