# 릴리스 및 자동 업데이트 가이드

## 버전 원칙

- 최초 현장 배포 기준: `1.0.2`
- 다음 자동 업데이트: `1.0.6`
- 버전은 `package.json`과 `package-lock.json`에 동일하게 반영

## 사전 검증

```powershell
npm run validate
npm run build
npm run electron:build
npm run validate:asar
npm run validate:native
```

설치파일에 `.env.local`, Google/Firebase/BigQuery 키와 OAuth JSON이 포함되지 않았는지 반드시 확인합니다.
`validate:native`가 실패하면 설치파일을 게시하지 않습니다. 이 검사는 패키지에 포함된 Electron으로
`better-sqlite3`를 직접 로드하고 메모리 DB 읽기/쓰기를 수행하여 Node ABI 불일치를 차단합니다.

## 신규 현장 설치 패키지

공통 자격증명을 포함한 단일 통합 설치파일:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-integrated-installer.ps1
```

생성 위치:

```text
release\integrated-deployment\Osoo Handle App Integrated Setup 1.0.6.exe
```

이 파일은 자격증명을 포함하므로 GitHub Release에 업로드하지 않고 직접 현장 배포에만 사용합니다.

비상용 다중 파일 패키지:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\prepare-deployment-package.ps1
```

생성된 `release/deployment-package/credentials`에 현장별 설정을 넣고 `install-with-provisioning.cmd`를 실행합니다. 필수 자격증명이 없으면 설치를 시작하지 않습니다.

## 자동 업데이트 파일

동일한 빌드에서 생성된 다음 세 파일이 필요합니다.

- `Osoo-Handle-App-Setup-{version}.exe`
- `Osoo-Handle-App-Setup-{version}.exe.blockmap`
- `latest.yml`

`latest.yml`의 파일명, 크기와 SHA-512가 실제 업로드 파일과 일치해야 합니다.

## GitHub CLI 배포

```powershell
gh auth status
gh release create 1.0.6 `
  "release/auto-update-v1.0.6/Osoo-Handle-App-Setup-1.0.6.exe" `
  "release/auto-update-v1.0.6/Osoo-Handle-App-Setup-1.0.6.exe.blockmap" `
  "release/auto-update-v1.0.6/latest.yml" `
  --repo bti0497-gif/Osoo_Handle_App `
  --title "Osoo Handle App 1.0.6" `
  --notes-file "release/auto-update-v1.0.6/release-notes.md"
```

현재 저장소의 기존 태그 규칙에 맞춰 버전 태그에 `v`를 붙이지 않습니다.

## 배포 후 확인

```powershell
gh release view 1.0.6 --repo bti0497-gif/Osoo_Handle_App
```

- 정식 공개 릴리스인지 확인
- 세 파일이 모두 첨부됐는지 확인
- 이전 버전 앱에서 업데이트 감지·다운로드·재시작 확인
- AppData의 현장 자격증명과 로컬 DB가 유지되는지 확인
