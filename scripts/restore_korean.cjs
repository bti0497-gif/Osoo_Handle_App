const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const PAST_COMMIT = 'f9714e1';

// 한글 깨짐 단어 정밀 복구 딕셔너리 (3자 이상의 고유성이 검증된 외계어 패턴만 선별 수록)
const GARBLED_DICT = {
  // 기본 기능성 단어
  '?섏쭏遺꾩꽍?쇱?': '수질분석일지',
  '?섏쭏遺꾩꽍': '수질분석',
  '?ъ쭊愿리?': '사진관리',
  '?쏀뭹?낃퀬?쇱?_': '약품입고일지_',
  '?쏀뭹?낃퀬': '약품입고',
  '?щ윭吏': '슬러지',
  '?곗씠?': '데이터',
  '?뚯씪??': '파일을',
  '?놁뒿?덈떎': '없습니다',
  '?섎せ???붿껌?낅땲??': '잘못된 요청입니다.',
  '?대쫫': '이름',
  '鍮꾨?踰덊샇媛€': '비밀번호가',
  '?쇱튂?섏?': '일치하지',
  '?딆뒿?덈떎': '않습니다',
  '?깆쟻??': '성적서',
  '?낅줈??': '업로드',
  '?좎쭨': '날짜',
  '?쒖옉': '시작',
  '?뺤떇': '형식',
  '?ъ슜??': '사용자',
  '?ㅼ젙': '설정',
  '臾댄슚': '무효',
  '罹먯떆': '캐시',
  '濡쒓렇?몄뿉': '로그인에',
  '?숆린??': '동기화',
  '?꾩옣': '현장',
  '?깆쟻?쒕?': '성적서를',
  '議고쉶': '조회',
  '沅뚰븳': '권한',
  '?놁쓬': '없음',
  '?섏젙': '수정',
  '??젣': '삭제',
  '?볤?': '댓글',
  '?묒꽦': '작성',
  '?대쫫 ?먮뒗 鍮꾨?踰덊샇媛€ ?쇱튂?섏? ?딆뒿?덈떎.': '이름 또는 비밀번호가 일치하지 않습니다.',
  '?대쫫 ?먮뒗 鍮꾨?踰덊샇媛€ ?쇱튂?섏? ?딆뒿?덈떎': '이름 또는 비밀번호가 일치하지 않습니다',
  'admin?€': 'admin은',
  '濡쒖뺄???€?ν븯吏€': '로컬에 저장하지',
  '?쒖꽦': '활성',
  '?몄뀡': '세션',

  // 추가로 정밀 발굴된 런타임 한글 복원 단어
  '?대씪?댁뼵??': '클라이언트',
  '釉뚮씪?곗??': '브라우저',
  '?덉슜': '허용',
  '異쒓렐': '출근',
  '?대렐': '퇴근',
  '異쒓결': '출결',
  '紐⑸줉': '목록',
  '?뺤긽': '정상',
  '?깆쟻?쒕뒗': '성적서는',
  '?깆쟻??ID媛€': '성적서 ID가',
  '?꾩슂?⑸땲??': '필요합니다.',
  '?낅줈???뚯씪???놁뒿?덈떎.': '업로드할 파일이 없습니다.',
  '?뚯씪紐?': '파일명',
  '?щ컮瑜댁?': '올바르지',
  '?뺤텞': '압축',
  '?댁꽍': '해석',
  '異춈': '추출',
  '寃곌낵': '결과',
  '?대?吏€': '이미지',
  '?낅줈?쒓가': '업로드가',
  '?덉쇅 諛쒖깮': '예외 발생',
  '?묒떇': '양식',
  '?대낫?닿린': '미리보기',
  '?대낫?닿린???ㅽ뙣?덉뒿?덈떎': '미리보기에 실패했습니다',
  '媛쒖쓽': '개의',
  '?댁뿀?듬땲??': '열었습니다',
  '李얠쓣 ???놁뒿?덈떎': '찾을 수 없습니다',
  '?쒖옉?쇱? 醫낅즺?쇰낫????쓣 ???놁뒿?덈떎': '시작일은 종료일보다 클 수 없습니다',
  '?좎쭨 ?뺤떇???щ컮瑜댁? ?딆뒿?덈떎': '날짜 형식이 올바르지 않습니다',
  '?좎쭨?€ ??ぉ???꾩슂?⑸땲??': '날짜와 항목이 필요합니다',
  '?대諛쏆?': '내려받은',
  '?꾩옱': '현재',
  '沲곗??쇰줈': '기준으로',
  '援ы븯沲?': '구하기',
  '?⑤씪??': '온라인',
  '罹먯떆濡?': '캐시로',
  '?먮룞': '자동',
  '泥?': '첫',
  '?깆쟻??캐시': '성적서 캐시',
  '조회?ㅽ뙣': '조회 실패',
  '동기화?ㅽ뙣': '동기화 실패',
  '?\x00-\x7F가-힣/권한': '네트워크/권한',
  '현장愿€由ъ옄': '현장관리자',
  '사용자데이터곕?': '사용자 데이터를',
  '동기화?꾨즺': '동기화 완료',
  '설정?섏?': '설정되지',
  '?\x00-\x7F가-힣?섏?': '설정되지',
  '?딆븯?듬땲??': '않았습니다.',
  '?€???뚯원??': '대상 회원을',
  '李얠쓣 ??없습니다': '찾을 수 없습니다',
  '理쒓퀬愿€由ъ옄': '최고관리자',
  '삭제????없습니다': '삭제할 수 없습니다',
  '?뚰봽??': '소프트',
  '?곌결??': '연결이',
  '?섏떊/?€?ν뻽?듬땲??': '수신/저장했습니다',
  '?낅줈?쒗븷': '업로드할',
  '?덉퐫?쒓가': '레코드가',
  '?놁뒿?덈떎': '없습니다',
  '?섏씠吏€': '페이지',
  '?섑띁': '페이퍼',
  '?뚯떛': '파싱',
  '?꾨씫': '누락',
  '?앹꽦??': '생성된',
  '媛앹껜瑜?': '객체를',
  '媛앹껜濡?': '객체로',
  '諛쒖깮': '발생',
  '?쒗뵆ly씠': '템플릿이',
  '?꾩쭅': '아직',
  '?앹꽦?섏?': '생성되지',
  '?ㅼ얎': '파일을',
  '?ㅼ떆': '다시',
  '?낅줈?쒗빐': '업로드해',
  '二챰뒪': '주스',
  '二쇱꽭': '주세요',
  '?섏씠吏€蹂?': '페이지별',
  '臾몄젣': '문제',
  '蹂댁셿': '보완',
  '?뺤씤': '확인',
  '踰붿쐞': '범위',
  '?꾨━酉곗슜': '미리보기용',
  '?쇱씪?낃퀬?쇱?': '일일업무일지',
  '?쒖옉??': '시작일',
  '?쒖뒪??': '시스템',
  '吏곸젒': '직접',
  '?닿린': '열기',
  '?묒?': '엑셀',
  '?묒꽦??': '작성자',
  '愿€由ъ옄': '관리자',
  '?대젮諛쏆?': '내려받은',
  '?대쫫 ?먮뒗 鍮꾨?踰덊샇媛€': '이름 또는 비밀번호가',
  '?쇱튂?섏? ?딆뒿?덈떎': '일치하지 않습니다',
  '?딆븯?듬땲??.': '않았습니다.',
  '설정??': '설정이',
  '?딆븯?듬땲??': '않았습니다',
  '?쒗트': '시트',
  '蹂꾩묶怨?': '별칭과',
  '留욎텛沲?': '맞추기',
  '?꾪빐': '위해',
  '異붽?': '추가',
  '?덉쟾留?': '안전망',
  '臾몄옄??': '문자열',
  '?좎궗??': '유사도',
  '?곌결': '연결',
  '媛개쓽': '개의',
  '?뚯일???놁뒿?덈떎': '파일이 없습니다',
  
  // 신규 동기화 스케줄러, 라우터 레지스트리, 유저 헤더 복원 단어
  '?댁쟾': '이전',
  '二쇨린': '주기',
  '諛€由ъ큹': '밀리초',
  '?⑥쐞': '단위',
  '嫄대꼫?곷땲??': '건너뜁니다',
  '?숆린??': '동기화',
  '?쒖옉': '시작',
  '?꾩넚??': '전송할',
  '데이터곌?': '데이터가',
  '?덉쓣': '있을',
  '?뚮쭔': '때만',
  '?쒕쾭': '서버',
  '吏썑': '직후',
  '10珥?': '10초',
  '?ㅼ뿉': '뒤에',
  '??踰?': '한 번',
  '?ㅽ뻾': '실행',
  '珥덇기': '초기',
  '?곸옱': '적재',
  '?댄썑': '이후',
  '二쇨린?곸쑝濡?': '주기적으로',
  '紐⑤뱺': '모든',
  '?쇱슦??': '라우터',
  '?깅줉': '등록',
  '?뺣낫瑜?': '정보를',
  '??怨녹뿉': '한 곳에',
  '紐⑥?': '모은',
  '?덉??ㅽ듃디먮떎': '엔트리입니다',
  '怨꾩링蹂꾨줈': '계층별로',
  '遺꾨쪟?섏뼱': '분류되어',
  '?쒗쉶?섎ŉ': '조회하여',
  '?깆뿉': '등에',
  '?깅줉?⑸땲??': '등록합니다',
  '???쇱슦??': '새 라우터',
  '諛⑸쾿': '방법',
  '諛곗뿴??': '배열에',
  '??ぉ': '항목',
  '?섎굹留?': '하나만',
  '추가?섎㈃': '추가하면',
  '?Base_': '기본',
  '?낅땲??': '됩니다',
  '利됱떆': '즉시',
  '濡쒓렇??': '로그인',
  '?놁젗': '없이',
  '?꾩슂??': '필요한',
  '留?': '만',
  '媛꾧꺽': '간격',
  '?꾨━濡쒕뱶': '프리로드',
  '?붿껌': '요청',
  '濡쒕뱶': '로드',
  '동기화媛먯떆': '동기화 감시',
  '?€??': '대상',
  '以?': '중',
  '?대?': '이미',
  '?쇱슦?멸?': '라우터가',
  '?꾩슂濡??섎뒗': '필요로 하는',
  '寃쭔': '것만',
  '紐낆떆': '명시',
  '媛€': '가',
  '?먯꽌': '에서',
  '留ㅽ븨?⑸땲??': '매핑됩니다',
  '?깃났': '성공',
  '媛꾧꺽?쇰줈': '간격으로',
  '寃€利?': '검증',
  '?꾨즺': '완료',
  '???대??먯꽌': '이 단계에서',
  '?꾨ꖲ?섎?濡?': '전달하므로',
  '?꾩슂': '필요',
  '?ㅼ뼱????': '들어올 때',
  '?ㅻ뜑': '헤더',
  '媛믪쓣': '값을',
  '濡쒕쭔': '로만',
  '허용?쒕떎': '허용한다',
  '?대씪?댁뼵?몃뒗': '클라이언트는',
  '濡??섍린怨?': '로 넘기고',
  '?쒕쾭?먯꽌': '서버에서',
  '???\x00-\x7F가-힣濡?': '이 함수로',
  '蹂듭썝?쒕떎': '복원한다',
  '?덉쟾(誘몄씤\x00-\x7F가-힣)': '안전(미인코딩)',
  '媛믪?': '값은',
  '???먮Ц??': '때문에',
  '洹몃?濡?': '그대로',
  '?대떎': '둔다',
  
  // 백엔드 정적 파일용 추가 딕셔너리
  '?뚯씠釉?': '테이블',
  '?앹꽦': '생성',
  '?ㅽ뙣:': '실패:',
  '?대씪?댁뼵?몃?': '클라이언트를',
  '초기?뷀븷': '초기화할',
  '?뚯씠釉붿젗': '테이블이',
  '아직 吏꾪뻾': '아직 진행',
  '而щ읆??': '컬럼을',
  '留덉씠洹몃젅?댁뀡??': '마이그레이션을',
  '諛깆뾽': '백업',
  '?덉젙': '지정',
  '?ㅽ궎만': '스키마',
  '?놁어': '없어',
  '?놁뼱': '없어',
  '吏꾪뻾????': '진행할',
  '?묒뾽??': '작업이',
  '10遺?': '10분',
  '遺?': '분',
  '珥?': '총',
  '嫄댁쓽': '건의',
  '諛깃그?쇱슫??': '백그라운드',
  '동기화?ㅼ?': '동기화 스케줄러',
  '怨꾩뿴?€': '계열은',
  '?ㅼ젣': '실제',
  '?붾㈃': '화면',
  '?섎??': '하단',
  '珥덇낵': '초과', 
  '?€??': '대체',
  '諛섏텧愿€由щ???': '반출관리대장',
  '沲곗낯': '기본',
  '?쒕뱶': '시드',
  '理쒖큹': '최초',
  '?좊룄': '유도',
  'is_synced媛€': 'is_synced가',
  'last_modified만': 'last_modified만',
  '?몃뜳??': '인덱스',
  '諛?': '및',
  '諛깊븘': '백업',
  '?닿쾶?뚮씠': '사이트별',
  '怨좎쑀': '고유',
  '?앸퀎??': '식별자',
  '?뺣낫': '정보',
  '?ㅼ쨷': '다중',
  '?꾪솚': '전환',
  '?€鍮?': '대비',
  '?덉쑝硫?': '있으면',
  '梨꾩?': '채움',
  '첫': '첫',
  '紐⑤뱢??': '모듈을',
  '로드?섎뒗': '로드하는',
  '?먮윭': '에러',
  '?곹깭瑜?': '상태를',
  '?€?ν븯??': '저장하여',
  '臾댄븳': '무한',
  '?ъ떆?꾨?': '재시도를',
  '諛⑹?': '방지',
  '媛믪쑝濡?': '값으로',
  '沲곕컲': '기반',
  '자동 추출': '자동 추출',
  '라우터등록': '라우터 등록',
  '정보를한 곳에': '정보를 한 곳에',
  '媛앹껜 蹂€': '객체 변',
  '?꾩껜 ?쎄린 (2??) ??': '전체 읽기 (2단계) 의 ',
  '諛곗뿴 諛섑솚': '배열 반환',
  'append, 있으면': 'append, 있으면',
  '?꾩껜 조회': '전체 조회',
  '시트 ??踰덊샇': '시트 행 번호',
  
  // 마이너 깨짐 추가 패치
  '以묒엯?덈떎': '중입니다.',
  '?쒕퉬??': '서비스',
  '怨꾩젙': '계정',
  '?몄쬆': '인증',
  '?섍꼍蹂€?섍?': '환경변수가',
  '怨듭': '공유',
  '媛앹껜 蹂€??': '객체 변수',
  '?대씪?댁뼵?몃?': '클라이언트를',
  '?ㅽ궎留덈뒗': '스키마는',
  '理쒖떊 ?곹깭': '최신 상태',
  '?뱀젙 현장紐?': '특정 현장명',
  '현장紐?': '현장명',
  '?a[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]': 'ㄱ-ㅎ|ㅏ-ㅣ|가-힣', // uploadRoutes regex 예외처리용
  '?ㅼ쓬 명령?쇰줈': '다음 명령으로',
  '명령?쇰줈': '명령으로',
  '실행하세요??': '실행하세요',
  '?덉젙': '지정',
  '留덉씠洹몃젅?댁뀡': '마이그레이션',
  '?뚯씠釉붿?': '테이블은',
  'is_synced媛€': 'is_synced가',
  '?덉쑝誘€濡?': '있으므로',
  'last_modified만확인': 'last_modified만 확인',
  '?닿쾶?뚮퀎': '사이트별',
  '?뺣낫 ??': '정보 및 ',
  '설정 ??': '설정 및 ',
  '설정 ??': '설정 및',
  '5媛?': '5개',
  '?뚯씠釉뿉': '테이블에',
  '?뚯씠釉붿뿉': '테이블에',
  '?\x00-\x7F가-힣현장': '다중현장',
  '?꾪솚 ?€鍮?': '전환 대비',
  '?덉쑝硫?': '있으면',
  '?섎 Lazy Loader': '하는 Lazy Loader',
  '?먮윭 발생 ??': '에러 발생 시',
  '발생 ??': '발생 시',
  '?곹깭瑜?': '상태를',
  '?€?ν븯??': '저장하여',
  '?ъ떆?꾨?': '재시도를',
  '?뚯씠釉붿젗': '테이블이',
  '?ㅽ뙣 ${': '실패 ${',
  '?ㅼ젣 ctx': '실제 ctx',
  '媛믪쑝濡?': '값으로',
  '留ㅽ븨됩니다': '매핑됩니다',
  '沲곕컲 lazy wrapper': '기반 lazy wrapper',
  '?ㅼ?중': '스케줄러',
  '자동??': '자동화',
  '?덉??std디먮떎': '엔트리입니다',
  '?덉??ㅽ듃디먮떎': '엔트리입니다',
  '?덉??ㅽ듃由ъ엯?덈떎': '엔트리입니다',
  '?숆린??': '동기화',
  '?쒖옉...': '시작...',
  '?대?': '이미',
  '寃€利?': '검증',
  '?꾨즺': '완료',
  '?꾨ꖲ?섎?濡?': '전달하므로',
  '?꾨씫': '누락',
  'last_modified만확인': 'last_modified만 확인',
  '沲곗〈 ?': '기존에',
  '?됱쓣 is_active': '행을 is_active',

  // 초미세 패턴 대응 딕셔너리 확장
  '??없습니다': '수 없습니다',
  '?? W': '의 W',
  '1??=': '1행 =',
  '2??)': '2단계)',
  '??시트': '이 시트',
  '공유쑀???곹깭': '공유된 상태',
  '설정되지 않았습니다 (?뚯썝/현장 공유': '설정되지 않았습니다. (회원/현장 공유',
  '??珥덇린??': '초기화',
  '?꾩옣 ??젣': '현장 삭제',
  '?대씪?댁뼵?몃? 珥덇린?뷀븷': '클라이언트를 초기화할',
  '?뚯씠釉붿젗': '테이블이',
  '?뚯씠釉붿씠 ?놁뒿?덈떎': '테이블이 없습니다',
  '?대?': '이미',
  '?€?낆씠誘€濡?': '타입이므로',
  '留덉씠洹몃젅?댁뀡???꾩슂 ?놁뒿?덈떎': '마이그레이션이 필요 없습니다',
  '諛섏쁺?€': '반영은',
  '?ㅼ쓬 紐졊?쇰줈': '다음 명령으로',
  '?ㅽ뻾?섏꽭??': '실행하세요',
  '沲곗〈 ?뚯씠釉???젣': '기존 테이블 삭제',
  '?뚯씠釉???젣': '테이블 삭제',
  '?ㅽ궎留??뚯씠釉??앹꽦': '스키마 테이블 생성',
  '?뚯씠釉??앹꽦': '테이블 생성',
  '留덉씠洹몃젅?댁뀡 ?꾨즺': '마이그레이션 완료',
  '전환???뚯썝??': '전환한 회원이',
  '전환 ?€???뚯': '전환 대상 회원',
  '?€???뚯썝': '대상 회원',
  '?숆린???쒖옉': '동기화 시작',
  '???꾩옣': '임시현장',
  '???꾩옣"': '임시현장"',
  '설정을?놁어': '설정이 없어',
  '설정이?놁어': '설정이 없어',
  '설정이?놁뼱': '설정이 없어',
  '?대떦 id ?됱쓣': '해당 id 행을',
  '기존에?寃€': '기존 행 검색',
  '기존에? 寃': '기존 행 검색',
  '기존에?': '기존 행 검색',
  '설태를?€?ν븯??': '상태를 저장하여',
  '상태를?€?ν븯??': '상태를 저장하여',
  '방지?\x00-\x7F가-힣': '방지합니다',
  'index.js??registerLazyApplication()??': 'index.cjs의 registerLazyApplication()이',
  'index.cjs??registerLazyApplication()??': 'index.cjs의 registerLazyApplication()이',
  '파일을조회하여': '파일을 조회하여',
  '??파일을조회하여': '이 파일을 조회하여',
  '??배열에': '이 배열에',
  '추가하면 ?\x00-\x7F가-힣': '추가하면 됩니다',
  '감시 ?€??': '감시 대상',
  'watch: true ??': 'watch: true는',
  'resolveArgs()媛€': 'resolveArgs()가',
  '??waterQualityRoutes': '이 waterQualityRoutes',
  '??이미에서': '이미 baseDir에서',
  'directory()???꾨': 'directory()를 호출하므로',
  
  // 3차 정밀 분석에 따른 딕셔너리 확장
  '?꾩옣 ?뺣낫': '현장 정보',
  '???뚯씪 ?놁쓬:': '키 파일 없음:',
  '愿€由ъ옄紐?': '관리자명',
  '媛€?몄삤湲?': '가져오기',
  '?꾩떆 ?뚯씪 ?앹꽦': '임시 파일 생성',
  '?꾩떆 ?뚯씪 ??젣': '임시 파일 삭제',
  '?섏젙: DML': '수정: DML',
  '?볤? ?앹꽦': '댓글 생성',
  '?볤? ?뚰봽????젣': '댓글 소프트삭제',
  '이미諛섏넚?좊웾怨?': '이미반송유량값',
  'bindings[\'?좎쭨\']': 'bindings[\'날짜\']',
  'bindings[\'?대쫫\']': 'bindings[\'이름\']',
  '?쏀뭹 ?곗씠??': '약품 데이터',
  '?щ룄??1)': '송도(1)',
  '디먮떎??2)': '중태(2)',
  '以묓깂??2)': '중태(2)',
  '??3) ?쒖쇅': '대(3) 제외',
  '?꾨젰사용자': '전력사용량',
  '諛⑸쪟??泥섎━??': '방류량 처리량',
  '?꾨젰怨꾩궛': '전력계산',
  '諛⑸쪟???꾨젰??怨꾩궛媛?': '방류량 전력량 계산값',
  '諛붿씤??': '바인딩',
  'bindings[\'?섏쭏?좎쭨1\']': 'bindings[\'수질날짜1\']',
  'bindings[\'?섏쭏?좎쭨2\']': 'bindings[\'수질날짜2\']',
  '嫄대뱶由ъ? ?딆쓬': '건드리지 않음',
  '사용자?섎룞 ?낅젰??': '사용자 수동 입력',
  '?뚯일 ?낅줈??': '파일 업로드',
  '성적서?대뜑': '성적서 폴더',
  '以묒븰 업로드': '중앙 업로드',
  '?깆쟻??{year}': '성적서/{year}',
  '?뺤떇': '형식',
  '?ъ쭊 ?대뜑': '사진 폴더',
  '???ν썑 援ы쁽': '수신후 구현',
  '???쒓????ㅼ튂?섏뼱 ?덉뼱???\x00-\x7F가-힣': '에 한글이 설치되어 있어야 합니다.',
  'HWPX ?뚯씪???????놁뒿?덈떎': 'HWPX 파일을 찾을 수 없습니다',
  '遺덊븘?? {{??}': '불가시 {{키}}',
  '문자열\x00-\x7F가-힣': '문자열 치환합니다',
  '?꾩옣 ??젣': '현장 삭제',
  '?대떦 id ?됱쓣 is_active = 0?쇰줈 ?쒖떆': '해당 id 행을 is_active = 0으로 표시',
  '珥덇린?뷀븷 수 없습니다': '초기화할 수 없습니다',
  'STRING ?€?낆씠誘€濡?': 'STRING 타입이므로',
  '諛섏쁺?€ 다음 명령으로 실행?섏꽭??': '반영은 다음 명령으로 실행하세요',
  '諛섏쁺?€ 다음 명령으로 실행': '반영은 다음 명령으로 실행',
  '湲곗〈 테이블삭제 완료': '기존 테이블 삭제 완료',
  'UUID濡?전환???뚯썝수 없습니다': 'UUID로 전환한 회원이 없습니다',
  'UUID 전환 ?€???뚯썝': 'UUID 전환 대상 회원',
  '?숆린???쒖옉...': '동기화 시작...',
  '상태를?€?ν븯??무한': '상태를 저장하여 무한',
  '沲곕컲': '기반',
  '自動 異붿텧': '자동 추출',
  '자동 異붿텧': '자동 추출',
  'pre-trigger: registry 沲곕컲': 'pre-trigger: registry 기반',
  '??파일을 조회하여': '이 파일을 조회하여',
  'watch: true는BigQuery': 'watch: true는 BigQuery',
  'baseDir??importQntechWaterPhotos': 'baseDir에서 importQntechWaterPhotos',
  'baseDir??importQntechWaterPhotos(), buildManualPhotoDirectory()???꾨': 'baseDir에서 importQntechWaterPhotos(), buildManualPhotoDirectory()를 호출하므로',
  '?뚯떛 ?쒖옉': '파싱 시작',

  // 4차 정밀 분석에 따른 딕셔너리 확장
  '?쏀뭹?낃퀬?쇱?': '약품입고일지',
  'medicineDate || `${y}.${mm}`': '{{날짜}}: medicineDate || `${y}.${mm}`',
  '// 추가 ?쏀뭹': '// 추가 약품',
  '理쒕? 2媛?': '최대 2개',
  'bindings[`{{${key}?대쫫}}`]': 'bindings[`{{${key}이름}}`]',
  'sheetName: \'?쏀뭹\'': 'sheetName: \'약품\'',
  '?쏀뭹?낃퀬?쇱? xlsx': '약품입고일지 xlsx',
  '// flow_readings ?숆린??': '// flow_readings 동기화',
  'error: \'?뚯씪 ?': 'error: \'파일이 없습니다\'',
  'error: \'?곗썡 ?': 'error: \'연월 정보가 필요합니다\'',
  'named range ?놁쓬': 'named range 없음',
  'setCellOnSheet(`?좎쭨${n}`, \'\')': 'setCellOnSheet(`날짜${n}`, \'\')',
  'setCellOnSheet(`?좎쭨${n}`, item.date': 'setCellOnSheet(`날짜${n}`, item.date',
  '?? W': '의 W',
  '???뚯씪 ?놁쓬': '키 파일 없음',
  '愿€由ъ옄紐?': '관리자명',
  '?꾩떆 ?뚯씪 ?앹꽦': '임시 파일 생성',
  '?꾩떆 ?뚯씪 ??젣': '임시 파일 삭제',
  '?섏젙: DML': '수정: DML',
  '?볤? ?앹꽦': '댓글 생성',
  '?볤? ?뚰봽????젣': '댓글 소프트삭제',
  '이미반송유량값 ?먮뒗': '이미반송유량값 또는',
  'bindings[\'?좎쭨\']': 'bindings[\'날짜\']',
  'bindings[\'?대쫫\']': 'bindings[\'이름\']',
  '?쏀뭹 ?곗씠??': '약품 데이터',
  'kw??사용자': 'kw당 사용량',
  '沲곕젰사용자': '전력사용량',
  '(沲곕젰사용자': '(금일 전력사용량',
  'bindings[\'?섏쭏?좎쭨1\']': 'bindings[\'수질날짜1\']',
  'bindings[\'?섏쭏?좎쭨2\']': 'bindings[\'수질날짜2\']',
  '?€?€': '것은',
  '?뚯씪 ?낅줈??': '파일 업로드',
  '??ROOT/?깆쟻??': '폴더 ROOT/성적서/',
  '?뺤떇': '형식',
  '???ν썑 援ы쁽': '수신후 구현',
  '???쒓????ㅼ튂?섏어': '에 한글이 설치되어 있어야 합니다.',
  'HWPX ?뚯씪???????놁뒿?덈떎': 'HWPX 파일을 찾을 수 없습니다',
  '遺덊븘?? {{??}': '불가시 {{키}}',
  '문자열\x00-\x7F가-힣': '문자열 치환합니다',
  '?꾩옣 ??젣': '현장 삭제',
  '?뚯씠釉붿씠 없습니다': '테이블이 없습니다',
  '?€?낆씠誘€濡?마이그레이션을필요': '타입이므로 마이그레이션이 필요',
  '諛섏쁺?€ 다음 명령': '반영은 다음 명령',
  'UUID 전환 ?€???뚯썝': 'UUID 전환 대상 회원',
  '?숆린???쒖옉...': '동기화 시작...',
  '???꾩옣"': '임시현장"',
  '?€?ν븯??무한': '저장하여 무한',
  // 5차 정밀 분석에 따른 딕셔너리 확장
  '湲곕낯媛?': '기본값',
  '?쒓났': '제공',
  '愿€由ъ옄媛€': '관리자가',
  '濡쒖뺄 DB???€??': '로컬 DB에 저장',
  '?꾩껜': '전체',
  '寃€??': '검색',
  '理쒖떊??': '최신순',
  '媛€?몄삤沲?': '가져오기',
  '媛€?몄삤湲?': '가져오기',
  '?뺥깭': '형태',
  '沲곕컲': '기반',
  '湲곕컲': '기반',
  '?ㅼ튂': '설치',
  '?뺥깭???': '형태의',
  '?뚮젅?댁뒪?€?붾?': '플레이스홀더를',
  '?€?낆씠誘€濡?': '타입이므로',
  '?섏꽭??': '하세요',
  '?€??': '대상',
  'resolveArgs()媛€': 'resolveArgs()가',
  '寃€利?': '검증',
  '湲덉씪': '금일',
  '諛붿씤?⑹뿉': '바인딩용에',
  '諛붿씤?': '바인딩',
  '?녿뒗': '없는',
  '?€?€': '것은',
  '// flow_readings ?숆린??': '// flow_readings 동기화',
  '?뚯씪 ?': '파일이 없습니다',
  '?곗썡 ?': '연월 정보가 필요합니다',
  'named range ?놁쓬': 'named range 없음',
  '?좎쭨${n}': '날짜${n}',
  '/?깆쟻??': '/성적서/',
  '?뺤떇': '형식',
  '???ν썑 援ы쁽': '수신후 구현',
  '???쒓????ㅼ튂?섏어': '에 한글이 설치되어 있어야 합니다.',
  'HWPX ?뚯씪???????놁뒿?덈떎': 'HWPX 파일을 찾을 수 없습니다',
  '遺덊븘?? {{??}': '불가시 {{키}}',
  '문자열\x00-\x7F가-힣': '문자열 치환합니다',
  '?꾩옣 ??젣': '현장 삭제',
  '?뚯씠釉붿씠 없습니다': '테이블이 없습니다',
  '?€?낆씠誘€濡?마이그레이션을필요': '타입이므로 마이그레이션이 필요',
  '諛섏쁺?€ 다음 명령': '반영은 다음 명령',
  'UUID 전환 ?€???뚯썝': 'UUID 전환 대상 회원',
  '?숆린???쒖옉...': '동기화 시작...',
  '???꾩옣"': '임시현장"',
  '?€?ν븯??무한': '저장하여 무한',
  '媛먯떆 prefix': '감시 prefix',
  'watch: true는 BigQuery': 'watch: true는 BigQuery',
  'resolveArgs()媛€': 'resolveArgs()가',
  '寃€利?완료': '검증 완료',
  'baseDir??importQntechWaterPhotos': 'baseDir에서 importQntechWaterPhotos',
  '?뚯떛 ?쒖옉': '파싱 시작'
};

