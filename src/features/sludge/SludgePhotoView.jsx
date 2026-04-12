import React, { useRef } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import '../../styles/calendar-custom.css';
import { useSludgePhotoViewModel } from './useSludgePhotoViewModel';

const toDateStr = (d) => {
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
};

function PhotoButton({ label, hasPhoto, onFile }) {
  const ref = useRef(null);
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        style={{
          padding: '5px 12px',
          borderRadius: 6,
          border: hasPhoto ? '1.5px solid #22c55e' : '1.5px solid #94a3b8',
          background: hasPhoto ? '#f0fdf4' : '#f8fafc',
          color: hasPhoto ? '#16a34a' : '#64748b',
          fontSize: 12,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          whiteSpace: 'nowrap',
        }}
      >
        <span>{hasPhoto ? '✓' : '📷'}</span>
        <span>{label}</span>
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

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

export default function SludgePhotoView() {
  const {
    year, month, selectedDate,
    editEntry, savedItems, activeDates,
    isLoading, isSaving, isExporting, isLedgerExporting, hasChanges,
    handleCalendarMonthChange,
    handleCalendarDayClick,
    handleRowClick,
    handleAmountChange,
    handleSludgePhoto,
    handleCertPhoto,
    handleSave,
    handleDelete,
    handleExport,
    handleLedgerExport,
  } = useSludgePhotoViewModel();

  const calendarValue = selectedDate ? new Date(selectedDate + 'T00:00:00') : null;
  // 선택된 날짜가 기존 저장 항목인지 여부
  const isSavedDate = savedItems.some(i => i.date === selectedDate);
  // 신규 입력 모드: 선택된 날짜가 있고 저장 기록이 없는 경우
  const isNewMode = !!(selectedDate && !isSavedDate);

  // 인라인 편집 폼 공통 스타일
  const inlineFormStyle = {
    padding: '12px 20px',
    background: '#eff6ff',
    borderTop: '1px solid #bfdbfe',
    borderBottom: '1px solid #bfdbfe',
  };

  const amountInput = (borderColor) => ({
    width: 90,
    padding: '6px 10px',
    borderRadius: 6,
    border: `1.5px solid ${borderColor}`,
    fontSize: 13,
    color: '#1e293b',
    background: '#fff',
  });

  const formatTakenAt = (item) => {
    const raw = item.sludge_photo_taken_at || (item.sludge_photo_url ? item.last_modified : null);
    if (!raw) return '-';
    return String(raw).slice(0, 16).replace('T', ' ');
  };

  const renderEditForm = (newEntry) => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>
          반출량 (m³)
        </label>
        <input
          type="number"
          value={editEntry.sludge_amount}
          onChange={e => handleAmountChange(e.target.value)}
          placeholder="0"
          style={amountInput(newEntry ? '#bae6fd' : '#bfdbfe')}
        />
      </div>
      <PhotoButton
        label="반출사진"
        hasPhoto={!!(editEntry.sludgePhotoUrl || editEntry.sludgePhotoFile)}
        onFile={handleSludgePhoto}
      />
      <PhotoButton
        label="청소필증"
        hasPhoto={!!(editEntry.certPhotoUrl || editEntry.certPhotoFile)}
        onFile={handleCertPhoto}
      />
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        {hasChanges && (
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: '6px 14px',
              borderRadius: 7,
              border: 'none',
              background: newEntry ? '#0ea5e9' : '#3b82f6',
              color: '#fff',
              fontWeight: 700,
              fontSize: 12,
              cursor: isSaving ? 'not-allowed' : 'pointer',
              opacity: isSaving ? 0.7 : 1,
            }}
          >
            {isSaving ? '저장 중...' : (newEntry ? '저장' : '수정 저장')}
          </button>
        )}
        {!newEntry && (
          <button
            type="button"
            onClick={handleDelete}
            style={{
              padding: '6px 14px',
              borderRadius: 7,
              border: '1px solid #fca5a5',
              background: '#fff5f5',
              color: '#ef4444',
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            삭제
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ padding: '24px', background: '#f8fafc', minHeight: '100%' }}>
      {/* 페이지 헤더 */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1e293b' }}>
          반출슬러지 사진 관리
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
          {year}년 {month}월
        </p>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

        {/* ── LEFT: 컴팩트 달력 ── */}
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
            날짜를 클릭해 기록을 추가하세요
          </p>
        </div>

        {/* ── RIGHT: 반출 목록 테이블 ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            background: '#fff',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
          }}>

            {/* 테이블 헤더 */}
            <div style={{
              padding: '14px 20px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>
                {year}년 {month}월 반출 목록
                <span style={{ marginLeft: 8, fontSize: 12, color: '#64748b', fontWeight: 400 }}>
                  {isLoading ? '로딩 중...' : `${savedItems.length}건`}
                </span>
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => handleCalendarDayClick(selectedDate || toDateStr(new Date()))}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 7,
                    border: 'none',
                    background: '#3b82f6',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  + 새 반출 추가
                </button>
                <button
                  type="button"
                  onClick={handleLedgerExport}
                  disabled={isLedgerExporting || savedItems.length === 0}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 7,
                    border: '1.5px solid #e2e8f0',
                    background: '#fff',
                    color: '#475569',
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: (isLedgerExporting || savedItems.length === 0) ? 'not-allowed' : 'pointer',
                    opacity: (isLedgerExporting || savedItems.length === 0) ? 0.5 : 1,
                  }}
                >
                  {isLedgerExporting ? '출력 중...' : '반출관리대장 출력'}
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={isExporting || savedItems.length === 0}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 7,
                    border: '1.5px solid #e2e8f0',
                    background: '#fff',
                    color: '#475569',
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: (isExporting || savedItems.length === 0) ? 'not-allowed' : 'pointer',
                    opacity: (isExporting || savedItems.length === 0) ? 0.5 : 1,
                  }}
                >
                  {isExporting ? '출력 중...' : '사진대지 출력'}
                </button>
              </div>
            </div>

            {/* 신규 입력 폼 (저장 기록 없는 날짜 선택 시) */}
            {isNewMode && (
              <div style={{
                padding: '14px 20px',
                background: '#f0f9ff',
                borderBottom: '1px solid #bae6fd',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0369a1', marginBottom: 12 }}>
                  ✚ {editEntry.date} — 신규 반출 등록
                </div>
                {renderEditForm(true)}
              </div>
            )}

            {/* 빈 상태 */}
            {savedItems.length === 0 && !isLoading && (
              <div style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: '#94a3b8',
                fontSize: 13,
              }}>
                저장된 반출 기록이 없습니다.
              </div>
            )}

            {/* 테이블 본문 */}
            {savedItems.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>날짜</th>
                      <th style={th}>반출량 (m³)</th>
                      <th style={th}>반출사진</th>
                      <th style={th}>청소필증</th>
                      <th style={th}>촬영시각</th>
                      <th style={th}>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedItems.map(item => {
                      const isSelected = item.date === selectedDate;
                      const rowBg = isSelected ? '#eff6ff' : '#fff';
                      return (
                        <React.Fragment key={item.date}>
                          <tr
                            onClick={() => handleRowClick(item.date)}
                            style={{ background: rowBg, cursor: 'pointer', transition: 'background 0.1s' }}
                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f8fafc'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
                          >
                            <td style={{
                              ...td,
                              fontWeight: isSelected ? 700 : 400,
                              color: isSelected ? '#1d4ed8' : '#334155',
                            }}>
                              {item.date}
                            </td>
                            <td style={td}>
                              {item.sludge_amount != null ? `${item.sludge_amount} m³` : '-'}
                            </td>
                            <td style={{ ...td, color: item.sludge_photo_url ? '#16a34a' : '#94a3b8' }}>
                              {item.sludge_photo_url ? '✓ 있음' : '-'}
                            </td>
                            <td style={{ ...td, color: item.certificate_photo_url ? '#16a34a' : '#94a3b8' }}>
                              {item.certificate_photo_url ? '✓ 있음' : '-'}
                            </td>
                            <td style={td}>
                              {formatTakenAt(item)}
                            </td>
                            <td style={td}>{item.note || '-'}</td>
                          </tr>

                          {/* 인라인 편집 폼 — 행 클릭 시 펼침 */}
                          {isSelected && (
                            <tr>
                              <td colSpan={6} style={{ padding: 0 }}>
                                <div style={inlineFormStyle}>
                                  {renderEditForm(false)}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
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
