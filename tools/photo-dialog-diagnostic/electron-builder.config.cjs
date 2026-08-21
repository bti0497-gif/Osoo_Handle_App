const path = require('path');

module.exports = {
  appId: 'com.osoo.photo-dialog-diagnostic',
  productName: 'Osoo Photo Dialog Diagnostic',
  artifactName: 'Osoo.Photo.Dialog.Diagnostic.${version}.${ext}',
  npmRebuild: false,
  nodeGypRebuild: false,
  asar: true,
  compression: 'normal',
  electronVersion: '40.10.6',
  directories: {
    output: path.join(__dirname, 'release-comparison'),
    buildResources: path.join(__dirname, '..', '..', 'public'),
  },
  files: [
    'dist/**/*',
    'electron/**/*',
    'package.json',
    '!release/**/*',
    '!release-portable/**/*',
    '!release-final/**/*',
    '!release-comparison/**/*',
  ],
  win: {
    target: [{ target: 'portable', arch: ['x64'] }],
    icon: path.join(__dirname, '..', '..', 'public', 'icon.ico'),
    executableName: 'OsooPhotoDialogDiagnostic',
    requestedExecutionLevel: 'asInvoker',
  },
  portable: {
    artifactName: 'Osoo.Photo.Dialog.Diagnostic.${version}.${ext}',
  },
};
