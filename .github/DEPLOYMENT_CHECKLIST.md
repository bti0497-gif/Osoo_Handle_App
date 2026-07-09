# Deployment Checklist

상세 절차는 [`docs/RELEASE_GUIDE.md`](../docs/RELEASE_GUIDE.md)를 따릅니다.

- [ ] 버전 증가
- [ ] `npm run validate`
- [ ] `npm run build`
- [ ] `npm run electron:build`
- [ ] `npm run validate:asar`
- [ ] `npm run validate:native` (패키지 Electron으로 better-sqlite3 실제 읽기/쓰기)
- [ ] 자격증명 미포함 확인
- [ ] EXE, blockmap, latest.yml 일치 확인
- [ ] GitHub 정식 릴리스 게시
- [ ] 이전 버전에서 자동 업데이트 확인
- [ ] 로컬 DB와 AppData 설정 유지 확인
