# 현장 앱 자동업데이트·통합 설치 패키징 실행서

> 목적: 다른 에이전트가 임의로 패키징 정책을 해석하거나 ABI/ASAR 문제를 우회하지 않고, 동일한 절차로 검증된 배포물을 만들게 한다.
> 적용 대상: Osoo Handle App 정식 릴리스와 현장 설치용 통합 설치파일
> 현재 주의사항: `1.1.47`은 장비이력카드 Excel 출력 기능과 `설비이력카드.xlsx`를 포함해야 한다. 검증 완료 전 게시하지 않는다.

## 1. 가장 중요한 결론

`설비이력카드.xlsx`는 장비이력카드 Excel 출력 기능의 실행 자원이다. 따라서 다음 두 패키지에 모두 있어야 한다.

1. GitHub에 게시하는 일반 자동업데이트 설치파일
2. 신규 PC/복구용 통합 설치파일

통합 설치파일에만 양식을 넣으면 기존 설치 현장은 자동업데이트 후 Excel 출력 기능을 사용할 수 없다. 양식은 자격증명이 아니므로 일반 패키지에서 제외할 이유가 없다.

다만 `templates/**/*` 전체를 자동업데이트판에 넣으면 현장별 수정 양식을 덮어쓸 위험이 있다. 올바른 정책은 다음과 같다.

- `설비이력카드.xlsx`처럼 앱 기능에 필수인 승인된 기본양식만 `extraResources`로 명시적으로 포함한다.
- 설치 위치는 `resources/defaults/report-templates/설비이력카드.xlsx`로 통일한다.
- 앱 시작 시 AppData에 같은 파일이 없을 때만 복사한다.
- 사용자가 이미 가진 AppData 양식은 덮어쓰지 않는다.
- `.env.local`, Google/Firebase/BigQuery 자격증명은 어떤 앱 패키지에도 넣지 않는다.

## 2. 패키지 종류와 책임

| 구분 | 용도 | 포함해야 하는 것 | 포함하면 안 되는 것 |
|---|---|---|---|
| 일반 자동업데이트판 | 기존 현장 업데이트, GitHub Release 게시 | 앱 코드, 정적 UI, 네이티브 모듈, Watchdog, 기능 필수 기본양식(설비이력카드 포함) | 자격증명, 현장 DB, 로그, 현장 사진, 현장별 수정 양식 |
| 통합 설치판 | 신규 PC 설치·복구 | 검증된 일반 앱 패키지의 모든 내용 + AppData 설정 프로비저닝 | 앱 본문/ASAR 안의 자격증명 |
| `win-unpacked` | 설치 전 패키지 실물 검증 | 실행 EXE, `resources/app.asar`, `app.asar.unpacked`, `app-update.yml`, 승인된 `extraResources` | 누락되거나 일부만 생성된 파일 |

통합 설치 스크립트가 기본양식을 별도로 독점해서는 안 된다. 공통 정적 자원은 `electron-builder.config.cjs`가 소유하고, 통합 설치 스크립트는 그 설정을 상속해야 한다.

## 3. 현재 1.1.47에서 먼저 바로잡을 계약

패키징을 다시 시작하기 전에 아래 네 항목을 코드와 검증기에 반영한다.

1. `electron-builder.config.cjs`의 `extraResources`에 다음과 같은 명시적 항목을 둔다.

   ```js
   {
     from: 'templates/reports/설비이력카드.xlsx',
     to: 'defaults/report-templates/설비이력카드.xlsx',
   }
   ```

2. `scripts/build-integrated-installer.ps1`에서 `1.1.47`일 때만 양식을 넣거나 다음 버전부터 제외하는 조건을 제거한다. 통합 설치판도 기본 builder 설정의 위 항목을 그대로 상속한다.
3. `docs/EQUIPMENT_CARD_EXCEL_EXPORT_PLAN.md`의 “통합 설치 패키지에만 포함” 문구를 제거하고 이 문서의 정책으로 정정한다.
4. `scripts/validate-release.cjs`의 기존 포괄 규칙을 세분화한다.
   - 자동업데이트판에 `templates/**/*` 전체를 넣지 않는 보호는 유지한다.
   - 승인된 필수 기본양식의 개별 `extraResources` 포함은 허용하고 필수로 검사한다.
   - 패키징 후 아래 파일의 실제 존재와 0바이트가 아님을 검사한다.

   ```text
   release/win-unpacked/resources/defaults/report-templates/설비이력카드.xlsx
   ```

