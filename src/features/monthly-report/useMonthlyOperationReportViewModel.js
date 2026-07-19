import { useCallback, useEffect, useState } from 'react';
import { MonthlyOperationReportModel } from './MonthlyOperationReportModel';

export function useMonthlyOperationReportViewModel() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setSummary(await MonthlyOperationReportModel.getSummary(year, month)); }
    catch (err) { setError(err?.message || '월 자료를 불러오지 못했습니다.'); }
    finally { setLoading(false); }
  }, [year, month]);
  useEffect(() => { load(); }, [load]);

  const exportReport = async () => {
    setExporting(true); setError('');
    try { await MonthlyOperationReportModel.export(year, month); }
    catch (err) { setError(err?.message || '월운영보고서를 만들지 못했습니다.'); }
    finally { setExporting(false); }
  };
  return { year, setYear, month, setMonth, summary, loading, exporting, error, exportReport };
}
