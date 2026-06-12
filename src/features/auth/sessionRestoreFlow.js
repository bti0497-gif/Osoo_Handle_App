import { AuthModel } from './AuthModel';
import { getCurrentCoords, checkLocationMatched } from './authGeo';
import { isFieldWorker, shouldForceEodLogoutForOpenSession } from './authSessionUtils';

const LOGIN_GEO_CHECK_ENABLED = String(import.meta.env?.VITE_LOGIN_GEO_CHECK_ENABLED || 'false') === 'true';

/**
 * 버전 변경 후 첫 실행인지 확인
 * (Electron에서 업그레이드/재설치 후 이전 세션 복원 방지)
 */
async function isVersionChanged() {
  if (!window.electronAPI) return false;
  try {
    const result = await window.electronAPI.checkVersionChanged();
    if (result.versionChanged) {
      // 마커 삭제
      await window.electronAPI.clearVersionMarker().catch(() => {});
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[세션 복원] 버전 체크 실패:', err);
    return false;
  }
}

/**
 * 저장된 세션으로 자격 재검증·출석 보강까지 수행합니다.
 * UI 상태(setState)는 호출측에서 처리합니다.
 *
 * @returns {Promise<{ outcome: 'none' } | { outcome: 'cleared' } | { outcome: 'ok', user: object, field: boolean }>}
 */
export async function runStoredSessionRestore() {
    // 버전 변경 후 첫 실행 → 이전 세션 복원 금지
    const versionChanged = await isVersionChanged();
    if (versionChanged) {
        console.log('[세션 복원] 버전 변경 감지 → 새로운 로그인 필요');
        AuthModel.clearSession();
        return { outcome: 'none' };
    }

    const savedUser = AuthModel.loadSession();
    if (!savedUser || !savedUser.id) {
        return { outcome: 'none' };
    }

    const freshData = await AuthModel.localLogin(savedUser.name, savedUser.password);
    if (!freshData) {
        AuthModel.clearSession();
        return { outcome: 'cleared' };
    }

    const activeSession = await AuthModel.findActiveSession(freshData.id);
    const field = isFieldWorker(freshData);

    if (field && activeSession && shouldForceEodLogoutForOpenSession(activeSession.login_time)) {
        try {
            await AuthModel.recordLogout(freshData, true);
        } catch (err) {
            console.error('[세션 복원] 자동 퇴근 처리 실패:', err);
        }
        try {
            await AuthModel.syncAttendanceBQ();
        } catch (err) {
            console.error('[세션 복원] BigQuery 동기화 실패:', err);
        }
        AuthModel.clearSession();
        return { outcome: 'cleared' };
    }

    const restoredUser = {
        ...freshData,
        isRemote: savedUser.isRemote ?? false,
    };

    if (field && !activeSession) {
        try {
            const coords = LOGIN_GEO_CHECK_ENABLED ? await getCurrentCoords() : null;
            const lat = coords?.latitude || null;
            const lng = coords?.longitude || null;
            const matched = LOGIN_GEO_CHECK_ENABLED ? checkLocationMatched(freshData, coords) : true;
            await AuthModel.recordAttendance(freshData, lat, lng, matched);
            restoredUser.isRemote = LOGIN_GEO_CHECK_ENABLED ? !matched : false;
        } catch (attErr) {
            console.warn('세션 복원 중 출석 기록 실패:', attErr.message);
        }
    }

    AuthModel.saveSession(restoredUser);
    return { outcome: 'ok', user: restoredUser, field };
}
