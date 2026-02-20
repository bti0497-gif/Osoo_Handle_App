import React, { useState } from 'react';
import { TAB_LABELS, DEFAULT_TAB } from './core/constants';
import { useAuthViewModel, LoginView } from './features/auth';
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

function App() {
    const { user, isAuthenticated, isLoading, login, logout } = useAuthViewModel();
    const [activeTab, setActiveTab] = useState(DEFAULT_TAB);

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
            case 'facility': return <FacilityManagementView currentUser={user} />;
            case 'log': return <DailyLogView currentUser={user} />;
            case 'attendance':
                return <AttendanceView currentUser={user} />;
            case 'members':
                return <MemberManagementView currentUser={user} />;
            case 'myinfo':
                return <MemberManagementView currentUser={user} passwordOnly={true} />;
            case 'dashboard':
            case 'board':
                return <BoardView currentUser={user} />;
            case 'settings': return <SettingsView currentUser={user} />;
            default: return <Dashboard title="유량관리" />;
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