검증기가 이 파일을 “일반 패키지에 있으면 안 되는 양식”으로 판정한다면 검증 계약이 오래된 것이다. 기능을 제거해서 검증에 맞추지 말고, 승인된 기본양식을 정확히 허용하도록 검증기를 고친다.

## 4. 권위 있는 파일

패키징 중 서로 다른 파일을 임의로 고치지 않는다.

- 실제 Electron 빌드 설정: `electron-builder.config.cjs`
- `electron-builder.config.js`: 위 CommonJS 설정을 가져오는 ESM 래퍼일 뿐이다.
- 빌드 명령 계약: `package.json`
- 통합 설치판: `scripts/build-integrated-installer.ps1`
- ASAR/소스 계약 검사: `scripts/validate-release.cjs`
- 네이티브 모듈 검사: `scripts/validate-packaged-native.cjs`
- 통합 설치판 검사: `scripts/validate-field-installer.cjs`
- 기본양식 AppData 보호: `server/services/reportTemplateService.cjs`

현재 `package.json`의 빌드가 `--config electron-builder.config.cjs`를 명시하므로 `.js` 파일만 고쳐서는 패키징 결과가 바뀌지 않는다.

## 5. ABI를 헷갈리지 않는 법

`better-sqlite3`는 네이티브 모듈이어서 실행 주체의 ABI와 일치해야 한다.

- 일반 `node`에서 검증할 때: 현재 Node ABI용 바이너리가 필요하다.
- 패키지 앱의 Electron에서 실행할 때: Electron 40.6.0 ABI용 바이너리가 필요하다.

그래서 정식 스크립트는 다음 순서를 사용한다.

1. `npx @electron/rebuild --force --arch=x64 --version=40.6.0`
2. Electron 패키징
3. 패키지 속 Electron으로 `better-sqlite3` smoke test
4. `npm rebuild better-sqlite3`로 작업 사본을 다시 Node ABI로 복구

### ABI 관련 금지사항

- `.node` 파일을 다른 폴더에서 수동 복사하지 않는다.
- ABI 오류를 앱 코드 오류로 오인해 DB 코드를 수정하지 않는다.
- `electron:build`가 중간에 끊긴 뒤 바로 일반 `npm run validate`를 반복하지 않는다.
- Electron용으로 재빌드된 작업 사본을 그대로 다음 개발 작업에 사용하지 않는다.

빌드 중단 뒤 로컬 검증이 ABI 오류를 내면 먼저 다음으로 복구한다.

```powershell
npm rebuild better-sqlite3
node tools/diagnostic-runner/validate-prepared.cjs
```

`validate-prepared.cjs`는 검증 환경을 준비한 뒤 `npm run validate`를 실행하므로, 반복되는 로컬 ABI 실패를 임시 우회 코드로 고치지 않는다.

## 6. ASAR와 `app.asar.unpacked`를 헷갈리지 않는 법

- `app.asar`: JavaScript, 렌더러 산출물 등 일반 앱 파일의 묶음이다.
- `app.asar.unpacked`: 네이티브 모듈과 서버처럼 실제 파일 경로가 필요한 항목이다.
- `extraResources`: ASAR 밖의 `resources` 아래에 배치하는 정적 실행 자원이다.

`설비이력카드.xlsx`는 `extraResources`이므로 `app.asar` 목록에서 찾는 것이 아니라 다음 위치에서 확인한다.

```text
release/win-unpacked/resources/defaults/report-templates/설비이력카드.xlsx
```

반대로 `better-sqlite3`는 다음 위치에서 검사한다.

```text
release/win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3
```

자격증명은 `app.asar`, `app.asar.unpacked`, `extraResources` 어디에도 있으면 안 된다.

## 7. 정식 패키징 절차

### 7.1 단독 작업 보장

패키징 중 다른 에이전트가 아래 파일이나 산출물을 수정하지 않게 한다.

