import React, { lazy, Suspense, useState, useEffect, useRef, useMemo } from 'react';
import { TAB_LABELS, DEFAULT_TAB } from './core/constants';
import { useAuthViewModel, LoginView, SyncService } from './features/auth';
import SplashLoadingView from './components/SplashLoadingView';
import { clearRecordGridHistoryCache, preloadRecordGridData } from './features/records/recordPreloadService';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import { WorkspaceErrorBoundary } from './components/common';
import { DashboardView } from './features/dashboard';
import { CertificateModel } from './features/certificate/CertificateModel';
const AttendanceView = lazy(() => import('./features/attendance').then((module) => ({ default: module.AttendanceView })));
const MyInfoView = lazy(() => import('./features/members').then((module) => ({ default: module.MyInfoView })));
const FlowManagementView = lazy(() => import('./features/flow').then((module) => ({ default: module.FlowManagementView })));
const MedicineManagementView = lazy(() => import('./features/medicine').then((module) => ({ default: module.MedicineManagementView })));
const MedicineRegisterView = lazy(() => import('./features/medicine').then((module) => ({ default: module.MedicineRegisterView })));
const MedicineInView = lazy(() => import('./features/medicine').then((module) => ({ default: module.MedicineInView })));
const WaterQualityView = lazy(() => import('./features/water').then((module) => ({ default: module.WaterQualityView })));
const OperationStatusView = lazy(() => import('./features/operation').then((module) => ({ default: module.OperationStatusView })));
const FacilityManagementView = lazy(() => import('./features/facility').then((module) => ({ default: module.FacilityManagementView })));
const EquipmentCardView = lazy(() => import('./features/equipment').then((module) => ({ default: module.EquipmentCardView })));
const DailyLogView = lazy(() => import('./features/dailylog').then((module) => ({ default: module.DailyLogView })));
const MonthlyOperationReportView = lazy(() => import('./features/monthly-report').then((module) => ({ default: module.MonthlyOperationReportView })));
const BoardView = lazy(() => import('./features/board').then((module) => ({ default: module.BoardView })));
const BoardPopupNotice = lazy(() => import('./features/board').then((module) => ({ default: module.BoardPopupNotice })));
const SettingsView = lazy(() => import('./features/settings').then((module) => ({ default: module.SettingsView })));
const KitManagementView = lazy(() => import('./features/kit').then((module) => ({ default: module.KitManagementView })));
const CertificateView = lazy(() => import('./features/certificate').then((module) => ({ default: module.CertificateView })));
const SludgePhotoView = lazy(() => import('./features/sludge').then((module) => ({ default: module.SludgePhotoView })));
const SludgeLedgerView = lazy(() => import('./features/sludge').then((module) => ({ default: module.SludgeLedgerView })));
const RoadworkHelperView = lazy(() => import('./features/roadwork-helper').then((module) => ({ default: module.RoadworkHelperView })));
const GRID_CACHE_REFRESH_MS = 10 * 60 * 1000;
const CERTIFICATE_CACHE_REFRESH_MS = 60 * 60 * 1000;
const BACKGROUND_IDLE_DELAY_MS = 30 * 60 * 1000;

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
    const { user: authenticatedUser, loginHintName, isAuthenticated, isLoading, locationStatus, login, logout } = useAuthViewModel();
    const [multiSiteRuntime, setMultiSiteRuntime] = useState(null);
    const windowSiteId = new URLSearchParams(window.location.search).get('siteId') || '';
    const user = useMemo(() => {
        if (!authenticatedUser) return authenticatedUser;
        let runtimeUser = authenticatedUser;
        if (multiSiteRuntime) {
            const sitesById = new Map(
                (authenticatedUser.managed_sites || []).map((site) => [String(site.id), site])
            );
            for (const site of multiSiteRuntime.sites || []) {
                if (site?.id) sitesById.set(String(site.id), { ...sitesById.get(String(site.id)), ...site });
            }
            runtimeUser = {
                ...authenticatedUser,
                managed_sites: [...sitesById.values()],
                multi_site_enabled: Boolean(multiSiteRuntime.enabled),
                primary_site_id: multiSiteRuntime.primarySiteId || null,
                secondary_site_id: multiSiteRuntime.secondarySiteId || null,
            };
        }
        if (!windowSiteId) return runtimeUser;
        const site = (runtimeUser.managed_sites || []).find((item) => String(item.id) === String(windowSiteId));
        return site ? {
            ...runtimeUser,
            site_id: site.id,
            site_name1: site.site_name,
            target_lat: site.target_lat,
            target_lng: site.target_lng,
            radius_m: site.radius_m,
        } : runtimeUser;
    }, [authenticatedUser, multiSiteRuntime, windowSiteId]);
    const [activeTab, setActiveTab] = useState(DEFAULT_TAB);
    const [isRoadworkMounted, setIsRoadworkMounted] = useState(false);
    const [preloadedUserId, setPreloadedUserId] = useState(null);
    const [forcedUpdateNotice, setForcedUpdateNotice] = useState(null);
    const [directionToast, setDirectionToast] = useState('');
    const directionToastTimerRef = useRef(null);
    const forcedUpdateActiveRef = useRef(false);
    const recordGridSessionsRef = useRef({ flow: {}, medicine: {}, kit: {}, water: {} });

    useEffect(() => {
        if (!isAuthenticated || !user?.multi_site_enabled || !user?.site_name1) return undefined;
        const direction = String(user.site_name1).match(/([가-힣A-Za-z0-9]+방향)/)?.[1] || String(user.site_name1);
        const showDirection = () => {
            setDirectionToast(`${direction}입니다`);
            clearTimeout(directionToastTimerRef.current);
            directionToastTimerRef.current = setTimeout(() => setDirectionToast(''), 1500);
        };
        showDirection();
        const unsubscribe = window.electronAPI?.onWindowRestored?.((info) => {
            if (info?.reason === 'site-window-focus' || info?.reason === 'tray-menu' || info?.reason === 'tray-double-click') {
                showDirection();
            }
        });
        const unsubscribeNative = window.electronAPI?.onNativeFocusEvent?.((info) => {
            if (info?.event === 'browser-window-focus') showDirection();
        });
        return () => {
            clearTimeout(directionToastTimerRef.current);
            unsubscribe?.();
            unsubscribeNative?.();
        };
    }, [isAuthenticated, user?.multi_site_enabled, user?.site_name1]);

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
        const api = window.electronAPI;
        if (!api) return undefined;

        api.onUpdateAvailable?.((info) => {
            if (info?.manual) {
                forcedUpdateActiveRef.current = true;
                setForcedUpdateNotice({
                    title: '새 버전 다운로드 중',
                    message: `새 버전${info?.version ? ` v${info.version}` : ''}을 다운로드하고 있습니다.`,
                    detail: '다운로드 준비 중...',
                    percent: 0,
                });
                return;
            }
            console.info(`[Update] v${info?.version || ''} available; downloading in background.`);
            forcedUpdateActiveRef.current = false;
            setForcedUpdateNotice(null);
        });
        api.onUpdateProgress?.((progress) => {
            if (progress?.manual) {
                const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));
                setForcedUpdateNotice((previous) => ({
                    title: previous?.title || '새 버전 다운로드 중',
                    message: previous?.message || '수동으로 요청한 업데이트를 다운로드하고 있습니다.',
                    detail: `다운로드 중... ${percent}%`,
                    percent,
                }));
                return;
            }
            console.debug(`[Update] download ${Math.round(Number(progress?.percent) || 0)}%`);
        });
        api.onUpdateDownloaded?.((info) => {
            if (info?.manual) {
                forcedUpdateActiveRef.current = true;
                setForcedUpdateNotice({
                    title: '업데이트 설치 중',
                    message: '수동으로 요청한 업데이트 다운로드가 완료되어 바로 설치합니다.',
                    detail: '앱을 다시 시작하는 중...',
                    percent: 100,
                });
                window.setTimeout(() => {
                    api.installUpdate?.().catch((error) => {
                        setForcedUpdateNotice({
                            title: '업데이트 설치 실패',
                            message: error?.message || String(error || '업데이트 설치를 시작하지 못했습니다.'),
                            detail: '',
                            percent: 0,
                        });
                    });
                }, 500);
                return;
            }
            console.info(`[Update] v${info?.version || ''} downloaded; installation deferred until idle.`);
            forcedUpdateActiveRef.current = false;
            setForcedUpdateNotice(null);
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

    useEffect(() => {
        if (!isAuthenticated || !user?.id) return undefined;

        let cancelled = false;
        const refreshCaches = () => {
            if (cancelled || document.visibilityState === 'hidden') return;
            preloadRecordGridData({ force: true }).catch((error) => {
                console.warn('[cache-warmup] grid refresh failed:', error);
            });
        };

        const timer = window.setInterval(refreshCaches, GRID_CACHE_REFRESH_MS);
        const onVisible = () => {
            if (document.visibilityState === 'visible') refreshCaches();
        };
        document.addEventListener('visibilitychange', onVisible);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [isAuthenticated, user]);

    useEffect(() => {
        if (!isAuthenticated || !user?.id) return undefined;

        let cancelled = false;
        let running = false;
        let activityVersion = 0;
        let lastActivityAt = Date.now();
        let idleTimer = null;
        let lastServerNoticeAt = 0;

        const scheduleFromLastActivity = () => {
            if (idleTimer) window.clearTimeout(idleTimer);
            const remaining = Math.max(0, BACKGROUND_IDLE_DELAY_MS - (Date.now() - lastActivityAt));
            idleTimer = window.setTimeout(runBackgroundJobs, remaining);
        };

        const runBackgroundJobs = async () => {
            if (cancelled || running) return;
            if (Date.now() - lastActivityAt < BACKGROUND_IDLE_DELAY_MS) {
                scheduleFromLastActivity();
                return;
            }

            running = true;
            const runVersion = activityVersion;
            const canContinue = () => !cancelled && runVersion === activityVersion;
            try {
                const taskTypes = ['attendance-sync', 'data-sync', 'file-sync', 'certificate-cache', 'board-cache', 'diagnostic-sync', 'update-check'];
                await SyncService.prepareBackgroundTasks(taskTypes);
                const pendingTasks = await SyncService.getPendingBackgroundTasks();

                for (const task of pendingTasks) {
                    if (!canContinue()) break;
                    const taskType = String(task?.task_type || '');
                    try {
                        const claim = await SyncService.claimBackgroundTask(taskType);
                        if (!claim?.claimed) continue;
                        if (taskType === 'attendance-sync') {
                            await SyncService.startBackgroundSync();
                        } else if (taskType === 'data-sync') {
                            await SyncService.runDataBackgroundSync();
                        } else if (taskType === 'file-sync') {
                            await SyncService.runFileBackgroundSync();
                        } else if (taskType === 'certificate-cache') {
                            await CertificateModel.syncAllMonthsInBackground(user);
                            window.dispatchEvent(new CustomEvent('osoo:certificate-cache-updated'));
                        } else if (taskType === 'board-cache') {
                            const { BoardModel } = await import('./features/board/BoardModel');
                            await BoardModel.fetchPosts(user, { force: true });
                            window.dispatchEvent(new CustomEvent('osoo:board-cache-updated'));
                        } else if (taskType === 'diagnostic-sync') {
                            await SyncService.runDiagnosticBackgroundSync();
                        } else if (taskType === 'update-check') {
                            const updateStatus = await window.electronAPI?.getUpdateStatus?.();
                            if (!canContinue()) throw new Error('user activity detected before update action');
                            if (updateStatus?.hasDownloadedUpdate) {
                                await window.electronAPI?.installUpdate?.();
                            } else {
                                await window.electronAPI?.checkForUpdates?.('idle');
                            }
                        }
                        await SyncService.completeBackgroundTask(taskType, CERTIFICATE_CACHE_REFRESH_MS);
                    } catch (taskError) {
                        await SyncService.failBackgroundTask(taskType, taskError).catch(() => {});
                        console.warn(`[background-idle] ${taskType} failed:`, taskError);
                        // Background failures never interrupt field work or the
                        // remaining queue. The persistent task retains retry state.
                        continue;
                    }
                }
            } catch (error) {
                console.warn('[background-idle] background job failed:', error);
            } finally {
                running = false;
                if (!cancelled) {
                    if (runVersion === activityVersion) {
                        idleTimer = window.setTimeout(runBackgroundJobs, CERTIFICATE_CACHE_REFRESH_MS);
                    } else {
                        scheduleFromLastActivity();
                    }
                }
            }
        };

        const onUserActivity = () => {
            activityVersion += 1;
            lastActivityAt = Date.now();
            scheduleFromLastActivity();
            if (Date.now() - lastServerNoticeAt >= 10000) {
                lastServerNoticeAt = Date.now();
                void SyncService.notifyUserActivity();
            }
        };
        const onWakeup = () => scheduleFromLastActivity();
        const activityEvents = ['keydown', 'pointerdown', 'input', 'change', 'wheel'];
        activityEvents.forEach((eventName) => window.addEventListener(eventName, onUserActivity, true));
        window.addEventListener('osoo:background-sync-wakeup', onWakeup);
        // 외부 작업을 시작하지 않고 로컬 투두리스트만 먼저 확보한다.
        void SyncService.prepareBackgroundTasks([
            'attendance-sync',
            'data-sync',
            'file-sync',
            'certificate-cache',
            'board-cache',
            'diagnostic-sync',
            'update-check',
        ]).catch((error) => console.warn('[background-idle] task preparation failed:', error));
        scheduleFromLastActivity();

        return () => {
            cancelled = true;
            if (idleTimer) window.clearTimeout(idleTimer);
            activityEvents.forEach((eventName) => window.removeEventListener(eventName, onUserActivity, true));
            window.removeEventListener('osoo:background-sync-wakeup', onWakeup);
        };
    }, [isAuthenticated, user]);

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
        import('./features/board/BoardModel').then(({ BoardModel }) => BoardModel.clearPostsCache());
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
            case 'equipment_card': return <EquipmentCardView currentUser={user} />;
            case 'log': return <PlaceholderView title="일지작성" />;
            case 'log_daily': return <DailyLogView key="log_daily" currentUser={user} templateName="일일업무일지" title="일일업무일지" />;
            case 'log_monthly_operation': return <MonthlyOperationReportView currentUser={user} />;
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
            case 'settings': return (
                <SettingsView
                    currentUser={user}
                    onMultiSiteModeChanged={(response) => {
                        const enabled = Boolean(response?.enabled);
                        setMultiSiteRuntime({
                            enabled,
                            primarySiteId: response?.primarySiteId || null,
                            secondarySiteId: response?.secondarySiteId || null,
                            sites: enabled ? [
                                {
                                    id: response?.primarySiteId,
                                    site_name: response?.primarySiteName || '',
                                    is_primary: true,
                                },
                                {
                                    id: response?.secondarySiteId,
                                    site_name: response?.secondarySiteName || '',
                                    is_primary: false,
                                },
                            ].filter((site) => site.id && site.site_name) : [],
                        });
                    }}
                />
            );
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

            {directionToast ? (
                <div style={{
                    position: 'fixed',
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 10020,
                    padding: '1rem 2rem',
                    borderRadius: '14px',
                    backgroundColor: 'rgba(15, 23, 42, 0.76)',
                    color: '#fff',
                    fontSize: '2rem',
                    fontWeight: 900,
                    letterSpacing: '-0.03em',
                    pointerEvents: 'none',
                    boxShadow: '0 16px 40px rgba(15, 23, 42, 0.25)',
                }}>
                    {directionToast}
                </div>
            ) : null}

            <Suspense fallback={null}>
                <BoardPopupNotice currentUser={user} activeTab={activeTab} onOpenBoard={() => setActiveTab('board')} />
            </Suspense>

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
