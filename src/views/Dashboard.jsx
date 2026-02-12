import React from 'react';

const Dashboard = ({ title = '통합 대시보드' }) => {
    const stats = [
        { label: '전체 유량 (m³/d)', value: '1,240', status: 'Normal' },
        { label: '평균 pH', value: '7.2', status: 'Optimal' },
        { label: '평균 COD (mg/L)', value: '12.5', status: 'Safe' },
        { label: '전국 가동률', value: '98.5%', status: 'High' },
    ];

    const recentAlerts = [
        { site: '서울 만남의광장', issue: 'pH 센서 보정 필요', time: '10분 전' },
        { site: '안성 휴게소 (상)', issue: '유량 급증 감지', time: '30분 전' },
        { site: '천안 휴게소 (하)', issue: '정기 점검 예정', time: '1시간 전' },
    ];

    return (
        <div className="dashboard-container">
            <header className="header">
                <h1 className="title">{title}</h1>
                <div className="badge badge-success">System Status: Online</div>
            </header>

            <div className="grid">
                {stats.map((stat, index) => (
                    <div key={index} className="glass-card stat-card">
                        <span className="stat-label">{stat.label}</span>
                        <span className="stat-value">{stat.value}</span>
                        <span className="badge badge-success" style={{ width: 'fit-content' }}>
                            {stat.status}
                        </span>
                    </div>
                ))}
            </div>

            <div className="glass-card" style={{ marginTop: '2rem' }}>
                <h2 style={{ marginBottom: '1.5rem', fontSize: '1.125rem' }}>최근 주요 알림</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {recentAlerts.map((alert, index) => (
                        <div
                            key={index}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                padding: '1rem',
                                borderRadius: '0.5rem',
                                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                            }}
                        >
                            <div>
                                <div style={{ fontWeight: '600', color: 'var(--accent-color)' }}>
                                    {alert.site}
                                </div>
                                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                    {alert.issue}
                                </div>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {alert.time}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