- `package.json`, `package-lock.json`
- `electron-builder.config.cjs`
- `scripts/build-integrated-installer.ps1`
- `dist/`, `release/`, `node_modules/better-sqlite3`

Electron, 개발 서버, 별도 electron-builder가 남아 있지 않은지 확인한다. 진행 중인 builder를 강제 종료한 산출물은 전부 실패품으로 취급한다.

### 7.2 변경 상태와 버전 확인

```powershell
git status --short
node -p "require('./package.json').version"
node -p "require('./package-lock.json').version"
Test-Path -LiteralPath 'templates/reports/설비이력카드.xlsx'
```

`package.json`과 `package-lock.json` 버전은 같아야 한다. 작업 트리가 dirty이면 변경 파일의 소유와 릴리스 포함 여부를 먼저 기록한다. 사용자나 다른 에이전트의 변경을 되돌리지 않는다.

### 7.3 저비용 회귀검증

```powershell
node tools/diagnostic-runner/runner.cjs --scenario all --lint --changed
```

실패하면 패키징하지 않는다. 관련 산출물만 읽고 수정한 뒤 다시 실행한다.

### 7.4 전체 검증

```powershell
node tools/diagnostic-runner/validate-prepared.cjs
```

EXIT 0을 확인한다. 여기에는 기존 기능 회귀와 릴리스 계약 검사가 포함된다.

### 7.5 업데이트용 설치판 생성

정식 경로는 반드시 `release`를 사용한다. 검증 스크립트도 이 경로를 기준으로 한다. 임의의 `release-1.1.47` 폴더로 builder 출력만 바꾸면 표준 검증이 과거 `release`를 검사할 수 있다.

```powershell
npm run release:safe
```

이 명령은 오래 걸릴 수 있으므로 최소 20분 이상 기다린다. “다운로드 100%”나 설치 EXE가 먼저 보인다는 이유로 완료된 것이 아니다. 명령의 최종 EXIT 0과 뒤따르는 ASAR/native 검증 PASS까지 기다린다.

### 7.6 패키지 실물 확인

```powershell
$version = node -p "require('./package.json').version"
$required = @(
  'release/win-unpacked/Osoo Handle App.exe',
  'release/win-unpacked/resources/app.asar',
  'release/win-unpacked/resources/app-update.yml',
  'release/win-unpacked/resources/defaults/report-templates/설비이력카드.xlsx',
  "release/Osoo.Handle.App.Setup.$version.exe",
  "release/Osoo.Handle.App.Setup.$version.exe.blockmap",
  'release/latest.yml'
)
$required | ForEach-Object {
  $item = Get-Item -LiteralPath $_ -ErrorAction SilentlyContinue
  [pscustomobject]@{ Path = $_; Exists = [bool]$item; Length = if ($item) { $item.Length } else { 0 } }
}
```

하나라도 없거나 파일 크기가 0이면 실패다. 이어서 명시적으로 다시 검사한다.

```powershell
npm run validate:asar
npm run validate:native
```

### 7.7 GitHub 게시

검증 전 자동 게시하는 `electron:publish`보다, 위에서 검증한 동일 산출물 세 개를 GitHub CLI로 올리는 방식을 우선한다.

```powershell
$version = node -p "require('./package.json').version"
gh release create $version `
  "release/Osoo.Handle.App.Setup.$version.exe" `
  "release/Osoo.Handle.App.Setup.$version.exe.blockmap" `
  "release/latest.yml" `
  --repo bti0497-gif/Osoo_Handle_App `
  --title "Osoo Handle App $version" `
  --notes-file "release/release-notes-$version.md"
```

프로젝트의 기존 태그 규칙대로 `v`를 붙이지 않는다. 이미 태그가 있으면 `gh release upload ... --clobber` 사용 여부를 먼저 판단하고, 덮어올렸다면 해시를 새로 계산한다.

```powershell
Get-FileHash -Algorithm SHA256 "release/Osoo.Handle.App.Setup.$version.exe"
gh release view $version --repo bti0497-gif/Osoo_Handle_App
```

`gh release view`에서 태그, 공개 상태, EXE, blockmap, `latest.yml`을 확인한다.

### 7.8 통합 설치판이 필요한 경우만

자격증명 변경, 신규 PC 설치 또는 재해복구용 패키지가 필요할 때만 실행한다.

