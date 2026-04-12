/* global module */
/**
 * @type {import('electron-builder').Configuration}
 */
module.exports = {
  appId: 'com.osoo.handle-app',
  productName: 'Osoo Handle App',
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: [
    'dist/**/*',
    'server/**/*',
    'server.cjs',
    'start.cjs',
    'electron/**/*',
    'scripts/**/*',
    'templates/**/*',
    'node_modules/**/*',
    'package.json',
    '.env.local',
  ],
  extraResources: [
    { from: 'templates', to: 'templates' },
    { from: 'scripts', to: 'scripts' },
  ],
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
    ],
    icon: 'public/icon.ico',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'public/icon.ico',
    uninstallerIcon: 'public/icon.ico',
    installerHeaderIcon: 'public/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Osoo Handle App',
  },
  publish: {
    provider: 'github',
    owner: '',
    repo: '',
    releaseType: 'release',
  },
};
