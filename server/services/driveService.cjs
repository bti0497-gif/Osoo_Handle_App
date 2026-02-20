const { google } = require('googleapis');
require('dotenv').config({ path: '.env.local' });

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

const drive = google.drive({ version: 'v3', auth: oauth2Client });

async function getOrCreateBoardUploadsFolder() {
  const parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const folderName = 'Board_Uploads';

  try {
    const res = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and '${parentFolderId}' in parents and trashed=false`,
      fields: 'files(id, name)',
      spaces: 'drive',
    });
    if (res.data.files.length > 0) return res.data.files[0].id;

    const folder = await drive.files.create({
      resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentFolderId] },
      fields: 'id'
    });
    return folder.data.id;
  } catch (error) {
    console.error('Error getting/creating Board_Uploads folder:', error);
    throw error;
  }
}

module.exports = { drive, getOrCreateBoardUploadsFolder };
