import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { TAB_LABELS, DEFAULT_TAB } from './core/constants';
import { useAuthViewModel, LoginView, SyncService } from './features/auth';
import SplashLoadingView from './components/SplashLoadingView';
import { clearRecordGridHistoryCache, preloadRecordGridData } from './features/records/recordPreloadService';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import { WorkspaceErrorBoundary } from './components/common';
import { DashboardView } from './features/dashboard';
const AttendanceView = lazy(() => import('./features/attendance').then((module) => ({ default: module.AttendanceView })));
const MyInfoView = lazy(() => import('./features/members').then((module) => ({ default: module.MyInfoView })));
const FlowManagementView = lazy(() => import('./features/flow').then((module) => ({ default: module.FlowManagementView })));
const MedicineManagementView = lazy(() => import('./features/medicine').then((module) => ({ default: module.MedicineManagementView })));
const MedicineRegisterView = lazy(() => import('./features/medicine').then((module) => ({ default: module.MedicineRegisterView })));
const MedicineInView = lazy(() => import('./features/medicine').then((module) => ({ default: module.MedicineInView })));
const WaterQualityView = lazy(() => import('./features/water').then((module) => ({ default: module.WaterQualityView })));
const OperationStatusView = lazy(() => import('./features/operation').then((module) => ({ default: module.OperationStatusView })));
const FacilityManagementView = lazy(() => import('./features/facility').then((module) => ({ default: module.FacilityManagementView })));
const DailyLogView = lazy(() => import('./features/dailylog').then((module) => ({ default: module.DailyLogView })));
const BoardView = lazy(() => import('./features/board').then((module) => ({ default: module.BoardView })));
const SettingsView = lazy(() => import('./features/settings').then((module) => ({ default: module.SettingsView })));
const KitManagementView = lazy(() => import('./features/kit').then((module) => ({ default: module.KitManagementView })));
const CertificateView = lazy(() => import('./features/certificate').then((module) => ({ default: module.CertificateView })));
const SludgePhotoView = lazy(() => import('./features/sludge').then((module) => ({ default: module.SludgePhotoView })));
const SludgeLedgerView = lazy(() => import('./features/sludge').then((module) => ({ default: module.SludgeLedgerView })));
const RoadworkHelperView = lazy(() => import('./features/roadwork-helper').then((module) => ({ default: module.RoadworkHelperView })));

const contentLoadingFallback = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '320px' }}>
        <div style={{ textAlign: 'center', color: '#64748b' }}>
            <div className="spinner" style={{ margin: '0 auto 0.75rem' }} />
            <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700 }}>화면 로딩 중...</p>
        </div>
    </div>
);

