const { finalizeDailyRecords } = require('../services/dailyRecordFinalizationService.cjs');
let timer = null;
const kstDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const kstHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(new Date()));
function start({ db, reportDiagnostic, markPending }) {
  if (timer) return;
  const run = () => { if (kstHour() < 20) return; const date = kstDate(); const sites = db.prepare("SELECT DISTINCT site_id, COALESCE(site_name, '') AS site_name FROM attendance WHERE date = ? AND COALESCE(site_id, '') <> ''").all(date); for (const site of sites) { try { const result = finalizeDailyRecords(db, { date, siteId: site.site_id, siteName: site.site_name }); if (result.total) { markPending?.('data-sync'); reportDiagnostic?.({ level: 'info', area: 'daily-record-finalization', action: 'completed', result: 'success', message: '20:00 missing daily records finalized', details: { date, siteId: site.site_id, ...result } }); } } catch (error) { reportDiagnostic?.({ level: 'error', area: 'daily-record-finalization', action: 'failed', result: 'failed', message: error.message, details: { date, siteId: site.site_id } }); } } };
  timer = setInterval(run, 60 * 1000); timer.unref?.(); run();
}
module.exports = { start };
