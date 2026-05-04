/**
 * Temporary CommonJS wrapper for electron-builder execution in a type:module package.
 * Keep this in sync with electron-builder.config.js until the main config is migrated.
 */
module.exports = {
  appId: 'com.osoo.handle-app',
  productName: 'Osoo Handle App',
  npmRebuild: false,
  nodeGypRebuild: false,
  /** NSIS installSection.nsh 에서 SetDetailsPrint none 제거(상세 로그 표시). `scripts/patch-nsis-install-section.cjs` */
  beforePack: './scripts/patch-nsis-install-section.cjs',
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
  asarUnpack: [
    'server.cjs',
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
    compression: 'store',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
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