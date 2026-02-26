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

const PlaceholderView = ({ title }) => (
    <div className="panel-container">
        <div className="dynamic-panel shadow-2xl border-slate-200" style={{ width: '820px', flexShrink: 0 }}>
            <div className="panel-header">
                <h2 className="title">{title}</h2>
                <p style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: '0.25rem' }}>준비 중인 메뉴입니다.</p>
            </div>
            <div className="panel-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1' }}>
                <div style={{ textAlign: 'center' }}>
                    <span className="material-icons" style={{ fontSize: '48px', marginBottom: '1rem' }}>construction</span>
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
            case 'facility': return <FacilityManagementView currentUser={user} />;
            case 'log': return <DailyLogView currentUser={user} />;
            case 'log_daily': return <PlaceholderView title="일일업무일지" />;
            case 'log_water': return <PlaceholderView title="수질분석일지" />;
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

            <StatusBar title={TAB_LABELS[activeTab] || TAB_LABELS[DEFAULT_TAB]} />
        </div>
    );
}

export default App;
