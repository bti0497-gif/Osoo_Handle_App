import { ADMIN_ROLES, FIELD_WORKER_AUTO_LOGOUT_HOUR_KST } from '../../core/constants';

export function isFieldWorker(member) {
    return !ADMIN_ROLES.includes(String(member?.role || 'user'));
}

export function isKstAtOrPastAutoLogoutHour(date = new Date()) {
    const hourStr = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        hour12: false,
    }).format(date);
    const hour = parseInt(hourStr, 10);
    return hour >= FIELD_WORKER_AUTO_LOGOUT_HOUR_KST;
}

export function msUntilKstTodayAutoLogout(now = new Date()) {
    const d = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
    const h = String(FIELD_WORKER_AUTO_LOGOUT_HOUR_KST).padStart(2, '0');
    const deadline = Date.parse(`${d}T${h}:00:00+09:00`);
    return deadline - now.getTime();
}

export function shouldForceEodLogoutForOpenSession(loginTimeIso) {
    if (!loginTimeIso) return false;
    const login = new Date(loginTimeIso);
    const now = new Date();
    if (!isKstAtOrPastAutoLogoutHour(now)) return false;

    const loginDateKst = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(login);
    const todayKst = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
    if (loginDateKst !== todayKst) return false;

    const loginHour = parseInt(
        new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Seoul',
            hour: '2-digit',
            hour12: false,
        }).format(login),
        10
    );
    const loginMin = parseInt(
        new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Seoul',
            minute: '2-digit',
        }).format(login),
        10
    );
    const loginMinutes = loginHour * 60 + loginMin;
    const cutoffMinutes = FIELD_WORKER_AUTO_LOGOUT_HOUR_KST * 60;
    return loginMinutes < cutoffMinutes;
}
