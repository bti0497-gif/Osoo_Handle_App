import React from 'react';
import { useDailyLogViewModel } from '../viewmodels/useDailyLogViewModel';

const DailyLogView = () => {
    const {
        date,
        setDate,
        data,
        loading,
        handlePrint
    } = useDailyLogViewModel();

    const API_BASE_URL = 'http://localhost:8901';

    return (
        <div className="p-8 max-w-5xl mx-auto bg-white min-h-screen log-print-area">
            <header className="flex justify-between items-center mb-10 no-print">
                <h1 className="text-2xl font-bold">통합 운영 일지 출력</h1>
                <div className="flex gap-4">
                    <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="form-input"
                    />
                    <button
                        onClick={handlePrint}
                        className="bg-corporate-blue text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700 transition-colors"
                    >
                        <span className="material-icons">print</span>
                        일지 인쇄하기
                    </button>
                    <a
                        href={`${API_BASE_URL}/api/logs/generate-excel?date=${date}&templateName=template.xlsx`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-emerald-600 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-emerald-700 transition-colors"
                    >
                        <span className="material-icons">description</span>
                        Excel 다운로드
                    </a>
                </div>
            </header>

            {/* 실제 인쇄될 양식 */}
            <div className="border-4 border-slate-800 p-8 print:p-0 print:border-0">
                <div className="text-center mb-8 border-b-2 border-slate-800 pb-6">
                    <h2 className="text-3xl font-black uppercase tracking-widest text-slate-900">운 영 일 지</h2>
                    <p className="text-lg font-bold mt-2">{date}</p>
                </div>

                <div className="grid grid-cols-2 gap-8">
                    {/* 1. 유량 현황 */}
                    <section className="col-span-1">
                        <h3 className="text-sm font-black bg-slate-800 text-white px-2 py-1 mb-2 inline-block">1. 유량 가동 현황 (㎥)</h3>
                        <table className="w-full border-collapse border border-slate-800 text-xs">
                            <thead>
                                <tr className="bg-slate-100">
                                    <th className="border border-slate-800 p-1">구분</th>
                                    <th className="border border-slate-800 p-1 text-right">검침값</th>
                                    <th className="border border-slate-800 p-1 text-right">금일유량</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan="3" className="text-center p-4">불러오는 중...</td></tr>
                                ) : ['inflow', 'discharge', 'sludge'].map(t => {
                                    const r = data.flows.find(f => f.type === t);
                                    let label = t === 'inflow' ? '유입량' : t === 'discharge' ? '방류량' : '잉여슬러지';
                                    return (
                                        <tr key={t}>
                                            <td className="border border-slate-800 p-1 font-bold">{label}</td>
                                            <td className="border border-slate-800 p-1 text-right">{r?.raw_value || '-'}</td>
                                            <td className="border border-slate-800 p-1 text-right">{r?.calculated_flow || '-'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </section>

                    {/* 2. 약품 수급 */}
                    <section className="col-span-1">
                        <h3 className="text-sm font-black bg-slate-800 text-white px-2 py-1 mb-2 inline-block">2. 약품 수급 및 재고</h3>
                        <table className="w-full border-collapse border border-slate-800 text-xs">
                            <thead>
                                <tr className="bg-slate-100">
                                    <th className="border border-slate-800 p-1 text-left">약품명</th>
                                    <th className="border border-slate-800 p-1 text-right">입고</th>
                                    <th className="border border-slate-800 p-1 text-right">사용</th>
                                    <th className="border border-slate-800 p-1 text-right">재고</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan="4" className="text-center p-4">불러오는 중...</td></tr>
                                ) : data.medicines.map(m => (
                                    <tr key={m.id}>
                                        <td className="border border-slate-800 p-1 font-bold">{m.medicine_name}</td>
                                        <td className="border border-slate-800 p-1 text-right">{m.purchase_amount}</td>
                                        <td className="border border-slate-800 p-1 text-right">{m.usage_amount}</td>
                                        <td className="border border-slate-800 p-1 text-right bg-slate-50 font-bold">{m.current_inventory}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>

                    {/* 3. 분석 데이터 */}
                    <section className="col-span-2">
                        <h3 className="text-sm font-black bg-slate-800 text-white px-2 py-1 mb-2 inline-block">3. 수질 분석 및 수동 측정</h3>
                        <table className="w-full border-collapse border border-slate-800 text-xs text-center">
                            <thead>
                                <tr className="bg-slate-100">
                                    <th className="border border-slate-800 p-1">측정위치</th>
                                    <th className="border border-slate-800 p-1">NH3-N</th>
                                    <th className="border border-slate-800 p-1">NO3-N</th>
                                    <th className="border border-slate-800 p-1">PO4-P</th>
                                    <th className="border border-slate-800 p-1">알칼리도</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr><td colSpan="5" className="text-center p-4">불러오는 중...</td></tr>
                                ) : data.waterQuality.map(w => (
                                    <tr key={w.id}>
                                        <td className="border border-slate-800 p-1 font-bold">{w.location}</td>
                                        <td className="border border-slate-800 p-1">{w.nh3_n}</td>
                                        <td className="border border-slate-800 p-1">{w.no3_n}</td>
                                        <td className="border border-slate-800 p-1">{w.po4_p}</td>
                                        <td className="border border-slate-800 p-1 font-bold text-blue-800">{w.alkalinity}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>

                    {/* 4. 특이사항/시설관리 */}
                    <section className="col-span-2">
                        <h3 className="text-sm font-black bg-slate-800 text-white px-2 py-1 mb-2 inline-block">4. 시설 유지관리 및 특이사항</h3>
                        <div className="border border-slate-800 p-4 min-h-[150px] text-xs">
                            {loading ? (
                                <p className="text-center p-4">불러오는 중...</p>
                            ) : data.facilities.map(f => (
                                <div key={f.id} className="mb-4 border-b border-slate-200 pb-2">
                                    <p className="font-bold underline mb-1">[{f.facility_name}] - {f.company || '자체'}</p>
                                    <p className="leading-relaxed">{f.content}</p>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>

                <div className="mt-12 flex justify-end gap-12 text-sm font-bold">
                    <div className="flex flex-col items-center">
                        <span>담당자</span>
                        <div className="w-16 h-16 border border-slate-400 mt-2 flex items-center justify-center text-slate-300 font-light">(인)</div>
                    </div>
                    <div className="flex flex-col items-center">
                        <span>관리책임자</span>
                        <div className="w-16 h-16 border border-slate-400 mt-2 flex items-center justify-center text-slate-300 font-light">(인)</div>
                    </div>
                </div>
            </div>

            <style>{`
                @media print {
                    .no-print { display: none !important; }
                    body { background: white; }
                    .main-content { padding: 0 !important; margin: 0 !important; }
                    .app-shell, .app-main-body, .sidebar, .header, .status-bar { display: none !important; }
                    .log-print-area { padding: 0 !important; width: 100% !important; max-width: none !important; }
                }
            `}</style>
        </div>
    );
};

export default DailyLogView;
