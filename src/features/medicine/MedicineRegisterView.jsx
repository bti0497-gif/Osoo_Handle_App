import React from 'react';
import { useMedicineRegisterViewModel } from './useMedicineRegisterViewModel';

const panelStyle = {
  display: 'flex',
  width: '100%',
  height: '100%',
  backgroundColor: '#ffffff',
  padding: '1.25rem',
  gap: '1.25rem',
};

const leftPanelStyle = {
  width: '280px',
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
};

const rightPanelStyle = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
};

const cardStyle = {
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  backgroundColor: '#ffffff',
  padding: '16px',
  boxShadow: '0 1px 2px rgba(15,23,42,0.05)',
};

const selectStyle = {
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid #cbd5e1',
  fontSize: '13px',
  color: '#1e293b',
  backgroundColor: '#ffffff',
  cursor: 'pointer',
};

const labelStyle = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#64748b',
  marginBottom: '6px',
};

const headerCellStyle = {
  position: 'sticky',
  top: 0,
  backgroundColor: '#f8fafc',
  color: '#475569',
  fontSize: '12px',
  fontWeight: 600,
  padding: '10px 12px',
  borderBottom: '1px solid #e2e8f0',
  whiteSpace: 'nowrap',
  textAlign: 'right',
  zIndex: 1,
};

const firstHeaderCellStyle = {
  ...headerCellStyle,
  textAlign: 'left',
  minWidth: '130px',
};

const bodyCellStyle = {
  padding: '9px 12px',
  borderBottom: '1px solid #f1f5f9',
  fontSize: '13px',
  color: '#334155',
  whiteSpace: 'nowrap',
  textAlign: 'right',
};

const firstBodyCellStyle = {
  ...bodyCellStyle,
  textAlign: 'left',
  fontWeight: 500,
  color: '#1e293b',
};

const sectionHeaderStyle = {
  padding: '8px 12px',
  backgroundColor: '#f1f5f9',
  fontSize: '11px',
  fontWeight: 700,
  color: '#475569',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
};

const fmt = (v) => {
  if (v === undefined || v === null) return '-';
  const n = Number(v);
  if (isNaN(n)) return '-';
  if (n === 0) return '0';
  return Number.isInteger(n) ? n.toLocaleString('ko-KR') : n.toFixed(2);
};

export default function MedicineRegisterView({ currentUser }) {
  const {
    year, setYear,
    month, setMonth,
    yearOptions,
    monthOptions,
    data,
    isLoading,
    isExporting,
    error,
    interlockEnabled,
    interlockReason,
    handleExportExcel,
  } = useMedicineRegisterViewModel();

  const medicines = data?.medicines ?? [];
  const extraMedicines = data?.extraMedicines ?? [];
  const kits = data?.kits ?? [];

  return (
    <div style={panelStyle}>
      {/* ── 좌측 패널 ── */}
      <div style={leftPanelStyle}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#1e293b', letterSpacing: '-0.025em', margin: 0 }}>
          약품관리대장
        </h1>

        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#475569' }}>
              연도
              <select style={selectStyle} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#475569' }}>
              월
              <select style={selectStyle} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {monthOptions.map((m) => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* 인터록 상태 */}
        <div style={{ ...cardStyle, backgroundColor: interlockEnabled ? '#f0fdf4' : '#fefce8', border: `1px solid ${interlockEnabled ? '#bbf7d0' : '#fef08a'}` }}>
          <p style={{ fontSize: '12px', fontWeight: 600, color: interlockEnabled ? '#166534' : '#854d0e', marginBottom: 4 }}>
            {interlockEnabled ? '✓ 생성 가능' : '⏸ 생성 대기'}
          </p>
          <p style={{ fontSize: '11px', color: interlockEnabled ? '#15803d' : '#92400e', margin: 0 }}>
            {interlockEnabled
              ? interlockReason || '조건 충족됨'
              : '말일 데이터 입력 완료 또는 지난 달이어야 생성할 수 있습니다.'}
          </p>
        </div>

        {/* 생성하기 버튼 */}
        <button
          onClick={handleExportExcel}
          disabled={!interlockEnabled || isExporting || isLoading}
          style={{
            padding: '10px 0',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: interlockEnabled && !isExporting && !isLoading ? '#0f172a' : '#cbd5e1',
            color: interlockEnabled && !isExporting && !isLoading ? '#ffffff' : '#94a3b8',
            fontSize: '14px',
            fontWeight: 600,
            cursor: interlockEnabled && !isExporting && !isLoading ? 'pointer' : 'not-allowed',
            transition: 'background-color 0.15s',
          }}
        >
          {isExporting ? '생성 중...' : '약품관리대장 생성하기'}
        </button>
      </div>

      {/* ── 우측 패널 ── */}
      <div style={rightPanelStyle}>
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: '#94a3b8', fontSize: '14px' }}>
            데이터 불러오는 중...
          </div>
        ) : error ? (
          <div style={{ ...cardStyle, backgroundColor: '#fef2f2', border: '1px solid #fecaca' }}>
            <p style={{ fontSize: '13px', color: '#b91c1c', margin: 0 }}>{error}</p>
          </div>
        ) : (
          <>
            {/* 현황 요약 */}
            {data && (
              <p style={{ fontSize: '13px', color: '#475569', margin: 0 }}>
                <span style={{ color: '#94a3b8', marginRight: 4 }}>현장명</span>
                <strong style={{ color: '#0f172a', marginRight: 16 }}>{data.siteName || '(미설정)'}</strong>
                <span style={{ color: '#94a3b8', marginRight: 4 }}>대상</span>
                <strong style={{ color: '#0f172a' }}>{data.year}년 {String(data.month).padStart(2, '0')}월</strong>
              </p>
            )}

            {/* 약품 + 키트 통합 테이블 */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', backgroundColor: '#ffffff', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ overflowY: 'auto', flex: 1 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <colgroup>
                    <col style={{ minWidth: '160px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '90px' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={firstHeaderCellStyle}>항목</th>
                      <th style={headerCellStyle}>구매량</th>
                      <th style={headerCellStyle}>사용량</th>
                      <th style={headerCellStyle}>연누계</th>
                      <th style={headerCellStyle}>잔량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* 약품 */}
                    {[...medicines, ...extraMedicines.filter((e) => e.name)].map((item) => (
                      <tr key={item.name}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        style={{ transition: 'background-color 0.1s' }}
                      >
                        <td style={firstBodyCellStyle}>{item.name}</td>
                        <td style={bodyCellStyle}>{fmt(item.purchase)}</td>
                        <td style={bodyCellStyle}>{fmt(item.usage)}</td>
                        <td style={bodyCellStyle}>{fmt(item.yearTotal)}</td>
                        <td style={bodyCellStyle}>{fmt(item.balance)}</td>
                      </tr>
                    ))}
                    {/* 구분 행 */}
                    <tr><td colSpan={5} style={{ padding: '4px 0', borderBottom: '1px solid #e2e8f0' }} /></tr>
                    {/* 키트 */}
                    {kits.map((item) => (
                      <tr key={item.name}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        style={{ transition: 'background-color 0.1s' }}
                      >
                        <td style={firstBodyCellStyle}>{item.name}</td>
                        <td style={bodyCellStyle}>{fmt(item.purchase)}</td>
                        <td style={bodyCellStyle}>{fmt(item.usage)}</td>
                        <td style={bodyCellStyle}>{fmt(item.yearTotal)}</td>
                        <td style={bodyCellStyle}>{fmt(item.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}