/**
 * 앱 전역 상수 정의
 * 메뉴 구조, 탭 라벨 등 여러 컴포넌트에서 공유하는 값들을 한 곳에서 관리합니다.
 */

export const MENUS = [
  { id: 'dashboard', label: '대시보드', icon: 'dashboard' },
  { id: 'flow', label: '유량관리', icon: 'water_damage' },
  { id: 'medicine', label: '약품관리', icon: 'science' },
  {
    id: 'water_group',
    label: '수질관리',
    icon: 'opacity',
    children: [
      { id: 'water', label: '수질분석' },
      { id: 'kit', label: '키트관리' },
      { id: 'certificate', label: '성적서' }
    ]
  },
  {
    id: 'facility_group',
    label: '시설관리',
    icon: 'construction',
    children: [
      { id: 'facility', label: '고장·수리이력' },
      // TODO: 장비이력카드 — 현장별 장비 목록(사진·사양 포함)을 관리하고
      //       고장·수리이력 테이블과 facility_id 외래키로 연계하여
      //       장비별 누적 수리 내역을 조회할 수 있도록 구현 예정
      { id: 'equipment_card', label: '장비이력카드' }
    ]
  },
  {
    id: 'log',
    label: '일지작성',
    icon: 'edit_note',
    children: [
      { id: 'log_daily', label: '일일업무일지' },
      { id: 'log_water', label: '수질분석일지' },
      { id: 'log_med_mgmt', label: '약품관리대장' },
      { id: 'log_med_in', label: '약품입고일지' },
      { id: 'log_sludge_out', label: '슬러지반출관리대장' },
      { id: 'log_sludge_photo', label: '슬러지사진대지' }
    ]
  },
  { id: 'board', label: '소통게시판', icon: 'forum' },
];
export const ADMIN_MENUS = [
  { id: 'members', label: '회원 및 현장 관리', icon: 'admin_panel_settings' },
  { id: 'settings', label: '설정', icon: 'settings' },
];

export const TAB_LABELS = {
  dashboard: '대시보드',
  flow: '유량관리',
  medicine: '약품관리',
  water: '수질분석',
  kit: '분석키트관리',
  certificate: '성적서',
  facility: '고장·수리이력',
  // TODO: 장비이력카드 탭 레이블 — 장비이력카드 기능 구현 시 활성화
  equipment_card: '장비이력카드',
  log: '일지작성',
  log_daily: '일일업무일지',
  log_water: '수질분석일지',
  log_med_mgmt: '약품관리대장',
  log_med_in: '약품입고일지',
  log_sludge_out: '슬러지반출관리대장',
  log_sludge_photo: '슬러지사진대지',
  board: '소통게시판',
  members: '회원 및 현장 관리',
  myinfo: '내 정보 수정',
  settings: '환경설정',
  attendance: '출석관리',
};

export const DEFAULT_TAB = 'dashboard';

export const ADMIN_ROLES = ['admin', 'group_admin'];

export const getTodayKST = () => {
  const kstDate = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
  return kstDate.toISOString().split('T')[0];
};

export const getToday = () => new Date().toISOString().split('T')[0];
