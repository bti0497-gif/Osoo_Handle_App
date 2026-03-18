import React, { useState, useEffect } from 'react';

const StatusBar = ({ title, helpText }) => {
    const [time, setTime] = useState(new Date().toLocaleTimeString());

    useEffect(() => {
        const timer = setInterval(() => {
            setTime(new Date().toLocaleTimeString());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const loginTime = "2023-10-27 09:00:12"; // 예시 데이터

    return (
        <footer className="status-bar">
            <div className="status-left">
                <div className="status-item">
                    <span className="material-icons text-primary" style={{ fontSize: '14px' }}>navigation</span>
                    <span>현재 메뉴: <span className="current-menu-highlight">{title}</span></span>
                </div>
                <div className="status-item" style={{ borderLeft: '1px solid #475569', paddingLeft: '1rem' }}>
                    <span className="material-icons text-green-400" style={{ fontSize: '14px' }}>info</span>
                    <span>도움말: {helpText || '각 항목의 상세 데이터는 왼쪽 메뉴를 통해 접근하세요.'}</span>
                </div>
            </div>

            <div className="status-right">
                <div className="status-item">
                    <span className="material-icons" style={{ fontSize: '14px', color: '#94a3b8' }}>login</span>
                    <span>현재 시간: <span style={{ color: 'white' }}>{time}</span></span>
                </div>
                <div className="status-item" style={{ backgroundColor: '#334155', padding: '2px 8px', borderRadius: '4px', color: 'white' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4ade80', marginRight: '6px' }}></div>
                    <span>서버 상태: 양호</span>
                </div>
            </div>
        </footer>
    );
};

export default StatusBar;
