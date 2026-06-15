# 도로공사 입력 도우미 이어가기 계획

## 현재 확인된 상태

- 도로공사 사이트 로그인 후 OTP 팝업은 `webview allowpopups` 적용으로 정상 표시된다.
- OTP 인증 후 상단 `오수처리(외부)` 탭을 눌러야 실제 운영 화면으로 진입한다.
- 이후 왼쪽 메뉴에서 `유지관리+`를 펼치고 `일일운영일지` 메뉴로 들어간다.
- 사용자가 오늘 날짜 일지를 수동으로 `신규 생성 -> 저장 -> 삭제`까지 수행했고, 단계별 DOM 저장을 완료했다.
- 최신 DOM 덤프 저장 위치:

```text
%APPDATA%\Osoo_Handle_App\roadwork-debug\
```

대표 최신 파일:

```text
20260615-121013-login.html
```

## 프레임 구조

일일운영일지는 중첩 iframe 안에 있다.

```text
top
└─ mdi_subWindow1_iframe   title="일일운영일지"
   └─ centerFrame          DalyOpDllgMgmt.xml
```

자동화 스크립트는 먼저 이 프레임을 찾아야 한다.

```js
const outer = document.querySelector('#mdi_subWindow1_iframe')?.contentWindow;
const daily = outer?.document.querySelector('#centerFrame')?.contentWindow || outer;
```

## 주요 버튼 ID

```text
btn_New     신규
btn_Save    저장
btn_Del     삭제
btn_Init    초기화
btn_search  조회
btn_Print   출력팝업
btn_Print2  출력
btn_View    보기
```

처음 구현에서는 `btn_Save` 자동 클릭을 바로 하지 말고, 입력 완료 후 사용자가 직접 확인하고 저장하도록 두는 것이 안전하다. 저장 자동 클릭은 WebSquare 컴포넌트 API가 확정된 뒤 옵션으로 붙인다.

## 주요 입력 필드

근무자 현황:

```text
totWorkrCnt       총 근무자 수
workTnop          근무 인원
bstrTnop          출장 인원
vacTnop           휴가 인원
nghtWorkNmprCnt   야간 근무 인원
rmrkCtnt          비고
```

전력:

```text
prvdElpwMsrmVal   전일 지침
tdayElpwMsrmVal   금일 지침
elpwUsmn          전력 사용량
```

일시/작성자:

```text
regDate
regDate_input
regUser
regAdmin
aprvStat
```

`regDate_input`은 DOM상 disabled 상태로 보인다. 날짜는 목록 조회 또는 신규 버튼 동작 뒤 사이트 내부 로직이 세팅하는 구조로 보고, 직접 값 주입은 후순위로 둔다.

## 주요 그리드 ID

일일처리 현황:

```text
DalyOpDllgPros
G_DalyOpDllgPros__prvdDrwtMsrmVal
G_DalyOpDllgPros__tdayDrwtMsrmVal
G_DalyOpDllgPros__drwtProsAmnt
G_DalyOpDllgPros__drwtProsMnthlCmtlAmnt
G_DalyOpDllgPros__drwtProsAnulCmtlAmnt
```

약품 사용현황:

```text
DalyOpDllgChmc
G_DalyOpDllgChmc__chmcPuchAmnt
G_DalyOpDllgChmc__chmcUseAmnt
G_DalyOpDllgChmc__chmcUseMnthlCmtlAmnt
G_DalyOpDllgChmc__chmcUseAnulCmtlAmnt
G_DalyOpDllgChmc__chmcRsqnVal
```

현장 수질분석결과:

```text
DalyOpDllgWtqt
```

약품 관리대장:

```text
detailGrid
insertRow
deleteRow
```

슬러지 반출대장:

```text
sldgGrid
insertRow2
deleteRow2
```

기타 확인된 그리드:

```text
grd_01
checkDetailGrid
```

## 다음 구현 순서

