import React, { useState, useEffect } from 'react';
import { TAB_LABELS, DEFAULT_TAB } from './core/constants';
import { useAuthViewModel, LoginView, SyncService } from './features/auth';
import { AttendanceView } from './features/attendance';
import { MemberManagementView } from './features/members';
import { FlowManagementView } from './features/flow';
import { MedicineManagementView } from './features/medicine';
import { WaterQualityView } from './features/water';
import { FacilityManagementView } from './features/facility';
import { DailyLogView } from './features/dailylog';
import { BoardView } from './features/board';
import { SettingsView } from './features/settings';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import StatusBar from './components/StatusBar';
import Dashboard from './views/Dashboard';
import { KitManagementView } from './features/kit';
import { CertificateView } from './features/certificate';

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
    const { user, isAuthenticated, isLoading, login, logout } = useAuthViewModel();
    const [activeTab, setActiveTab] = useState(DEFAULT_TAB);

    useEffect(() => {
        // 로딩 완료 시 1회 시도
        if (!isLoading) {
            SyncService.startBackgroundSync().catch(console.error);
        }
    }, [isLoading]);

    useEffect(() => {
        // 온라인 이벤트 리스너 등록 (1회만)
        SyncService.initAutoSync();
    }, []);

    if (isLoading) {
        return (
            <div className="login-screen">
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <div className="spinner" style={{ margin: '0 auto 1rem' }} />
                    <p>세션 복원 중...</p>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <LoginView onLogin={login} />;
    }

    const handleUpdatePassword = () => {
        setActiveTab('myinfo');
    };

    const renderContent = () => {
        switch (activeTab) {
            case 'flow': return <FlowManagementView currentUser={user} />;
            case 'medicine': return <MedicineManagementView currentUser={user} />;
            case 'water': return <WaterQualityView currentUser={user} />;
            case 'kit': return <KitManagementView currentUser={user} />;
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
            case 'log_med_mgmt': return <PlaceholderView title="약품관리대장" />;
            case 'log_med_in': return <PlaceholderView title="약품입고일지" />;
            case 'log_sludge_out': return <PlaceholderView title="슬러지반출관리대장" />;
            case 'log_sludge_photo': return <PlaceholderView title="슬러지사진대지" />;
            case 'attendance':
                return <AttendanceView currentUser={user} />;
            case 'members':
                return <MemberManagementView currentUser={user} />;
            case 'myinfo':
                return <MemberManagementView currentUser={user} passwordOnly={true} />;
            case 'board':
                return <BoardView currentUser={user} />;
            case 'dashboard':
                return <Dashboard title="통합 대시보드" />;
            case 'settings': return <SettingsView currentUser={user} />;
            default: return <Dashboard title="통합 대시보드" />;
        }
    };

    const getHelpText = () => {
        if (activeTab.startsWith('log')) {
            return 'Ctrl(또는 Cmd)+클릭: 띄엄띄엄 여러 문서 선택 | Shift+클릭: 한 번에 여러 문서 범위 선택';
        }
        return undefined; // StatusBar의 기본값을 사용하게 함
    };

    return (
        <div className="app-shell">
            <Header />

            <div className="app-main-body">
                <Sidebar
                    user={user}
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    onLogout={logout}
                    onUpdatePassword={handleUpdatePassword}
                />

                <main className="main-content">
                    {renderContent()}
                </main>
            </div>

            <StatusBar 
                title={TAB_LABELS[activeTab] || TAB_LABELS[DEFAULT_TAB]} 
                helpText={getHelpText()} 
            />
        </div>
    );
}

export default App;
