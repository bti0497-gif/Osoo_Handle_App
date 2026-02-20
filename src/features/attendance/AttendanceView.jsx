import React from 'react';
import { useAttendanceViewModel } from './useAttendanceViewModel';

const AttendanceView = ({ currentUser }) => {
    const {
        date,
        setDate,
        logs,
        loading
    } = useAttendanceViewModel(currentUser);

    return (
        <div className="panel-container">
            <div className="dynamic-panel flex-1 shadow-2xl border-slate-200">
                <div className="panel-header bg-slate-50/50 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">근태 및 출석 기록</h1>
                        <p className="text-slate-500 text-[11px] font-medium">현장 근무자의 출결 상황을 모니터링합니다.</p>
                    </div>
                    <div className="flex items-center gap-2 bg-white border-2 border-slate-800 px-3 py-1 rounded-lg">
                        <span className="material-icons text-slate-400 text-sm">calendar_today</span>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="border-none focus:ring-0 text-xs font-bold outline-none"
                        />
                    </div>
                </div>

                <div className="panel-content p-0">
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
                                <tr><td colSpan="5" className="px-6 py-12 text-center text-slate-400 font-bold">Loading logs...</td></tr>
                            ) : logs.length === 0 ? (
                                <tr><td colSpan="5" className="px-6 py-12 text-center text-slate-300 italic">No attendance records for this date.</td></tr>
                            ) : logs.map((log) => (
                                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-6 py-4 font-black text-slate-700">{log.member_name}</td>
                                    <td className="px-6 py-4 text-slate-600 font-bold">
                                        {log.login_time ? new Date(log.login_time).toLocaleTimeString() : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-slate-600 font-bold">
                                        {log.logout_time ? new Date(log.logout_time).toLocaleTimeString() : <span className="text-orange-500 font-black animate-pulse">근무 중</span>}
                                    </td>
                                    <td className="px-6 py-4">
                                        {log.is_remote ? (
                                            <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded text-[10px] font-black border-2 border-blue-200">원격 접속</span>
                                        ) : (
                                            <span className="bg-emerald-50 text-emerald-600 px-2 py-1 rounded text-[10px] font-black border-2 border-emerald-200">현장 출석</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <span className={`w-3 h-3 rounded-full border-2 border-white shadow-sm ${log.logout_time ? 'bg-slate-300' : 'bg-emerald-500 animate-bounce'}`}></span>
                                            <span className="text-xs font-black text-slate-500">{log.logout_time ? '퇴근' : '정상'}</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="p-6 bg-slate-50/50 border-t border-slate-100">
                        <div className="flex gap-3 text-slate-400">
                            <span className="material-icons text-lg">info</span>
                            <p className="text-[10px] leading-relaxed font-bold">
                                * 시스템은 GPS 위치 정보를 기반으로 출석을 기록합니다. <br />
                                * 사전 지정된 사업장 반경(500m) 밖 접속 시 '원격 접속'으로 자동 분류됩니다.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AttendanceView;