const PlaceholderView = ({ title }) => (
    <div style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#ffffff', padding: '1.25rem', gap: '1.25rem' }}>
        {/* 좌측 조건 영역 */}
        <div style={{ width: '380px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#1e293b', letterSpacing: '-0.025em', margin: 0 }}>
                {title}
            </h1>
            
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', border: '1px dashed #e2e8f0', borderRadius: '12px' }}>
                <span className="material-icons" style={{ fontSize: '48px', marginBottom: '1rem' }}>event</span>
                <p style={{ fontWeight: 700 }}>조회 조건을 설정하세요.</p>
            </div>

            <div>
                <button style={{
                    width: '100%', height: '48px', backgroundColor: '#1e293b', color: 'white',
                    border: 'none', borderRadius: '12px', fontSize: '1rem', fontWeight: 900,
                    cursor: 'not-allowed', opacity: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                }}>
                    <span className="material-icons">download</span> 일지 생성하기
                </button>
            </div>
        </div>

        {/* 우측 미리보기 영역 */}
        <div style={{ flex: 1, maxWidth: '1200px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                <div style={{ textAlign: 'center', color: '#cbd5e1' }}>
                    <span className="material-icons" style={{ fontSize: '48px', marginBottom: '1rem' }}>table_chart</span>
                    <p style={{ fontWeight: 700 }}>이 기능은 현재 개발 중입니다.</p>
                </div>
            </div>
        </div>
    </div>
);

function App() {
    const { user, loginHintName, isAuthenticated, isLoading, locationStatus, login, logout } = useAuthViewModel();
    const [activeTab, setActiveTab] = useState(DEFAULT_TAB);
    const [isRoadworkMounted, setIsRoadworkMounted] = useState(false);
    const [preloadedUserId, setPreloadedUserId] = useState(null);
    const [forcedUpdateNotice, setForcedUpdateNotice] = useState(null);
    const updateCheckKeyRef = useRef(null);
    const forcedUpdateActiveRef = useRef(false);
    const recordGridSessionsRef = useRef({ flow: {}, medicine: {}, kit: {}, water: {} });

    const resetRecordGridSessions = () => {
        recordGridSessionsRef.current = { flow: {}, medicine: {}, kit: {}, water: {} };
    };

    const updateRecordGridSession = (tab, patch) => {
        recordGridSessionsRef.current[tab] = {
            ...(recordGridSessionsRef.current[tab] || {}),
            ...patch,
        };
    };

    useEffect(() => {
        const unsubscribe = window.electronAPI?.onSessionReset?.(() => {
            resetRecordGridSessions();
            setIsRoadworkMounted(false);
            setActiveTab(DEFAULT_TAB);
        });
        return typeof unsubscribe === 'function' ? unsubscribe : undefined;
    }, []);

    useEffect(() => {
        // 로딩 완료 시 1회 시도
        if (!isLoading) {
            SyncService.startBackgroundSync().catch(console.error);
        }
    }, [isLoading]);

    useEffect(() => {
        const api = window.electronAPI;
        if (!api) return undefined;

        const installSoon = () => {
            window.setTimeout(() => {
                api.installUpdate?.().catch((err) => {
                    setForcedUpdateNotice({
                        title: '업데이트 설치 실패',
                        message: `업데이트 설치를 시작하지 못했습니다.\n${err?.message || err || ''}`,
                        detail: '',
                        percent: 0,
                    });
                });
            }, 1200);
        };

        api.onUpdateAvailable?.((info) => {
            forcedUpdateActiveRef.current = true;
            setForcedUpdateNotice({
                title: '새 버전이 검색되어 업그레이드를 진행합니다',
                message: `새 버전${info?.version ? ` v${info.version}` : ''}이 검색되어 업그레이드를 진행합니다.\n작업 세션은 유지되며, 설치 후 앱이 다시 시작됩니다.`,
                detail: '업데이트 파일 다운로드 준비 중...',
                percent: 0,
            });
        });
        api.onUpdateProgress?.((progress) => {
            if (!forcedUpdateActiveRef.current) return;
            const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));
            setForcedUpdateNotice((prev) => ({
                title: prev?.title || '새 버전이 검색되어 업그레이드를 진행합니다',
                message: prev?.message || '새 버전이 검색되어 업그레이드를 진행합니다.',
                detail: `업데이트 파일 다운로드 중... ${percent}%`,
                percent,
            }));
        });
        api.onUpdateDownloaded?.((info) => {
            forcedUpdateActiveRef.current = true;
            setForcedUpdateNotice({
                title: '업데이트 설치 중',
                message: `새 버전${info?.version ? ` v${info.version}` : ''} 다운로드가 완료되었습니다.\n곧 앱을 재시작하고 업그레이드를 적용합니다.`,
                detail: '설치 준비 중...',
                percent: 100,
            });
            installSoon();
        });
        api.onUpdateInstalling?.(() => {
            forcedUpdateActiveRef.current = true;
            setForcedUpdateNotice({
                title: '업데이트 설치 중',
                message: '업그레이드를 적용하기 위해 앱을 재시작합니다.',
                detail: '잠시만 기다려주세요.',
                percent: 100,
            });
        });
        api.onUpdateNotAvailable?.(() => {
            if (forcedUpdateActiveRef.current) {
                forcedUpdateActiveRef.current = false;
                setForcedUpdateNotice(null);
            }
        });
        api.onUpdateError?.((message) => {
            if (!forcedUpdateActiveRef.current) return;
            setForcedUpdateNotice({
                title: '업데이트 확인 실패',
                message: `업데이트 확인 또는 다운로드 중 오류가 발생했습니다.\n${message || ''}`,
                detail: '네트워크 상태를 확인한 뒤 앱을 다시 실행해주세요.',
                percent: 0,
            });
        });

        return undefined;
    }, []);

    // 로그인 완료 시 한 번만 업데이트를 확인한다. 시간 기반 체크와 선택형 설치는 사용하지 않는다.
    useEffect(() => {
        if (!isAuthenticated || !user?.id) {
            updateCheckKeyRef.current = null;
            forcedUpdateActiveRef.current = false;
            setForcedUpdateNotice(null);
            return undefined;
        }

        const api = window.electronAPI;
        if (!api?.checkForUpdates) return undefined;
        const checkKey = `${user.id}::${user.site_id || 'default'}`;
        if (updateCheckKeyRef.current === checkKey) return undefined;
        updateCheckKeyRef.current = checkKey;

        api.getUpdateStatus?.().then((status) => {
            if (status?.hasDownloadedUpdate) {
                forcedUpdateActiveRef.current = true;
                setForcedUpdateNotice({
                    title: '업데이트 설치 중',
                    message: '다운로드된 새 버전이 있어 업그레이드를 진행합니다.\n작업 세션은 유지되며, 설치 후 앱이 다시 시작됩니다.',
                    detail: '설치 준비 중...',
                    percent: 100,
                });
                window.setTimeout(() => {
                    api.installUpdate?.().catch((err) => {
                        setForcedUpdateNotice({
                            title: '업데이트 설치 실패',
                            message: `업데이트 설치를 시작하지 못했습니다.\n${err?.message || err || ''}`,
                            detail: '',
                            percent: 0,
                        });
                    });
                }, 1200);
                return;
            }
            api.checkForUpdates('login').catch((err) => {
                console.warn('[Update] login update check failed:', err);
            });
        }).catch(() => {
            api.checkForUpdates('login').catch((err) => {
                console.warn('[Update] login update check failed:', err);
            });
        });

        return undefined;
    }, [isAuthenticated, user?.id, user?.site_id]);

    useEffect(() => {
        // 온라인 이벤트 리스너 등록 (1회만)
        SyncService.initAutoSync();
    }, []);

    useEffect(() => {
        if (!isAuthenticated || !user?.id) {
            setPreloadedUserId(null);
            return undefined;
        }

        const preloadKey = `${user.id}::${user.site_id || 'default'}`;
        if (preloadedUserId === preloadKey) return undefined;

        let cancelled = false;
        clearRecordGridHistoryCache();

        preloadRecordGridData().finally(() => {
            if (cancelled) return;
            setPreloadedUserId(preloadKey);
        });

        return () => {
            cancelled = true;
        };
    }, [isAuthenticated, preloadedUserId, user?.id, user?.site_id]);

    if (isLoading) {
        return <SplashLoadingView percent={0} label="" showProgress={false} />;
    }

    if (!isAuthenticated) {
        return <LoginView onLogin={login} loginHintName={loginHintName} />;
    }

    const handleUpdatePassword = () => {
        setActiveTab('myinfo');
    };

    const handleLogout = () => {
        clearRecordGridHistoryCache();
        resetRecordGridSessions();
        setPreloadedUserId(null);
        setIsRoadworkMounted(false);
        logout();
    };

    const handleTabChange = (nextTab) => {
        if (nextTab === 'log_roadwork_helper') {
            setIsRoadworkMounted(true);
        }
        setActiveTab(nextTab);
    };

    const renderContent = () => {
        switch (activeTab) {
            case 'flow': return <FlowManagementView currentUser={user} workspaceSession={recordGridSessionsRef.current.flow} onWorkspaceSessionChange={(patch) => updateRecordGridSession('flow', patch)} />;
            case 'medicine': return <MedicineManagementView currentUser={user} workspaceSession={recordGridSessionsRef.current.medicine} onWorkspaceSessionChange={(patch) => updateRecordGridSession('medicine', patch)} />;
            case 'water': return <WaterQualityView currentUser={user} workspaceSession={recordGridSessionsRef.current.water} onWorkspaceSessionChange={(patch) => updateRecordGridSession('water', patch)} />;
            case 'kit': return <KitManagementView currentUser={user} workspaceSession={recordGridSessionsRef.current.kit} onWorkspaceSessionChange={(patch) => updateRecordGridSession('kit', patch)} />;
            case 'operation_status': return <OperationStatusView currentUser={user} />;
            case 'certificate': return <CertificateView currentUser={user} />;
            case 'facility': return <FacilityManagementView currentUser={user} />;
            // TODO: 장비이력카드 — 향후 EquipmentCardView 컴포넌트로 교체
            //       · 장비 목록(사진, 기기명, 사양, 설치일 등) CRUD
            //       · facility_logs 의 facility_id 컬럼과 연계하여 장비별 수리이력 조회
            //       · 구글 드라이브 또는 로컬 파일로 장비 사진 관리
            case 'equipment_card': return <PlaceholderView title="장비이력카드" />;
            case 'log': return <PlaceholderView title="일지작성" />;
            case 'log_daily': return <DailyLogView key="log_daily" currentUser={user} templateName="일일업무일지" title="일일업무일지" />;
            case 'log_water': return <DailyLogView key="log_water" currentUser={user} templateName="수질분석일지" title="수질분석일지" />;
            case 'log_med_mgmt': return <MedicineRegisterView currentUser={user} />;
            case 'log_med_in': return <MedicineInView currentUser={user} />;
            case 'log_sludge_out': return <SludgeLedgerView currentUser={user} />;
            case 'log_sludge_photo': return <SludgePhotoView currentUser={user} />;
            case 'log_roadwork_helper': return null;
            case 'attendance':
                return <AttendanceView currentUser={user} />;
            case 'myinfo':
                return <MyInfoView currentUser={user} />;
            case 'board':
                return <BoardView currentUser={user} />;
            case 'dashboard':
                return <DashboardView currentUser={user} />;
            case 'settings': return <SettingsView currentUser={user} />;
            default: return <DashboardView currentUser={user} />;
        }
    };

    const getHelpText = () => {
        if (activeTab === 'kit') {
            return '분석키트 동기화: 수질분석(QnTECH) 건수를 사용량으로 맞춘 뒤, 미적용 날짜만 반영하여 재고를 재계산합니다.';
        }
        if (activeTab.startsWith('log')) {
            return 'Ctrl(또는 Cmd)+클릭: 띄엄띄엄 여러 문서 선택 | Shift+클릭: 한 번에 여러 문서 범위 선택';
        }
        return undefined; // StatusBar의 기본값을 사용하게 함
    };

    return (
        <div className="app-shell">
            <div className="app-main-body">
                <Sidebar
                    user={user}
                    activeTab={activeTab}
                    onTabChange={handleTabChange}
                    onLogout={handleLogout}
                    onUpdatePassword={handleUpdatePassword}
                />

                <main className="main-content">
                    <div className="main-content-workspace" style={{ position: 'relative' }}>
                        <div style={{
                            display: activeTab === 'log_roadwork_helper' ? 'none' : 'block',
                            width: '100%',
                            height: '100%',
                        }}>
                            <WorkspaceErrorBoundary resetKey={activeTab}>
                                <Suspense fallback={contentLoadingFallback}>
                                    {renderContent()}
                                </Suspense>
                            </WorkspaceErrorBoundary>
                        </div>

                        {isRoadworkMounted && (
                            <div style={{
                                position: activeTab === 'log_roadwork_helper' ? 'relative' : 'absolute',
                                inset: 0,
                                width: '100%',
                                height: '100%',
                                visibility: activeTab === 'log_roadwork_helper' ? 'visible' : 'hidden',
                                pointerEvents: activeTab === 'log_roadwork_helper' ? 'auto' : 'none',
                                zIndex: activeTab === 'log_roadwork_helper' ? 1 : 0,
                            }}>
                                <WorkspaceErrorBoundary resetKey="log_roadwork_helper">
                                    <Suspense fallback={contentLoadingFallback}>
                                        <RoadworkHelperView currentUser={user} />
                                    </Suspense>
                                </WorkspaceErrorBoundary>
                            </div>
                        )}
                    </div>
                </main>
            </div>

            <StatusBar
                title={TAB_LABELS[activeTab] || TAB_LABELS[DEFAULT_TAB]}
                helpText={getHelpText()}
                locationStatus={locationStatus}
            />

            {forcedUpdateNotice && (
                <div style={{
                    position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.55)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
                }}>
                    <div style={{
                        backgroundColor: 'white', borderRadius: '12px', padding: '1.75rem 2rem',
                        width: '420px', maxWidth: '90vw', boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem' }}>
                            <span className="material-icons" style={{ color: '#2563eb', fontSize: '26px' }}>system_update</span>
                            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#1e293b' }}>
                                {forcedUpdateNotice.title}
                            </h3>
                        </div>
                        <p style={{ margin: '0 0 1.4rem', fontSize: '0.875rem', lineHeight: 1.6, color: '#475569', whiteSpace: 'pre-line' }}>
                            {forcedUpdateNotice.message}
                        </p>
                        <div style={{
                            height: 8,
                            borderRadius: 999,
                            backgroundColor: '#e2e8f0',
                            overflow: 'hidden',
                            marginBottom: '0.75rem',
                        }}>
                            <div style={{
                                width: `${Math.max(8, Math.min(100, forcedUpdateNotice.percent || 8))}%`,
                                height: '100%',
                                borderRadius: 999,
                                backgroundColor: '#2563eb',
                                transition: 'width 180ms ease',
                            }} />
                        </div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#64748b' }}>
                            {forcedUpdateNotice.detail || '업데이트를 준비 중입니다.'}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
