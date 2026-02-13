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

function App() {
    const { user, isAuthenticated, login, logout, updatePassword } = useAuthViewModel();
    const [activeTab, setActiveTab] = useState('flow');

    if (!isAuthenticated) {
        return <LoginView onLogin={login} />;
    }

    const handleUpdatePassword = () => {
        const newPass = prompt('새 비밀번호를 입력하세요:');
        if (newPass) {
            updatePassword(newPass);
            alert('비밀번호가 변경되었습니다.');
        }
    };

    const renderContent = () => {
        switch (activeTab) {
            case 'flow': return <FlowManagementView />;
            case 'medicine': return <MedicineManagementView />;
            case 'water': return <WaterQualityView />;
            case 'facility': return <FacilityManagementView />;
            case 'log': return <DailyLogView />;
            case 'attendance':
                return <AttendanceView />;
            case 'members':
                return <MemberManagementView />;
            case 'dashboard':
                return <Dashboard title="소통게시판" />;
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
