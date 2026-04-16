import React, { useEffect, useState } from 'react';
import { useDashboardViewModel } from './useDashboardViewModel';
import FlowTrendWidget from './widgets/FlowTrendWidget';
import WaterQualityWidget from './widgets/WaterQualityWidget';
import InventoryLevelWidget from './widgets/InventoryLevelWidget';

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
    } = useDashboardViewModel(currentUser);

    useEffect(() => {
        try {
            window.localStorage.setItem('dashboard.flowWidgetOpen', String(isFlowWidgetOpen));
        } catch {
            // 저장소 접근 불가 환경에서는 메모리 상태만 사용
        }
    }, [isFlowWidgetOpen]);

    return (
        <div style={{ width: '100%', height: '100%', backgroundColor: '#ffffff', padding: '1.25rem' }}>
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
                <div style={{ width: 'min(90vw, calc(100vw - 290px))', maxWidth: '100%', alignSelf: 'flex-start' }}>
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

                <div style={{ width: 'min(90vw, calc(100vw - 290px))', maxWidth: '100%', alignSelf: 'flex-start' }}>
                    <WaterQualityWidget rows={waterWidgetRows} summary={waterSummary} />
                </div>
                <div style={{ width: 'min(90vw, calc(100vw - 290px))', maxWidth: '100%', alignSelf: 'flex-start' }}>
                    <InventoryLevelWidget medicineRows={medicineRows} kitRows={kitRows} />
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

