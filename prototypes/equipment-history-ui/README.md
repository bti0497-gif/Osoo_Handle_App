# 장비이력카드 UI 프로토타입

본앱의 라우트, API, DB와 분리된 임시 UI/UX 확인용 폴더입니다.

## 실행

필드 앱 저장소 루트에서:

```powershell
npm run dev --prefix prototypes/equipment-history-ui
```

브라우저에서 `http://localhost:5180`을 엽니다.

## 범위

- 장비 목록, 검색, 분류, 상태 표시
- 장비 추가·수정 모달(메모리에서만 동작)
- 시설물 이력카드와 유지보수 이력
- 업무사진관리에서 관련 장비를 선택하는 UI 예시
- 새로고침하면 입력한 테스트 데이터는 초기화

UI 확정 후 필요한 컴포넌트만 본앱 `src/features/equipment/`에 접목하고 이 폴더 전체를 삭제합니다.
