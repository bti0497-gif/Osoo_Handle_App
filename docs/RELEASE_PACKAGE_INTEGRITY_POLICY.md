# 릴리즈 패키지 무결성 정책

## 목적

Electron 설치판은 서버 코드만으로 완성되지 않는다. `dist/index.html`과 해당 문서가 참조하는 JavaScript·CSS 번들이 모두 포함되어야 정상 화면이 열린다.

## 강제 규칙

1. 정식 릴리즈는 `clean → build → validate → package → packaged validate → publish` 순서로 수행한다.
2. `clean:release`는 `dist`도 삭제하므로 실행 뒤에는 반드시 프런트 빌드를 다시 수행한다.
3. `electron-builder`는 실행 방식과 관계없이 패키징 전에 로컬 `dist`를 검사한다.
4. 패키징 후 `app.asar` 안의 `/dist/index.html`, JavaScript 번들, CSS 번들을 다시 검사한다.
5. 위 파일 중 하나라도 없거나 비어 있으면 설치판 생성과 게시를 실패시킨다.
6. `--prepackaged` 설치판은 같은 작업에서 검증을 통과한 `win-unpacked`만 사용한다.
7. 수동 `gh release create/upload` 전에 설치 파일 버전, `latest.yml`, SHA 해시와 패키지 검증 결과를 확인한다.

## 필수 명령

```powershell
npm run clean:release
npm run build
npm run validate:renderer
npm run electron:build
```

`electron:build` 자체도 렌더러 원본과 패키지 내부 검증을 수행하므로 검증을 우회한 설치판을 정상 산출물로 취급하지 않는다.

## 사고 대응

- 프런트 누락 패키지는 즉시 공개 중단한다.
- 동일 버전을 덮어쓰지 않고 다음 버전으로 수정판을 만든다.
- 이미 잘못된 버전이 설치된 PC는 정상 설치판을 직접 덮어 설치한다.
- `%APPDATA%\Osoo_Handle_App` 사용자 데이터는 삭제하지 않는다.