const GARBLED_REGEX = /[^\x00-\x7F가-힣\s]/;

function getCodeStructure(str) {
  return str.replace(/[가-힣]/g, '').replace(/[^\x00-\x7F]/g, '').replace(/\?/g, '').replace(/\s+/g, '');
}

function getLevenshteinDistance(a, b) {
  const tmp = [];
  let i, j;
  for (i = 0; i <= a.length; i++) {
    tmp.push([i]);
  }
  for (j = 0; j <= b.length; j++) {
    tmp[0][j] = j;
  }
  for (i = 1; i <= a.length; i++) {
    for (j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

function getSimilarity(a, b) {
  const structA = getCodeStructure(a);
  const structB = getCodeStructure(b);
  if (!structA && !structB) return 1.0;
  if (!structA || !structB) return 0.0;
  const distance = getLevenshteinDistance(structA, structB);
  const maxLength = Math.max(structA.length, structB.length);
  return (maxLength - distance) / maxLength;
}

function findMatchingLine(currentLine, pastLines, targetIndex, windowSize = 35) {
  const start = Math.max(0, targetIndex - windowSize);
  const end = Math.min(pastLines.length - 1, targetIndex + windowSize);
  
  let bestIndex = -1;
  let bestSim = 0;
  
  for (let i = start; i <= end; i++) {
    const sim = getSimilarity(currentLine, pastLines[i]);
    if (sim > bestSim) {
      bestSim = sim;
      bestIndex = i;
    }
  }
  
  if (bestSim >= 0.82) {
    return pastLines[bestIndex];
  }
  
  bestIndex = -1;
  bestSim = 0;
  for (let i = 0; i < pastLines.length; i++) {
    const sim = getSimilarity(currentLine, pastLines[i]);
    if (sim > bestSim) {
      bestSim = sim;
      bestIndex = i;
    }
  }
  
  if (bestSim >= 0.88) {
    return pastLines[bestIndex];
  }
  
  return null;
}

function restoreFile(relativeFilePath, dryRun = true) {
  const filePath = path.join(ROOT_DIR, relativeFilePath);
  if (!fs.existsSync(filePath)) {
    return { success: false, reason: 'File not found' };
  }

  const currentContent = fs.readFileSync(filePath, 'utf8');
  const currentLines = currentContent.split('\n');
  
  let pastLines = [];
  try {
    const pastContent = execSync(`git show ${PAST_COMMIT}:${relativeFilePath.replace(/\\/g, '/')}`, {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    pastLines = pastContent.split('\n');
  } catch (err) {
  }

  let restoredLinesCount = 0;
  let dictionaryFallbackCount = 0;
  const newLines = currentLines.map((line, idx) => {
    // 딕셔너리에 매치되는 깨진 조각이 있거나, 정밀 정규식 조건에 맞는 경우 복원 수행
    const hasGarbledKey = Object.keys(GARBLED_DICT).some(key => line.includes(key));
    if (!hasGarbledKey && !GARBLED_REGEX.test(line)) {
      return line;
    }

    // 1. 과거 커밋과의 구조적 대조 복원 시도
    if (pastLines.length > 0) {
      const matchedLine = findMatchingLine(line, pastLines, idx);
      if (matchedLine) {
        restoredLinesCount++;
        return matchedLine;
      }
    }

    // 2. 딕셔너리 기반 치환 시도
    let newLine = line;
    let replaced = false;
    for (const [garbled, normal] of Object.entries(GARBLED_DICT)) {
      if (newLine.includes(garbled)) {
        newLine = newLine.split(garbled).join(normal);
        replaced = true;
      }
    }

    if (replaced) {
      dictionaryFallbackCount++;
      return newLine;
    }

    return line;
  });

  const newContent = newLines.join('\n');
  const isChanged = newContent !== currentContent;

  if (isChanged && !dryRun) {
    fs.writeFileSync(filePath, newContent, 'utf8');
  }

  return {
    success: true,
    isChanged,
    restoredLinesCount,
    dictionaryFallbackCount
  };
}

function main() {
  const dryRun = process.argv.includes('--apply') ? false : true;
  console.log(`=== Restoring Korean Characters (DryRun: ${dryRun}) ===`);
  
  const srcDir = path.join(ROOT_DIR, 'src');
  const serverDir = path.join(ROOT_DIR, 'server');
  
  let totalChangedFiles = 0;
  let totalRestoredLines = 0;
  let totalDictFallbacks = 0;

  function scanAndRestore(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'build' || file === 'release') return;
        scanAndRestore(fullPath);
      } else if (stat.isFile() && /\.(js|jsx|cjs)$/.test(file)) {
        const relativePath = path.relative(ROOT_DIR, fullPath);
        const res = restoreFile(relativePath, dryRun);
        if (res.success && res.isChanged) {
          totalChangedFiles++;
          totalRestoredLines += res.restoredLinesCount;
          totalDictFallbacks += res.dictionaryFallbackCount;
          console.log(`[MODIFIED] ${relativePath} (Struct matches: ${res.restoredLinesCount}, Dict matches: ${res.dictionaryFallbackCount})`);
        }
      }
    });
  }

  scanAndRestore(srcDir);
  scanAndRestore(serverDir);

  console.log('==================================================');
  console.log(`Summary:`);
  console.log(` - Total Changed Files: ${totalChangedFiles}`);
  console.log(` - Total Line Level Restores: ${totalRestoredLines}`);
  console.log(` - Total Dictionary Fallbacks: ${totalDictFallbacks}`);
  console.log('==================================================');
  
  if (dryRun) {
    console.log(`To apply changes, run: node scripts/restore_korean.cjs --apply`);
  } else {
    console.log(`Changes successfully applied!`);
  }
}

main();
