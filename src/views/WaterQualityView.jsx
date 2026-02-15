import React from 'react';
import { useWaterQualityViewModel } from '../viewmodels/useWaterQualityViewModel';

const WaterQualityView = ({ currentUser }) => {
    const {
        date,
        setDate,
        records,
        loading,
        form,
        updateForm,
        submitForm
    } = useWaterQualityViewModel(undefined, currentUser);

    const handleSubmit = (e) => {
        e.preventDefault();
        submitForm();
    };

    return (
        <div className="panel-container">
            {/* 분석값 입력 패널 */}
            <div className="dynamic-panel shadow-2xl border-slate-200">
                <div className="panel-header bg-slate-50/50 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">수질 분석 관리</h1>
                        <p className="text-slate-500 text-[11px] font-medium">일일 수질 분석 결과 및 농도를 기록합니다.</p>
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

                <div className="panel-content">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-4">
                            <div className="flex items-center gap-4">
                                <label className="w-24 text-sm font-bold text-slate-600 text-right">측정 위치</label>
                                <div className="flex-1 relative">
                                    <select
                                        className="w-full border-2 border-slate-800 h-10 px-3 appearance-none focus:border-blue-500 outline-none bg-white font-bold"
                                        value={form.location}
                                        onChange={e => updateForm({ location: e.target.value })}
                                    >
                                        <option>유입수</option>
                                        <option>생물반응조</option>
                                        <option>방류수</option>
                                    </select>
                                    <span className="material-icons absolute right-2 top-2 pointer-events-none text-slate-800">arrow_drop_down</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <label className="w-24 text-sm font-bold text-slate-600 text-right">NH3-N (mg/L)</label>
                                <input
                                    type="number" step="0.01"
                                    className="flex-1 border-2 border-slate-800 h-10 px-3 focus:border-blue-500 outline-none font-bold text-lg font-mono"
                                    value={form.nh3_n}
                                    placeholder="0.00"
                                    onChange={e => updateForm({ nh3_n: e.target.value })}
                                />
                            </div>

                            <div className="flex items-center gap-4">
                                <label className="w-24 text-sm font-bold text-slate-600 text-right">NO3-N (mg/L)</label>
                                <input
                                    type="number" step="0.01"
                                    className="flex-1 border-2 border-slate-800 h-10 px-3 focus:border-blue-500 outline-none font-bold text-lg font-mono"
                                    value={form.no3_n}
                                    placeholder="0.00"
                                    onChange={e => updateForm({ no3_n: e.target.value })}
                                />
                            </div>

                            <div className="flex items-center gap-4">
                                <label className="w-24 text-sm font-bold text-slate-600 text-right">PO4-P (mg/L)</label>
                                <input
                                    type="number" step="0.01"
                                    className="flex-1 border-2 border-slate-800 h-10 px-3 focus:border-blue-500 outline-none font-bold text-lg font-mono"
                                    value={form.po4_p}
                                    placeholder="0.00"
                                    onChange={e => updateForm({ po4_p: e.target.value })}
                                />
                            </div>

                            <div className="flex items-center gap-4">
                                <label className="w-24 text-sm font-bold text-slate-600 text-right">알칼리도</label>
                                <input
                                    type="number" step="1"
                                    className="flex-1 border-2 border-slate-800 h-10 px-3 focus:border-blue-500 outline-none font-bold text-lg font-mono text-blue-800"
                                    value={form.alkalinity}
                                    placeholder="0"
                                    onChange={e => updateForm({ alkalinity: e.target.value })}
                                />
                            </div>
                        </div>

                        <button type="submit" className="w-full bg-slate-800 text-white font-black py-5 rounded-2xl hover:bg-slate-700 transition-all shadow-xl active:scale-95 text-xl tracking-widest mt-8">
                            분석 결과 저장
                        </button>
                    </form>
                </div>
            </div>

            {/* 현황 패널 */}
            <div className="dynamic-panel flex-1 max-w-[600px] border-slate-200">
                <div className="panel-header bg-slate-50/30">
                    <h2 className="text-lg font-bold text-slate-700 flex items-center gap-2">
                        <span className="material-icons text-corporate-blue">assessment</span>
                        금일 분석 데이터
                    </h2>
                </div>
                <div className="panel-content p-0">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b">
                            <tr>
                                <th className="px-6 py-4">위치</th>
                                <th className="px-4 py-4 text-center">NH3-N</th>
                                <th className="px-4 py-4 text-center">NO3-N</th>
                                <th className="px-4 py-4 text-center">PO4-P</th>
                                <th className="px-4 py-4 text-center">알칼리도</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr><td colSpan="5" className="text-center py-12 text-slate-400">Loading...</td></tr>
                            ) : records.length === 0 ? (
                                <tr><td colSpan="5" className="text-center py-12 text-slate-300 italic">No records for today.</td></tr>
                            ) : records.map(r => (
                                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-6 py-4 font-bold text-slate-700">{r.location}</td>
                                    <td className="px-4 py-4 text-center font-mono">{r.nh3_n}</td>
                                    <td className="px-4 py-4 text-center font-mono">{r.no3_n}</td>
                                    <td className="px-4 py-4 text-center font-mono">{r.po4_p}</td>
                                    <td className="px-4 py-4 text-center font-black text-blue-800">{r.alkalinity}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default WaterQualityView;
