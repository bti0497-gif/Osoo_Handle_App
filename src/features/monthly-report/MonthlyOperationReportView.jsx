import React from 'react';
import { useMonthlyOperationReportViewModel } from './useMonthlyOperationReportViewModel';

const number = (value) => Number(value || 0).toLocaleString('ko-KR');

export function MonthlyOperationReportView() {
  const vm = useMonthlyOperationReportViewModel();
  const totals = (vm.summary?.rows || []).reduce((sum, row) => ({
    inflow: sum.inflow + Number(row.inflow || 0), outflow: sum.outflow + Number(row.outflow || 0),
    sludge: sum.sludge + Number(row.sludge || 0), glucose: sum.glucose + Number(row.glucose || 0),
    bicarbonate: sum.bicarbonate + Number(row.bicarbonate || 0), coagulant: sum.coagulant + Number(row.coagulant || 0),
  }), { inflow: 0, outflow: 0, sludge: 0, glucose: 0, bicarbonate: 0, coagulant: 0 });
  return <div style={{ display: 'flex', height: '100%', padding: 20, gap: 20, background: '#fff' }}>
    <section style={{ width: 330, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>월운영보고서</h1>
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={vm.year} onChange={(e) => vm.setYear(Number(e.target.value))} style={{ flex: 1, padding: 12 }}>
          {Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 5 + i).map((value) => <option key={value} value={value}>{value}년</option>)}
        </select>
        <select value={vm.month} onChange={(e) => vm.setMonth(Number(e.target.value))} style={{ flex: 1, padding: 12 }}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((value) => <option key={value} value={value}>{value}월</option>)}
        </select>
      </div>
      <p style={{ color: '#64748b', lineHeight: 1.6 }}>기존 엑셀 양식의 서식과 수식을 유지한 채 선택한 달의 자료만 채웁니다.</p>
      {vm.error && <p style={{ color: '#b91c1c' }}>{vm.error}</p>}
      <button type="button" disabled={vm.loading || vm.exporting} onClick={vm.exportReport} style={{ marginTop: 'auto', height: 48, border: 0, borderRadius: 10, background: '#1e293b', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
        {vm.exporting ? '엑셀 생성 중...' : '월운영보고서 생성하기'}
      </button>
    </section>
    <section style={{ flex: 1, maxWidth: 900, border: '1px solid #e2e8f0', borderRadius: 14, padding: 24, background: '#f8fafc' }}>
      <h2 style={{ marginTop: 0 }}>{vm.summary?.siteName || '현장'} {vm.year}년 {vm.month}월</h2>
      {vm.loading ? <p>자료 확인 중...</p> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(150px, 1fr))', gap: 12 }}>
        {[['유입량', totals.inflow], ['방류량', totals.outflow], ['슬러지 반출량', totals.sludge], ['포도당 사용량', totals.glucose], ['중탄산 사용량', totals.bicarbonate], ['응집제 사용량', totals.coagulant]].map(([label, value]) =>
          <div key={label} style={{ padding: 18, borderRadius: 10, background: '#fff', border: '1px solid #e2e8f0' }}><div style={{ color: '#64748b', fontSize: 13 }}>{label}</div><strong style={{ display: 'block', marginTop: 8, fontSize: 20 }}>{number(value)}</strong></div>)}
      </div>}
    </section>
  </div>;
}
