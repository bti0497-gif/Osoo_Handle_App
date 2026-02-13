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
        <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem'
        }}>
            <div className="glass-card" style={{
                maxWidth: '600px',
                width: '100%',
                padding: '4rem',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                boxShadow: '0 4px 20px rgba(0,0,0,0.05)'
            }}>
                <div style={{
                    width: '5rem',
                    height: '5rem',
                    backgroundColor: '#f8fafc',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '1.5rem'
                }}>
                    <span className="material-icons" style={{ fontSize: '3rem', color: '#cbd5e1' }}>pending_actions</span>
                </div>

                <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e293b', marginBottom: '0.5rem' }}>
                    대시보드 준비 중입니다
                </h2>

                <p style={{ color: '#64748b', marginBottom: '2rem', lineHeight: '1.6' }}>
                    현재 시스템 초기화 및 데이터 동기화 작업이 진행 중입니다.<br />
                    잠시 후 상세 관리 현황을 확인하실 수 있습니다.
                </p>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <div style={{ height: '6px', width: '3rem', backgroundColor: '#e2e8f0', borderRadius: '9999px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: '50%', backgroundColor: 'var(--primary)', borderRadius: '9999px' }}></div>
                    </div>
                    <div style={{ height: '6px', width: '3rem', backgroundColor: '#f1f5f9', borderRadius: '9999px' }}></div>
                    <div style={{ height: '6px', width: '3rem', backgroundColor: '#f1f5f9', borderRadius: '9999px' }}></div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
