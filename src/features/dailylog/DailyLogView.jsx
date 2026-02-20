import React from 'react';
import { useDailyLogViewModel } from './useDailyLogViewModel';

const DailyLogView = ({ currentUser }) => {
    const {
        date,
        setDate,
        data,
        loading,
        handlePrint
    } = useDailyLogViewModel(currentUser);

    const API_BASE_URL = 'http://localhost:8901';

    return (
        <div className="panel-container">
            <div className="dynamic-panel flex-1 shadow-2xl border-slate-200">
                <div className="panel-header bg-slate-50/50 flex justify-between items-center no-print">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">통합 운영 일지 출력</h1>
                        <p className="text-slate-500 text-[11px] font-medium">관리자 승인 및 리포트 생성을 관리합니다.</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 bg-white border-2 border-slate-800 px-3 py-1 rounded-lg">
                            <span className="material-icons text-slate-400 text-sm">calendar_today</span>
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="border-none focus:ring-0 text-xs font-bold outline-none"
                            />
                        </div>
                        <button
                            onClick={handlePrint}
                            className="bg-slate-800 text-white px-4 py-2 rounded-lg font-black flex items-center gap-2 hover:bg-slate-700 transition-colors text-xs"
                        >
                            <span className="material-icons text-sm">print</span>
                            인쇄
                        </button>
                        <a
                            href={`${API_BASE_URL}/api/logs/generate-excel?date=${date}&templateName=template.xlsx`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-black flex items-center gap-2 hover:bg-emerald-700 transition-colors text-xs"
                        >
                            <span className="material-icons text-sm">description</span>
                            EXCEL
                        </a>
                    </div>
                </div>

                <div className="panel-content bg-slate-50/20 log-print-area">
                    {/* 실제 인쇄될 양식 */}
                    <div className="bg-white border-2 border-slate-800 p-8 shadow-sm max-w-[800px] mx-auto print:p-0 print:border-0 print:shadow-none">
                        <div className="text-center mb-8 border-b-4 border-slate-800 pb-6">
                            <h2 className="text-4xl font-black uppercase tracking-[0.3em] text-slate-900">운 영 일 지</h2>
                            <p className="text-xl font-black mt-4 border-2 border-slate-800 inline-block px-4 py-1">{date}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-8">
                            {/* 1. 유량 현황 */}
                            <section className="col-span-1">
                                <h3 className="text-xs font-black bg-slate-800 text-white px-2 py-1 mb-2 inline-block">1. 유량 가동 현황 (㎥)</h3>
                                <table className="w-full border-collapse border-2 border-slate-800 text-xs text-center">
                                    <thead>
                                        <tr className="bg-slate-100">
                                            <th className="border-2 border-slate-800 p-1">구분</th>
                                            <th className="border-2 border-slate-800 p-1">검침값</th>
                                            <th className="border-2 border-slate-800 p-1">금일발생</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {loading ? (
                                            <tr><td colSpan="3" className="p-4">...</td></tr>
                                        ) : ['inflow', 'discharge', 'sludge'].map(t => {
                                            const r = data.flows.find(f => f.type === t);
                                            let label = t === 'inflow' ? '유입량' : t === 'discharge' ? '방류량' : '잉여슬러지';
                                            return (
                                                <tr key={t}>
                                                    <td className="border-2 border-slate-800 p-1 font-black">{label}</td>
                                                    <td className="border-2 border-slate-800 p-1 font-mono">{r?.raw_value || '-'}</td>
                                                    <td className="border-2 border-slate-800 p-1 font-mono font-black">{r?.calculated_flow || '-'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </section>

                            {/* 2. 약품 수급 */}
                            <section className="col-span-1">
                                <h3 className="text-xs font-black bg-slate-800 text-white px-2 py-1 mb-2 inline-block">2. 약품 수급 및 재고</h3>
                                <table className="w-full border-collapse border-2 border-slate-800 text-xs text-center">
                                    <thead>
                                        <tr className="bg-slate-100">
                                            <th className="border-2 border-slate-800 p-1">약품명</th>
                                            <th className="border-2 border-slate-800 p-1">입/사용</th>
                                            <th className="border-2 border-slate-800 p-1 font-black">현재고</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {loading ? (
                                            <tr><td colSpan="3" className="p-4">...</td></tr>
                                        ) : data.medicines.map(m => (
                                            <tr key={m.id}>
                                                <td className="border-2 border-slate-800 p-1 font-black">{m.medicine_name}</td>
                                                <td className="border-2 border-slate-800 p-1 text-[10px]">
                                                    {m.purchase_amount}/{m.usage_amount}
                                                </td>
                                                <td className="border-2 border-slate-800 p-1 font-black bg-slate-50">{m.current_inventory}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </section>

                            {/* 3. 분석 데이터 */}
                            <section className="col-span-2">
                                <h3 className="text-xs font-black bg-slate-800 text-white px-2 py-1 mb-2 inline-block">3. 수질 분석 데이터</h3>
                                <table className="w-full border-collapse border-2 border-slate-800 text-xs text-center">
                                    <thead>
                                        <tr className="bg-slate-100">
                                            <th className="border-2 border-slate-800 p-1">위치</th>
                                            <th className="border-2 border-slate-800 p-1">NH3-N</th>
                                            <th className="border-2 border-slate-800 p-1">NO3-N</th>
                                            <th className="border-2 border-slate-800 p-1">PO4-P</th>
                                            <th className="border-2 border-slate-800 p-1 font-black">알칼리도</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {loading ? (
                                            <tr><td colSpan="5" className="p-4">...</td></tr>
                                        ) : data.waterQuality.map(w => (
                                            <tr key={w.id}>
                                                <td className="border-2 border-slate-800 p-1 font-black">{w.location}</td>
                                                <td className="border-2 border-slate-800 p-1 font-mono">{w.nh3_n}</td>
                                                <td className="border-2 border-slate-800 p-1 font-mono">{w.no3_n}</td>
                                                <td className="border-2 border-slate-800 p-1 font-mono">{w.po4_p}</td>
                                                <td className="border-2 border-slate-800 p-1 font-black text-blue-800 bg-blue-50/30">{w.alkalinity}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </section>

                            {/* 4. 특이사항/시설관리 */}
                            <section className="col-span-2">
                                <h3 className="text-xs font-black bg-slate-800 text-white px-2 py-1 mb-2 inline-block">4. 시설 유지관리 및 특이사항</h3>
                                <div className="border-2 border-slate-800 p-4 min-h-[150px] text-xs">
                                    {loading ? (
                                        <p className="text-center p-4">Loading...</p>
                                    ) : data.facilities.map(f => (
                                        <div key={f.id} className="mb-4 border-b border-slate-200 pb-2">
                                            <p className="font-black underline mb-1">[{f.facility_name}] - {f.company || '자체'}</p>
                                            <p className="leading-relaxed font-medium">{f.content}</p>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>

                        <div className="mt-12 flex justify-end gap-12 text-sm font-black">
                            <div className="flex flex-col items-center">
                                <span>담당자</span>
                                <div className="w-16 h-16 border-2 border-slate-800 mt-2 flex items-center justify-center text-slate-200 font-black text-xl">印</div>
                            </div>
                            <div className="flex flex-col items-center">
                                <span>관리책임자</span>
                                <div className="w-16 h-16 border-2 border-slate-800 mt-2 flex items-center justify-center text-slate-200 font-black text-xl">印</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <style>{`
                @media print {
                    .no-print { display: none !important; }
                    body { background: white; width: 210mm; height: 297mm; }
                    .main-content { padding: 0 !important; margin: 0 !important; overflow: visible !important; }
                    .app-shell, .app-main-body, .sidebar, .header, .status-bar { display: none !important; }
                    .panel-container { padding: 0 !important; height: auto !important; width: 100% !important; overflow: visible !important; }
                    .dynamic-panel { width: 100% !important; height: auto !important; border: none !important; box-shadow: none !important; border-radius: 0 !important; overflow: visible !important; }
                    .panel-content { padding: 0 !important; overflow: visible !important; }
                    .log-print-area { padding: 0 !important; width: 100% !important; max-width: none !important; }
                }
            `}</style>
        </div>
    );
};

export default DailyLogView;
