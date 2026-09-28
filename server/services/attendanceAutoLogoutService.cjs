'use strict';

let timer = null;

function kstParts(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

function closeDueAttendance(db, now = new Date()) {
  const { date, hour } = kstParts(now);
  return db.prepare(`
    UPDATE attendance
    SET logout_time = '20:00:00', auto_logout = 1, is_synced = 0,
        last_modified = datetime('now', 'localtime')
    WHERE login_time IS NOT NULL AND logout_time IS NULL
      AND (date < ? OR (date = ? AND ? >= 20))
  `).run(date, date, hour).changes;
}

function start({ db, reportDiagnostic, markPending } = {}) {
  if (timer) return;
  const run = () => {
    try {
      const closed = closeDueAttendance(db);
      if (closed > 0) {
        markPending?.('attendance-sync');
        reportDiagnostic?.({
          level: 'info', area: 'auth', action: 'scheduled-attendance-logout', result: 'ok',
          message: '서버가 미퇴근 출결을 20:00 기준으로 마감했습니다.',
          details: { closed },
        });
      }
    } catch (error) {
      reportDiagnostic?.({
        level: 'error', area: 'auth', action: 'scheduled-attendance-logout', result: 'failed',
        message: error.message,
      });
    }
  };
  run();
  timer = setInterval(run, 60 * 1000);
  timer.unref?.();
}

module.exports = { closeDueAttendance, start };
