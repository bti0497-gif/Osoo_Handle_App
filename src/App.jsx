import React, { useState } from 'react';
import { useAuthViewModel } from './viewmodels/AuthViewModel';
import AttendanceView from './views/AttendanceView';
import MemberManagementView from './views/MemberManagementView';
import FlowManagementView from './views/FlowManagementView';
import MedicineManagementView from './views/MedicineManagementView';
import WaterQualityView from './views/WaterQualityView';
import FacilityManagementView from './views/FacilityManagementView';
import DailyLogView from './views/DailyLogView';
import LoginView from './views/LoginView';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import StatusBar from './components/StatusBar';
import Dashboard from './views/Dashboard';
import BoardView from './views/BoardView';

function App() {
    const { user, isAuthenticated, login, logout } = useAuthViewModel();
    const [activeTab, setActiveTab] = useState('flow');

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
            case 'settings': return <Dashboard title="설정메뉴" />;
            default: return <Dashboard title="유량관리" />;
        }
    };

    const getTabLabel = () => {
        const labels = {
            flow: '유량관리',
            medicine: '약품관리',
            water: '수질관리',
            facility: '시설관리',
            log: '일지작성',
            board: '소통게시판',
            members: '회원 및 현장 관리',
            myinfo: '내 정보 수정',
            settings: '설정메뉴'
        };
        return labels[activeTab] || '유량관리';
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

            <StatusBar title={getTabLabel()} />
        </div>
    );
};

export default App;