```powershell
npm run package:field-installer
npm run validate:field-installer
```

통합 설치판은 GitHub Release에 올리지 않는다. 자격증명은 설치 과정에서 아래 두 위치에 프로비저닝되어야 한다.

```text
%APPDATA%\Osoo_Handle_App\config
%APPDATA%\wastewater-treatment-plant\config
```

## 8. 실패 유형별 판정과 복구

### `win-unpacked/Osoo Handle App.exe`가 없다

설치 EXE와 blockmap이 보여도 불완전한 빌드다. 흔한 원인은 동시 builder 실행, 중간 강제 종료, 출력 폴더 정리 경합, 백신/인덱서의 파일 잠금이다.

- 해당 실행에서 나온 설치 EXE, blockmap, `latest.yml`, `win-unpacked`를 한 세트로 모두 폐기한다.
- 이전 정상 `release`와 섞지 않는다.
- 실행 중인 builder/Electron이 없는지 확인한다.
- Node ABI를 복구하고 표준 `release:safe`를 처음부터 다시 실행한다.
- 이 실패를 양식 포함 정책 문제로 해석해 builder 설정을 제거하지 않는다.

### ASAR 검증이 “양식 포함 금지”로 실패한다

`templates/**/*` 전체 포함 여부와 승인된 개별 기본양식 포함 여부를 구분한다. 장비이력카드 양식을 빼는 대신 검증 규칙을 §3의 계약대로 정정한다.

### native 검증이 ABI 불일치로 실패한다

패키지 안의 Electron ABI 문제인지 작업 사본의 Node ABI 문제인지 먼저 구분한다.

- `validate:native` 실패: Electron용 rebuild 또는 패키지 누락 문제다.
- 일반 서버/진단러너 실패: 작업 사본이 Electron ABI에 남았을 가능성이 크다.

수동 바이너리 복사 없이 정식 rebuild 순서를 다시 수행한다.

### 설치파일만 있고 `latest.yml`이 없거나 서로 다르다

자동업데이트 배포물로 사용할 수 없다. 반드시 같은 한 번의 성공한 빌드에서 생성된 EXE, blockmap, `latest.yml` 세트를 사용한다.

## 9. 과거에 반복된 잘못과 금지 목록

- 통합 설치판과 자동업데이트판의 역할을 혼동해 기능 필수 양식을 자동업데이트판에서 제외함
- 실제 설정인 `.cjs`가 아니라 래퍼 `.js`만 수정함
- 커스텀 출력 폴더를 만든 뒤 표준 검증이 다른 `release`를 검사하게 함
- builder 다운로드 100% 또는 설치 EXE 생성만 보고 성공으로 판정함
- 중단된 빌드의 일부 산출물과 이전 정상 산출물을 섞음
- Electron ABI용 `better-sqlite3`를 남긴 채 Node 검증을 반복함
- ABI 문제를 해결하려고 네이티브 바이너리를 수동 복사함
- ASAR 내부 파일, unpacked 네이티브 파일, `extraResources` 파일의 위치를 혼동함
- 검증 규칙이 오래됐을 때 기능을 제거해 검증을 통과시킴
- `electron:publish`로 검증 전에 원격 게시함
- 같은 버전 파일을 다시 만들고도 기존 SHA256/`latest.yml`을 재사용함

## 10. 최종 완료 조건

아래가 모두 참일 때만 “릴리스 가능”이라고 보고한다.

- 회귀 진단 러너 PASS
- prepared 전체 검증 PASS
- `release:safe` EXIT 0
- `validate:asar` PASS
- `validate:native` PASS
- `win-unpacked/Osoo Handle App.exe` 존재
- 장비이력카드 기본양식이 패키지의 승인된 경로에 존재
- 자격증명이 패키지에 없음
- EXE, blockmap, `latest.yml`이 동일 빌드 세트임
- 새 SHA256 기록 완료
- GitHub 자산과 태그를 `gh release view`로 재확인
- 이전 버전 설치 PC에서 업데이트 후 장비이력카드 Excel 출력 실동작 확인

위 조건 중 하나라도 충족하지 않으면 생성된 파일이 보이더라도 배포하지 않는다.
