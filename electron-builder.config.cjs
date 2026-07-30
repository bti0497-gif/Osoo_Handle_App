/**
 * Temporary CommonJS wrapper for electron-builder execution in a type:module package.
 * Keep this in sync with electron-builder.config.js until the main config is migrated.
 */
module.exports = {
  appId: 'com.osoo.handle-app.win7-x86',
  productName: 'Osoo Handle App Win7 x86',
  artifactName: 'Osoo.Handle.App.Win7.x86.Setup.${version}.${ext}',
  npmRebuild: false,
  nodeGypRebuild: false,
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
    'node_modules/**/*',
    'package.json',
    '!server/config/google-key.json',
    '!server/config/bigquery-service-account.json',
    '!server/config/work-jindan-*.json',
    '!server/config/firebase-service-account.json',
  ],
  asarUnpack: [
    'server.cjs',
    'public/**/*',
    'server/**/*',
    'node_modules/**/*',
  ],
  extraResources: [
    { from: 'scripts', to: 'scripts' },
    { from: 'templates/reports/월운영보고서.xlsx', to: 'templates/reports/월운영보고서.xlsx' },
    { from: 'templates/reports/수질분석일지.xlsx', to: 'defaults/report-templates/수질분석일지.xlsx' },
    { from: 'templates/reports/일일업무일지(A2O).hwp', to: 'defaults/report-templates/일일업무일지(A2O).hwp' },
    { from: 'templates/reports/일일업무일지(MBR).hwp', to: 'defaults/report-templates/일일업무일지(MBR).hwp' },
  ],
  win: {
    target: [
      { target: 'nsis', arch: ['ia32'] },
    ],
    icon: 'public/icon.ico',
    compression: 'store',
  },
  nsis: {
    oneClick: false,
    include: 'scripts/installer-process-guard.nsh',
    allowToChangeInstallationDirectory: true,
    installerIcon: 'public/icon.ico',
    uninstallerIcon: 'public/icon.ico',
    installerHeaderIcon: 'public/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Osoo Handle App Win7 x86',
  },
};
