import React from 'react';

const summaryCardStyle = {
    border: '1px solid #edebe9',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    padding: '14px 16px',
    minHeight: '78px',
};

const formatNumber = (value) => new Intl.NumberFormat('ko-KR').format(Number(value || 0));

function buildSummaryRows(dashboardSummary, dashboardType) {
    const rangeNote = dashboardSummary.selectedDateCount > 1
        ? `${formatNumber(dashboardSummary.selectedDateCount)}일간`
        : '단일일자';

    if (dashboardType === 'daily-work-log') {
        const issueText = dashboardSummary.issueDateCount > 0
            ? `누락 ${formatNumber(dashboardSummary.issueDateCount)}일`
            : '이상없음';

        return [
            { id: 'date', category: '날짜', content: dashboardSummary.selectedDateLabel, note: rangeNote },
            { id: 'sheet', category: '대상시트', content: `${formatNumber(dashboardSummary.totalSheetCount)}개`, note: '날짜당1개' },
            { id: 'flow', category: '유량데이터', content: `${formatNumber(dashboardSummary.totalFlowDataDates)}/${formatNumber(dashboardSummary.selectedDateCount)}일`, note: '5계통' },
            { id: 'aggregate', category: '월간/연간', content: `${formatNumber(dashboardSummary.totalAggregateDataDates)}/${formatNumber(dashboardSummary.selectedDateCount)}일`, note: '자동계산' },
            { id: 'material', category: '약품·키트', content: `${formatNumber(dashboardSummary.totalMaterialDataDates)}/${formatNumber(dashboardSummary.selectedDateCount)}일`, note: '자재반영' },
            { id: 'power', category: '전력', content: `${formatNumber(dashboardSummary.totalPowerDataDates)}/${formatNumber(dashboardSummary.selectedDateCount)}일`, note: '사용량' },
            { id: 'issue', category: '이상유무', content: issueText, note: dashboardSummary.issueDateCount > 0 ? '입력확인' : '' },
        ];
    }

    const photoGap = Math.max(0, (dashboardSummary.expectedPhotoCount || 0) - (dashboardSummary.totalPhotoCount || 0));
    const issueText = photoGap > 0 ? `사진 누락 ${formatNumber(photoGap)}건` : '이상없음';

    return [
        { id: 'date', category: '날짜', content: dashboardSummary.selectedDateLabel, note: rangeNote },
        { id: 'sheet', category: '대상시트', content: `${formatNumber(dashboardSummary.totalSheetCount)}개`, note: '' },
        { id: 'experiment', category: '수질데이터', content: `총 ${formatNumber(dashboardSummary.totalExperimentCount)}개`, note: '' },
        { id: 'photo', category: '분석사진', content: `${formatNumber(dashboardSummary.totalPhotoCount)}개`, note: '' },
        { id: 'issue', category: '이상유무', content: issueText, note: photoGap > 0 ? '생성 전 확인' : '' },
    ];
}

const tableWrapStyle = {
    border: '1px solid #edebe9',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
};

const headerCellStyle = {
    position: 'sticky',
    top: 0,
    backgroundColor: '#faf9f8',
    color: '#323130',
    fontSize: '12px',
    fontWeight: 600,
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: '1px solid #edebe9',
    whiteSpace: 'nowrap',
    zIndex: 1,
};

const bodyCellStyle = {
    padding: '9px 12px',
    borderBottom: '1px solid #f3f2f1',
    fontSize: '12px',
    color: '#323130',
    whiteSpace: 'nowrap',
};

const excelSectionStyle = {
    border: '2px solid #2f2f2f',
    backgroundColor: '#ffffff',
};

const excelTitleCellStyle = {
    padding: '10px 14px',
    fontSize: '15px',
    fontWeight: 700,
    color: '#111827',
    borderBottom: '2px solid #2f2f2f',
    backgroundColor: '#ffffff',
};

const excelHeaderCellStyle = {
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: 700,
    color: '#111827',
    borderRight: '1px solid #2f2f2f',
    borderBottom: '1px solid #2f2f2f',
    backgroundColor: '#ffffff',
    textAlign: 'center',
    whiteSpace: 'nowrap',
};

const excelBodyCellStyle = {
    padding: '8px 12px',
    fontSize: '12px',
    color: '#111827',
    borderRight: '1px solid #2f2f2f',
    borderBottom: '1px solid #2f2f2f',
    backgroundColor: '#ffffff',
    whiteSpace: 'nowrap',
};

const excelStatusCellStyle = {
    ...excelBodyCellStyle,
    whiteSpace: 'nowrap',
};

