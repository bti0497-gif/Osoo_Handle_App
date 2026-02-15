import React from 'react';

const Dashboard = ({ title = '통합 대시보드' }) => {
    return (
        <div className="panel-container justify-center items-center">
            <div className="dynamic-panel max-w-[600px] h-auto shadow-2xl border-slate-200 py-20 items-center text-center">
                <div className="w-24 h-24 bg-slate-50 border-4 border-slate-800 rounded-full flex items-center justify-center mb-8 shadow-inner">
                    <span className="material-icons text-5xl text-slate-400">pending_actions</span>
                </div>

                <h2 className="text-3xl font-black text-slate-800 mb-4 tracking-tighter">
                    대시보드 시스템 준비 중
                </h2>

                <p className="text-slate-500 font-bold mb-12 leading-relaxed">
                    실시간 데이터 집계 및 AI 분석 엔진 초기화 중입니다.<br />
                    잠시 후 고도화된 운영 현황 서비스를 이용하실 수 있습니다.
                </p>

                <div className="flex gap-2">
                    <div className="h-2 w-12 bg-slate-800 rounded-full animate-pulse"></div>
                    <div className="h-2 w-12 bg-slate-200 rounded-full"></div>
                    <div className="h-2 w-12 bg-slate-200 rounded-full"></div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
