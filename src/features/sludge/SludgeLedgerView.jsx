import React from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import '../../styles/calendar-custom.css';
import { useSludgeLedgerViewModel } from './useSludgeLedgerViewModel';

const th = {
  padding: '8px 12px',
  fontSize: 11,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#475569',
  borderBottom: '2px solid #e2e8f0',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  background: '#f8fafc',
};

const td = {
  padding: '9px 12px',
  fontSize: 12,
  color: '#334155',
  borderBottom: '1px solid #f1f5f9',
  whiteSpace: 'nowrap',
};

const toDateStr = (d) => {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
};

function formatTime(item) {
  const raw = item?.sludge_photo_taken_at || item?.last_modified;
  if (!raw) return '-';
  return String(raw).slice(11, 16);
}

export default function SludgeLedgerView() {
  const {
    year,
    month,
    selectedDate,
    siteName,
    companyName,
    items,
    activeDates,
    summary,
    isLoading,
    isExporting,
    handleCalendarMonthChange,
    handleCalendarDayClick,
    handleExport,
  } = useSludgeLedgerViewModel();

  const calendarValue = selectedDate ? new Date(selectedDate + 'T00:00:00') : null;

  return (
    <div style={{ padding: '24px', background: '#f8fafc', minHeight: '100%' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1e293b' }}>
          슬러지반출관리대장
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
          {year}년 {month}월
        </p>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ width: 220, flexShrink: 0 }}>
          <div style={{
            background: '#fff',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            padding: '12px 10px',
          }}>
            <Calendar
              calendarType="gregory"
              locale="ko-KR"
              formatDay={(locale, d) => d.getDate()}
              next2Label={null}
              prev2Label={null}
              value={calendarValue}
              className="custom-calendar"
              onActiveStartDateChange={handleCalendarMonthChange}
              onClickDay={(date) => handleCalendarDayClick(toDateStr(date))}
              tileClassName={({ date }) => {
                const ds = toDateStr(date);
                if (ds === selectedDate) return 'react-calendar__tile--active';
                if (activeDates.has(ds)) return 'react-calendar__tile--saved';
                return null;
              }}
            />
          </div>
          <p style={{
            margin: '8px 0 0',
            fontSize: 11,
            color: '#94a3b8',
            textAlign: 'center',
            lineHeight: 1.5,
          }}>
            월을 선택하면 해당 월 반출 현황을 조회합니다
          </p>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            background: '#fff',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '14px 20px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>
                  {year}년 {month}월 반출 현황
                </span>
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  현장명: {siteName || '-'} | 기본업체명: {companyName || '-'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleExport}
                disabled={isExporting || items.length === 0}
                style={{
                  padding: '6px 14px',
                  borderRadius: 7,
                  border: '1.5px solid #e2e8f0',
                  background: '#fff',
                  color: '#475569',
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: (isExporting || items.length === 0) ? 'not-allowed' : 'pointer',
                  opacity: (isExporting || items.length === 0) ? 0.5 : 1,
                }}
              >
                {isExporting ? '출력 중...' : '관리대장출력'}
              </button>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              padding: '12px 20px',
              borderBottom: '1px solid #f1f5f9',
              background: '#fcfdff',
            }}>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>반출 데이터 수</div>
                <div style={{ fontSize: 20, color: '#0f172a', fontWeight: 800 }}>{summary.recordCount}건</div>
              </div>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>총 반출량</div>
                <div style={{ fontSize: 20, color: '#0f172a', fontWeight: 800 }}>{summary.totalAmount.toFixed(1)} m³</div>
              </div>
            </div>

            {items.length === 0 && !isLoading && (
              <div style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: '#94a3b8',
                fontSize: 13,
              }}>
                해당 월에 저장된 반출 데이터가 없습니다.
              </div>
            )}

            {items.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>날짜</th>
                      <th style={th}>업체명</th>
                      <th style={th}>반출시각</th>
                      <th style={th}>반출량 (m³)</th>
                      <th style={th}>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.date}>
                        <td style={td}>{item.date}</td>
                        <td style={td}>{companyName || '-'}</td>
                        <td style={td}>{formatTime(item)}</td>
                        <td style={td}>{item.sludge_amount != null ? Number(item.sludge_amount).toFixed(1) : '-'}</td>
                        <td style={{ ...td, color: item.sludge_amount != null ? '#059669' : '#94a3b8', fontWeight: 700 }}>
                          {item.sludge_amount != null ? '반출기록 있음' : '미입력'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
