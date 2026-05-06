/* global module */
/**
 * @type {import('electron-builder').Configuration}
 */
module.exports = {
  appId: 'com.osoo.handle-app',
  productName: 'Osoo Handle App',
  npmRebuild: true,
  nodeGypRebuild: false,
  beforePack: './scripts/patch-nsis-install-section.cjs',
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: [
    'dist/**/*',
    'public/**/*',
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
  asarUnpack: [
    'server.cjs',
    'public/**/*',
    'server/**/*',
    'node_modules/**/*',
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
    // electron-builder.config.cjs 와 동기화. 설치 속도 우선(용량은 증가할 수 있음).
    compression: 'store',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    /** 사용자 안내 문구 — `electron/installer.nsh` */
    include: 'electron/installer.nsh',
    installerIcon: 'public/icon.ico',
    uninstallerIcon: 'public/icon.ico',
    installerHeaderIcon: 'public/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Osoo Handle App',
  },
  publish: {
    provider: 'github',
    owner: 'bti0497-gif',
    repo: 'Osoo_Handle_App',
    releaseType: 'release',
  },
};
