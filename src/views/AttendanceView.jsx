import React from 'react';
import { useAttendanceViewModel } from '../viewmodels/useAttendanceViewModel';

const AttendanceView = () => {
    const {
        date,
        setDate,
        logs,
        loading
    } = useAttendanceViewModel();

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <header className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">근태 및 출석 기록</h1>
                    <p className="text-slate-500 text-sm">현장 근무자의 출석 및 퇴근 기록을 확인합니다.</p>
                </div>
                <div className="flex items-center gap-2 bg-white border border-slate-200 p-2 rounded-lg shadow-sm">
                    <span className="material-icons text-slate-400">calendar_today</span>
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="border-none focus:ring-0 text-sm font-semibold"
                    />
                </div>
            </header>

            <div className="glass-card overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b">
                        <tr>
                            <th className="px-6 py-4">성명</th>
                            <th className="px-6 py-4">출근 시간</th>
                            <th className="px-6 py-4">퇴근 시간</th>
                            <th className="px-6 py-4">접속 환경</th>
                            <th className="px-6 py-4">상태</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? (
                            <tr>
                                <td colSpan="5" className="px-6 py-8 text-center text-slate-400">데이터를 불러오는 중...</td>
                            </tr>
                        ) : logs.length === 0 ? (
                            <tr>
                                <td colSpan="5" className="px-6 py-8 text-center text-slate-400 italic">기록된 근태 내역이 없습니다.</td>
                            </tr>
                        ) : logs.map((log) => (
                            <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-4 font-bold text-slate-700">{log.member_name}</td>
                                <td className="px-6 py-4 text-slate-600">
                                    {log.login_time ? new Date(log.login_time).toLocaleTimeString() : '-'}
                                </td>
                                <td className="px-6 py-4 text-slate-600">
                                    {log.logout_time ? new Date(log.logout_time).toLocaleTimeString() : <span className="text-orange-500 font-medium">근무 중</span>}
                                </td>
                                <td className="px-6 py-4">
                                    {log.is_remote ? (
                                        <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded text-[10px] font-bold border border-blue-100">원격 접속</span>
                                    ) : (
                                        <span className="bg-emerald-50 text-emerald-600 px-2 py-1 rounded text-[10px] font-bold border border-emerald-100">현장 출석</span>
                                    )}
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`w-2 h-2 rounded-full inline-block mr-2 ${log.logout_time ? 'bg-slate-300' : 'bg-emerald-500 animate-pulse'}`}></span>
                                    <span className="text-xs">{log.logout_time ? '퇴근' : '정상'}</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="mt-6 p-4 bg-slate-50 border border-slate-100 rounded-lg flex gap-3 text-slate-500">
                <span className="material-icons text-sm mt-0.5">help_outline</span>
                <p className="text-[11px] leading-relaxed">
                    본 시스템은 GPS 위치 정보를 기반으로 출석을 기록합니다. 사전에 지정된 사업장 반경(기본 500m) 밖에서 로그인할 경우 <strong>'원격 접속'</strong>으로 자동 분류됩니다.
                </p>
            </div>
        </div>
    );
};

export default AttendanceView;
