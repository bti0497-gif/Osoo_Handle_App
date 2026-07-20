import React, { useEffect, useState } from 'react';
import { useDashboardViewModel } from './useDashboardViewModel';
import FlowTrendWidget from './widgets/FlowTrendWidget';
import WaterQualityWidget from './widgets/WaterQualityWidget';
import InventoryLevelWidget from './widgets/InventoryLevelWidget';

const WidgetError = ({ message, onRetry }) => message ? (
    <div role="alert" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        marginBottom: 8, padding: '9px 11px', borderRadius: 9,
        background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: '0.78rem', fontWeight: 800,
    }}>
        <span>이 위젯만 조회하지 못했습니다. 다른 위젯은 계속 사용할 수 있습니다.</span>
        <button type="button" onClick={onRetry} style={{
            border: '1px solid #fdba74', background: '#fff', color: '#9a3412', borderRadius: 7,
            padding: '5px 9px', fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap',
        }}>다시 시도</button>
    </div>
) : null;

const DashboardView = ({ currentUser }) => {
    const [isFlowWidgetOpen, setIsFlowWidgetOpen] = useState(() => {
        try {
            const saved = window.localStorage.getItem('dashboard.flowWidgetOpen');
            if (saved === null) return true;
            return saved === 'true';
        } catch {
            return true;
        }
    });
    const {
        loading,
        visibleSeries,
        chartWindow,
        toggleSeries,
        goPastWeek,
        goFutureWeek,
        waterWidgetRows,
        waterSummary,
        medicineRows,
        kitRows,
        medicineDefaults,
        kitDefaults,
        widgetErrors,
        refresh,
    } = useDashboardViewModel(currentUser);

    useEffect(() => {
        try {
            window.localStorage.setItem('dashboard.flowWidgetOpen', String(isFlowWidgetOpen));
        } catch {
            // 저장소 접근 불가 환경에서는 메모리 상태만 사용
        }
    }, [isFlowWidgetOpen]);

    return (
        <div className="dashboard-view">
            <div className="dashboard-view__stack">
                <div className="dashboard-view__widget-wrap">
                    <WidgetError message={widgetErrors.flow} onRetry={refresh} />
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, backgroundColor: '#ffffff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.55rem 0.25rem' }}>
                            <span style={{ fontSize: '0.82rem', color: '#334155', fontWeight: 800 }}>
                                유량/전력 변화 위젯
                            </span>
                            <button
                                onClick={() => setIsFlowWidgetOpen((prev) => !prev)}
                                style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 8,
                                    border: '1px solid #cbd5e1',
                                    backgroundColor: '#f8fafc',
                                    color: '#334155',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '0.95rem',
                                    fontWeight: 900,
                                }}
                                title={isFlowWidgetOpen ? '유량 위젯 접기' : '유량 위젯 펼치기'}
                                aria-label={isFlowWidgetOpen ? '유량 위젯 접기' : '유량 위젯 펼치기'}
                            >
                                {isFlowWidgetOpen ? '▲' : '▼'}
                            </button>
                        </div>

                        {isFlowWidgetOpen && (
                            <div style={{ padding: '0.15rem 0.55rem 0.6rem' }}>
                                <FlowTrendWidget
                                    rows={chartWindow.rows}
                                    visibleSeries={visibleSeries}
                                    onToggleSeries={toggleSeries}
                                    rangeText={chartWindow.rangeText}
                                    canGoPast={chartWindow.canGoPast}
                                    canGoFuture={chartWindow.canGoFuture}
                                    onGoPast={goPastWeek}
                                    onGoFuture={goFutureWeek}
                                />
                            </div>
                        )}
                    </div>
                </div>

                <div className="dashboard-view__widget-wrap">
                    <WidgetError message={widgetErrors.water} onRetry={refresh} />
                    <WaterQualityWidget rows={waterWidgetRows} summary={waterSummary} />
                </div>
                <div className="dashboard-view__widget-wrap">
                    <WidgetError message={widgetErrors.inventory} onRetry={refresh} />
                    <InventoryLevelWidget
                        medicineRows={medicineRows}
                        kitRows={kitRows}
                        medicineDefaults={medicineDefaults}
                        kitDefaults={kitDefaults}
                    />
                </div>
            </div>

            {loading && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(255,255,255,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 30
                }}>
                    <div style={{ backgroundColor: '#0f172a', color: '#fff', borderRadius: 9999, padding: '0.65rem 1rem', fontSize: '0.85rem', fontWeight: 800 }}>
                        대시보드 데이터 로딩 중...
                    </div>
                </div>
            )}
        </div>
    );
};

export default DashboardView;