// 이 폭 기준은 수질분석일지 대시보드에서 사용자와 함께 확정한 값이다.
// 다른 일지 화면도 같은 표 톤을 재사용할 예정이므로 임의 수정하지 말고,
// 반드시 실제 패널 폭/스크린샷 기준으로 함께 조정해야 한다.
const DASHBOARD_LAYOUT_SPEC = Object.freeze({
    waterAnalysis: Object.freeze({
        summary: Object.freeze({
            labelColumnWidth: '120px',
            noteColumnWidth: '84px',
        }),
        dateStatus: Object.freeze({
            columns: Object.freeze([
                Object.freeze({ id: 'date', label: '날짜', width: '120px', align: 'left' }),
                Object.freeze({ id: 'sheetCount', label: '시트 수', width: '70px', align: 'center' }),
                Object.freeze({ id: 'experimentCount', label: '실험데이터', width: '92px', align: 'center' }),
                Object.freeze({ id: 'photoCount', label: '사진 수', width: '70px', align: 'center' }),
                Object.freeze({ id: 'status', label: '상태', width: '118px', align: 'left' }),
            ]),
        }),
    }),
    dailyWorkLog: Object.freeze({
        summary: Object.freeze({
            labelColumnWidth: '120px',
            noteColumnWidth: '82px',
        }),
        dateStatus: Object.freeze({
            columns: Object.freeze([
                Object.freeze({ id: 'date', label: '날짜', width: '120px', align: 'left' }),
                Object.freeze({ id: 'sheetCount', label: '시트', width: '58px', align: 'center' }),
                Object.freeze({ id: 'flowStatus', label: '유량', width: '72px', align: 'center' }),
                Object.freeze({ id: 'aggregateStatus', label: '월/연간', width: '84px', align: 'center' }),
                Object.freeze({ id: 'powerStatus', label: '전력', width: '70px', align: 'center' }),
                Object.freeze({ id: 'status', label: '상태', width: '96px', align: 'center' }),
            ]),
        }),
    }),
});

function getDashboardLayout(dashboardType) {
    return dashboardType === 'daily-work-log'
        ? DASHBOARD_LAYOUT_SPEC.dailyWorkLog
        : DASHBOARD_LAYOUT_SPEC.waterAnalysis;
}

function parsePixelWidth(value, key) {
    if (typeof value !== 'string' || !/^\d+px$/.test(value)) {
        throw new Error(`DailyLogStatusDashboard layout spec 오류: ${key}는 px 문자열이어야 합니다.`);
    }

    return Number(value.replace('px', ''));
}

function validateDashboardLayoutSpec() {
    Object.entries(DASHBOARD_LAYOUT_SPEC).forEach(([specKey, spec]) => {
        const summaryLabelWidth = parsePixelWidth(spec.summary.labelColumnWidth, `${specKey}.summary.labelColumnWidth`);
        const noteColumnWidth = parsePixelWidth(spec.summary.noteColumnWidth, `${specKey}.summary.noteColumnWidth`);
        const dateColumnWidth = parsePixelWidth(spec.dateStatus.columns[0].width, `${specKey}.dateStatus.columns[0].width`);
        const statusColumnWidth = parsePixelWidth(spec.dateStatus.columns[spec.dateStatus.columns.length - 1].width, `${specKey}.dateStatus.statusColumnWidth`);
        const middleWidths = spec.dateStatus.columns
            .slice(1, spec.dateStatus.columns.length - 1)
            .reduce((sum, column, index) => sum + parsePixelWidth(column.width, `${specKey}.dateStatus.columns[${index + 1}].width`), 0);

        if (summaryLabelWidth !== dateColumnWidth) {
            throw new Error(`DailyLogStatusDashboard layout spec 오류: ${specKey}의 상단 구분 열과 하단 날짜 열 폭은 반드시 같아야 합니다.`);
        }

        if (noteColumnWidth >= 120 || statusColumnWidth >= 140) {
            throw new Error(`DailyLogStatusDashboard layout spec 오류: ${specKey}의 비고/상태 열이 패널 기준 폭을 초과합니다.`);
        }

        if (middleWidths >= 300) {
            throw new Error(`DailyLogStatusDashboard layout spec 오류: ${specKey}의 날짜별 현황 중간 열 폭 합계가 너무 큽니다.`);
        }
    });
}

validateDashboardLayoutSpec();

const renderStatusPill = (value) => {
    const isReady = value === '생성 준비';
    const isReview = value === '사진 확인';
    const isMissing = value === '사진 없음' || value === '데이터 없음';

    return (
        <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: '68px',
            padding: '4px 10px',
            borderRadius: '999px',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: isReady ? '#0b6a0b' : isReview ? '#8a5d00' : isMissing ? '#a4262c' : '#004578',
            backgroundColor: isReady ? '#dff6dd' : isReview ? '#fff4ce' : isMissing ? '#fde7e9' : '#deecf9',
            border: 'none',
        }}>
            {value}
        </span>
    );
};

