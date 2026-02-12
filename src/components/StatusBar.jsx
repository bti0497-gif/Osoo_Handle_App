import React, { useState, useEffect } from 'react';

const StatusBar = ({ title }) => {
    const [time, setTime] = useState(new Date().toLocaleTimeString());

    useEffect(() => {
        const timer = setInterval(() => {
            setTime(new Date().toLocaleTimeString());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <footer className="status-bar">
            <div className="status-left">
                <div className="status-item current-menu">
                    <span className="menu-dot">📍</span>
                    <span className="menu-name">현재 메뉴: {title}</span>
                </div>
                <span className="status-separator">|</span>
                <div className="status-item">
                    <span className="status-dot online"></span>
                    <span>System Online</span>
                </div>
            </div>

            <div className="status-right">
                <div className="status-item">
                    <span>Server: Local (8900)</span>
                </div>
                <span className="status-separator">|</span>
                <div className="status-item clock">
                    {time}
                </div>
            </div>
        </footer>
    );
};

export default StatusBar;
