import React from 'react';
import { useWaterQualityViewModel } from '../viewmodels/useWaterQualityViewModel';

const WaterQualityView = () => {
    const {
        date,
        setDate,
        records,
        loading,
        form,
        updateForm,
        submitForm
    } = useWaterQualityViewModel();

    const handleSubmit = (e) => {
        e.preventDefault();
        submitForm();
    };

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <header className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">수질 분석 관리</h1>
                    <p className="text-slate-500 text-sm">일일 수질 분석 결과 및 농도를 기록합니다.</p>
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

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-1">
                    <div className="glass-card p-6">
                        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <span className="material-icons text-corporate-blue">science</span>
                            분석값 입력
                        </h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">측정 위치</label>
                                <select
                                    className="form-input w-full"
                                    value={form.location}
                                    onChange={e => updateForm({ location: e.target.value })}
                                >
                                    <option>유입수</option>
                                    <option>생물반응조</option>
                                    <option>방류수</option>
                                </select>
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">NH3-N (mg/L)</label>
                                <input
                                    type="number" step="0.01" className="form-input w-full"
                                    value={form.nh3_n}
                                    onChange={e => updateForm({ nh3_n: e.target.value })}
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">NO3-N (mg/L)</label>
                                <input
                                    type="number" step="0.01" className="form-input w-full"
                                    value={form.no3_n}
                                    onChange={e => updateForm({ no3_n: e.target.value })}
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">PO4-P (mg/L)</label>
                                <input
                                    type="number" step="0.01" className="form-input w-full"
                                    value={form.po4_p}
                                    onChange={e => updateForm({ po4_p: e.target.value })}
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">알칼리도 (mg/L)</label>
                                <input
                                    type="number" step="1" className="form-input w-full"
                                    value={form.alkalinity}
                                    onChange={e => updateForm({ alkalinity: e.target.value })}
                                />
                            </div>

                            <div className="pt-4">
                                <button type="submit" className="w-full bg-slate-800 text-white font-bold py-3 rounded-lg hover:bg-slate-700 transition-all shadow-lg">
                                    저장하기
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                <div className="lg:col-span-3">
                    <div className="glass-card overflow-hidden">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-bottom text-center">
                                <tr>
                                    <th className="px-4 py-4">측정위치</th>
                                    <th className="px-4 py-4">NH3-N</th>
                                    <th className="px-4 py-4">NO3-N</th>
                                    <th className="px-4 py-4">PO4-P</th>
                                    <th className="px-4 py-4">알칼리도</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-center">
                                {loading ? (
                                    <tr><td colSpan="5" className="py-8 text-slate-400">Loading...</td></tr>
                                ) : records.length === 0 ? (
                                    <tr><td colSpan="5" className="py-8 text-slate-300 italic">분석 데이터가 없습니다.</td></tr>
                                ) : records.map(r => (
                                    <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-4 py-4 font-bold text-slate-700">{r.location}</td>
                                        <td className="px-4 py-4">{r.nh3_n}</td>
                                        <td className="px-4 py-4">{r.no3_n}</td>
                                        <td className="px-4 py-4">{r.po4_p}</td>
                                        <td className="px-4 py-4 font-bold text-blue-800">{r.alkalinity}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WaterQualityView;
