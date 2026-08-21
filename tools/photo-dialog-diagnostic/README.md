# Osoo Photo Dialog Diagnostic

죽암휴게소에서만 나타나는 사진 선택 복귀 실패를 본앱과 분리해 확인하는 휴대용 진단 도구입니다.

- 본앱 서버는 `18731~18734`의 `/api/ping`만 읽기 방식으로 확인합니다.
- 본앱 API, 로컬 DB, 사진 폴더에는 쓰지 않습니다.
- 기준 사진을 한 번 선택하면 같은 바이트를 현재 본앱 구조와 클릭 전파 차단 비교 구조에 자동 주입해 이벤트와 해시를 비교합니다.
- 실제 Windows/Chromium 파일 선택창 비교를 위해 각 시험 행에서 같은 사진을 다시 선택할 수 있습니다.
- 결과는 바탕 화면의 `더죤환경/Osoo-Photo-Dialog-Diagnostic-*` 폴더에 저장됩니다.

## 로컬 빌드

```powershell
npx vite build --config tools/photo-dialog-diagnostic/vite.config.js
npx electron-builder --projectDir tools/photo-dialog-diagnostic --config electron-builder.config.cjs --win portable --x64
```