const SimpleTable = ({ title, description, columns, rows, emptyMessage = '표시할 데이터가 없습니다.' }) => {
    return (
        <div style={tableWrapStyle}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #edebe9', backgroundColor: '#ffffff' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: '18px', fontWeight: 600, color: '#201f1e' }}>{title}</div>
                    {description ? <div style={{ fontSize: '12px', fontWeight: 400, color: '#605e5c' }}>{description}</div> : null}
                </div>
            </div>
            <div style={{ overflow: 'auto', minHeight: 0, flex: 1 }} className="dailylog-dashboard-scroll">
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: '100%' }}>
                    <thead>
                        <tr>
                            {columns.map((column) => (
                                <th key={column.id} style={headerCellStyle}>{column.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length ? rows.map((row, index) => (
                            <tr key={row.id || `${title}-${index}`} style={{ backgroundColor: index % 2 === 0 ? '#ffffff' : '#faf9f8' }}>
                                {columns.map((column) => (
                                    <td key={column.id} style={bodyCellStyle}>
                                        {column.render ? column.render(row[column.id], row) : (row[column.id] ?? '-')}
                                    </td>
                                ))}
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan={columns.length} style={{ ...bodyCellStyle, textAlign: 'center', color: '#94a3b8', padding: '18px 12px' }}>
                                    {emptyMessage}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const ExcelSummaryTable = ({ title, rows, dashboardType }) => {
    const layout = getDashboardLayout(dashboardType);

    return (
        <div style={excelSectionStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup>
                    <col style={{ width: layout.summary.labelColumnWidth }} />
                    <col />
                    <col style={{ width: layout.summary.noteColumnWidth }} />
                </colgroup>
                <tbody>
                    <tr>
                        <td colSpan={3} style={excelTitleCellStyle}>{title}</td>
                    </tr>
                    <tr>
                        <td style={excelHeaderCellStyle}>구분</td>
                        <td style={excelHeaderCellStyle}>내용</td>
                        <td style={{ ...excelHeaderCellStyle, borderRight: 'none' }}>비고</td>
                    </tr>
                    {rows.map((row, index) => {
                        const isLast = index === rows.length - 1;
                        return (
                            <tr key={row.id}>
                                <td style={{ ...excelBodyCellStyle, borderBottom: isLast ? 'none' : excelBodyCellStyle.borderBottom }}>{row.category}</td>
                                <td style={{ ...excelBodyCellStyle, borderBottom: isLast ? 'none' : excelBodyCellStyle.borderBottom }}>{row.content}</td>
                                <td style={{ ...excelBodyCellStyle, borderRight: 'none', borderBottom: isLast ? 'none' : excelBodyCellStyle.borderBottom }}>{row.note || ''}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

const ExcelDateStatusTable = ({ rows, dashboardType }) => {
    const layout = getDashboardLayout(dashboardType);
    const columns = layout.dateStatus.columns;

    return (
        <div style={excelSectionStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup>
                    {columns.map((column) => (
                        <col key={column.id} style={{ width: column.width }} />
                    ))}
                </colgroup>
                <tbody>
                    <tr>
                        <td colSpan={columns.length} style={excelTitleCellStyle}>날짜별 현황</td>
                    </tr>
                    <tr>
                        {columns.map((column, index) => (
                            <td
                                key={column.id}
                                style={{
                                    ...excelHeaderCellStyle,
                                    borderRight: index === columns.length - 1 ? 'none' : excelHeaderCellStyle.borderRight,
                                }}
                            >
                                {column.label}
                            </td>
                        ))}
                    </tr>
                    {rows.length ? rows.map((row, index) => {
                        const isLast = index === rows.length - 1;
                        return (
                            <tr key={row.id}>
                                {columns.map((column, columnIndex) => {
                                    const rawValue = row[column.id];
                                    const value = typeof rawValue === 'number' ? formatNumber(rawValue) : (rawValue || '-');
                                    const baseStyle = column.id === 'status' ? excelStatusCellStyle : excelBodyCellStyle;

                                    return (
                                        <td
                                            key={column.id}
                                            style={{
                                                ...baseStyle,
                                                textAlign: column.align || 'left',
                                                borderRight: columnIndex === columns.length - 1 ? 'none' : baseStyle.borderRight,
                                                borderBottom: isLast ? 'none' : baseStyle.borderBottom,
                                            }}
                                        >
                                            {value}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    }) : (
                        <tr>
                            <td colSpan={columns.length} style={{ ...excelBodyCellStyle, borderRight: 'none', borderBottom: 'none', textAlign: 'center', color: '#6b7280' }}>표시할 데이터가 없습니다.</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};

const DailyLogStatusDashboard = ({
    title,
    dashboardSummary,
    dashboardDateRows,
    dashboardRows,
    isLoading,
    manifestError,
}) => {
    const dashboardType = dashboardSummary.dashboardType || 'water-analysis';
    const isDailyWorkLogDashboard = dashboardType === 'daily-work-log';
    const summaryRows = buildSummaryRows(dashboardSummary, dashboardType);
    const sheetColumns = [
        { id: 'date', label: '날짜' },
        { id: 'sheetLabel', label: '시트' },
        { id: 'measurementOrder', label: '차수' },
        { id: 'groupLabel', label: '측정 그룹' },
        { id: 'rowCount', label: '실험데이터' },
        { id: 'locationCount', label: '지점 수' },
        { id: 'photoStatus', label: '사진', render: (value) => renderStatusPill(value) },
        { id: 'totalPagesForDate', label: '당일 시트' },
        { id: 'status', label: '생성 판단', render: (value) => renderStatusPill(value) },
    ];

    return (
        <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
            border: '1px solid #edebe9',
            borderRadius: '8px',
            backgroundColor: '#f5f5f5',
            fontFamily: '"Segoe UI", "Apple SD Gothic Neo", sans-serif',
        }}>
            <div style={{
                padding: '16px 20px 14px',
                borderBottom: '1px solid #edebe9',
                backgroundColor: '#ffffff',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#201f1e' }}>
                            {title} 생성 대시보드
                        </h2>
                        <div style={{ marginTop: '6px', fontSize: '13px', fontWeight: 600, color: '#605e5c' }}>
                            선택 날짜: {dashboardSummary.selectedDateLabel}
                        </div>
                    </div>
                    <div style={{
                        padding: '8px 10px',
                        borderRadius: '999px',
                        backgroundColor: isLoading ? '#deecf9' : '#f3f2ff',
                        color: isLoading ? '#004578' : '#5c2e91',
                        fontWeight: 600,
                        fontSize: '12px',
                        whiteSpace: 'nowrap',
                    }}>
                        {isLoading ? '현황 집계 중...' : '생성 전 점검 완료'}
                    </div>
                </div>
            </div>

            <div style={{ padding: '16px 18px 18px', display: 'grid', gap: '16px', minHeight: 0, flex: 1, overflowY: 'auto', overflowX: 'hidden' }} className="dailylog-dashboard-scroll">
                <ExcelSummaryTable title="일지 현황" rows={summaryRows} dashboardType={dashboardType} />
                <ExcelDateStatusTable rows={dashboardDateRows} dashboardType={dashboardType} />
                {!isDailyWorkLogDashboard ? (
                    <div style={{ minHeight: 0, overflow: 'hidden' }}>
                        {manifestError ? (
                            <div style={{
                                minHeight: '220px',
                                border: '1px solid #f3d6d8',
                                borderRadius: '8px',
                                backgroundColor: '#fff4f4',
                                color: '#a4262c',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '20px',
                                textAlign: 'center',
                                fontWeight: 600,
                            }}>
                                {manifestError}
                            </div>
                        ) : (
                            <SimpleTable
                                title="시트별 생성 상태"
                                description="생성 전 시트별 상태 점검"
                                columns={sheetColumns}
                                rows={dashboardRows}
                            />
                        )}
                    </div>
                ) : manifestError ? (
                        <div style={{
                            minHeight: '220px',
                            border: '1px solid #f3d6d8',
                            borderRadius: '8px',
                            backgroundColor: '#fff4f4',
                            color: '#a4262c',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '20px',
                            textAlign: 'center',
                            fontWeight: 600,
                        }}>
                            {manifestError}
                        </div>
                ) : null}
            </div>

            <style>{`
                .dailylog-dashboard-scroll::-webkit-scrollbar {
                    width: 10px;
                    height: 10px;
                }
                .dailylog-dashboard-scroll::-webkit-scrollbar-track {
                    background: #f3f2f1;
                }
                .dailylog-dashboard-scroll::-webkit-scrollbar-thumb {
                    background: #c8c6c4;
                    border-radius: 999px;
                    border: 2px solid #f3f2f1;
                }
                .dailylog-dashboard-scroll::-webkit-scrollbar-thumb:hover {
                    background: #a19f9d;
                }
            `}</style>
        </div>
    );
};

export default DailyLogStatusDashboard;