1. WebSquare 컴포넌트 진단 스크립트를 먼저 실행한다.
2. `daily.btn_New`, `daily.btn_Save`, `daily.DalyOpDllgPros` 같은 전역 컴포넌트 객체가 실제로 존재하는지 확인한다.
3. 각 컴포넌트의 `setValue`, `getValue`, `setCellData`, `getCellData`, `getRowCount`, `click` 계열 메서드를 확인한다.
4. 입력 자동화는 DOM input 값을 직접 바꾸는 방식보다 WebSquare 컴포넌트 API를 우선 사용한다.
5. 첫 자동화는 오늘 날짜 더미 입력까지만 수행하고, 저장 버튼은 사용자가 직접 누르게 한다.
6. 저장 후 목록에서 오늘 날짜가 생성되는지 확인한다.
7. 삭제 자동화는 개발 검증용으로만 두고 실사용 자동화에는 넣지 않는다.

## DevTools 진단 스크립트

도로공사 webview DevTools 콘솔에서 실행한다. React 앱 DevTools가 아니라 도로공사 페이지의 DevTools에서 실행해야 한다.

```js
(() => {
  const outer = document.querySelector('#mdi_subWindow1_iframe')?.contentWindow;
  const daily = outer?.document.querySelector('#centerFrame')?.contentWindow || outer;
  if (!daily) {
    console.warn('일일운영일지 프레임을 찾지 못했습니다.');
    return null;
  }

  const ids = [
    'btn_New',
    'btn_Save',
    'btn_Del',
    'btn_search',
    'regDate',
    'totWorkrCnt',
    'workTnop',
    'bstrTnop',
    'vacTnop',
    'nghtWorkNmprCnt',
    'rmrkCtnt',
    'prvdElpwMsrmVal',
    'tdayElpwMsrmVal',
    'elpwUsmn',
    'DalyOpDllgPros',
    'DalyOpDllgChmc',
    'DalyOpDllgWtqt',
    'detailGrid',
    'sldgGrid',
  ];

  const result = {};
  for (const id of ids) {
    const component = daily[id];
    const element = daily.document.getElementById(id);
    result[id] = {
      hasComponent: Boolean(component),
      componentType: component?.constructor?.name || '',
      hasElement: Boolean(element),
      tagName: element?.tagName || '',
      text: (element?.innerText || element?.value || '').slice(0, 80),
      methods: component
        ? Object.keys(component)
            .filter((key) => /set|get|click|add|insert|delete|remove|row|cell|data|value|submit|save/i.test(key))
            .slice(0, 100)
        : [],
    };
  }

  console.table(result);
  return result;
})();
```

## 자동 입력 초안

진단 스크립트에서 `setValue`와 `click`이 확인된 뒤에만 실행한다.

```js
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const outer = document.querySelector('#mdi_subWindow1_iframe')?.contentWindow;
  const daily = outer?.document.querySelector('#centerFrame')?.contentWindow || outer;

  if (!daily) throw new Error('일일운영일지 프레임을 찾지 못했습니다.');

  daily.btn_New?.click?.();
  await wait(1000);

  daily.totWorkrCnt?.setValue?.('1');
  daily.workTnop?.setValue?.('1');
  daily.bstrTnop?.setValue?.('0');
  daily.vacTnop?.setValue?.('0');
  daily.nghtWorkNmprCnt?.setValue?.('0');
  daily.rmrkCtnt?.setValue?.('자동입력 테스트');

  daily.prvdElpwMsrmVal?.setValue?.('236800');
  daily.tdayElpwMsrmVal?.setValue?.('237700');
  daily.elpwUsmn?.setValue?.('900');

  console.log('기본 입력 완료. 화면을 확인한 뒤 저장 버튼을 직접 누르세요.');
})();
```

## 세션 유지

공사 입력 도우미 화면이 열려 있는 동안 4분마다 도로공사 서버에 가벼운 요청을 보내 세션 유지를 시도한다. 사용자가 말한 30분 작업 범위 안에서는 충분해야 한다.

단, 사이트가 서버 측에서 OTP 인증 세션을 별도 정책으로 끊으면 keep-alive만으로는 막지 못할 수 있다.

## 주의사항

- 이 사이트는 외부 업무 시스템이므로 저장/삭제 자동 클릭은 매우 보수적으로 붙인다.
- 첫 구현 목표는 “입력값 채우기 + 사용자가 확인 후 저장”이다.
- 저장 자동화는 동일 날짜 중복 여부와 사이트의 검증 메시지 처리까지 확인한 뒤 별도 단계로 둔다.
- DOM 덤프의 outerHTML에는 실제 입력값이 `value` 속성으로 남지 않는 경우가 있다. 실제 자동화는 live WebSquare 컴포넌트 상태를 읽어야 한다.
