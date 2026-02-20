/**
 * 앱 전역 상수 정의
 * 메뉴 구조, 탭 라벨 등 여러 컴포넌트에서 공유하는 값들을 한 곳에서 관리합니다.
 */

export const MENUS = [
  { id: 'flow', label: '유량관리', icon: 'water_damage' },
  { id: 'medicine', label: '약품관리', icon: 'science' },
  { id: 'water', label: '수질관리', icon: 'opacity' },
  { id: 'facility', label: '시설관리', icon: 'construction' },
  { id: 'log', label: '일지작성', icon: 'edit_note' },
  { id: 'board', label: '소통게시판', icon: 'forum' },
];

export const ADMIN_MENUS = [
  { id: 'members', label: '회원 및 현장 관리', icon: 'admin_panel_settings' },
  { id: 'settings', label: '설정', icon: 'settings' },
];

export const TAB_LABELS = {
  flow: '유량관리',
  medicine: '약품관리',
  water: '수질관리',
  facility: '시설관리',
  log: '일지작성',
  board: '소통게시판',
  members: '회원 및 현장 관리',
  myinfo: '내 정보 수정',
  settings: '환경설정',
  attendance: '출석관리',
};

export const DEFAULT_TAB = 'flow';

export const ADMIN_ROLES = ['admin', 'group_admin'];

export const getTodayKST = () => {
  const kstDate = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
  return kstDate.toISOString().split('T')[0];
};

export const getToday = () => new Date().toISOString().split('T')[0];
