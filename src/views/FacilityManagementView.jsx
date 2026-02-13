import React from 'react';
import { useFacilityViewModel } from '../viewmodels/useFacilityViewModel';

const FacilityManagementView = () => {
    const {
        date,
        setDate,
        logs,
        loading,
        form,
        updateForm,
        submitForm
    } = useFacilityViewModel();

    const handleSubmit = (e) => {
        e.preventDefault();
        submitForm();
    };

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <header className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">시설 유지관리 및 특이사항</h1>
                    <p className="text-slate-500 text-sm">일일 기기 점검, 수리 및 특이사항을 기록합니다.</p>
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

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1">
                    <div className="glass-card p-6">
                        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <span className="material-icons text-corporate-blue">settings</span>
                            점검 내용 기록
                        </h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">기기/시설명</label>
                                <input
                                    className="form-input w-full"
                                    value={form.facility_name}
                                    onChange={e => updateForm({ facility_name: e.target.value })}
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">내용 및 조치</label>
                                <textarea
                                    className="form-input w-full min-h-[100px]"
                                    value={form.content}
                                    onChange={e => updateForm({ content: e.target.value })}
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">업체/부품 (선택)</label>
                                <input
                                    className="form-input w-full"
                                    value={form.company}
                                    onChange={e => updateForm({ company: e.target.value })}
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">소요 비용 (선택)</label>
                                <input
                                    type="number" className="form-input w-full"
                                    value={form.price}
                                    onChange={e => updateForm({ price: e.target.value })}
                                />
                            </div>

                            <div className="pt-4">
                                <button type="submit" className="w-full bg-slate-800 text-white font-bold py-3 rounded-lg hover:bg-slate-700 transition-all shadow-lg active:scale-95">
                                    기록 저장하기
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                <div className="lg:col-span-2">
                    <div className="space-y-4">
                        {loading ? (
                            <p className="text-center py-8 text-slate-400">Loading...</p>
                        ) : logs.length === 0 ? (
                            <div className="glass-card p-12 text-center text-slate-300 italic">
                                기록된 시설 관리 일지가 없습니다.
                            </div>
                        ) : logs.map(log => (
                            <div key={log.id} className="glass-card p-6 border-l-4 border-corporate-blue">
                                <header className="flex justify-between items-start mb-2">
                                    <h3 className="font-bold text-lg text-slate-800">{log.facility_name}</h3>
                                    {log.price > 0 && <span className="text-xs bg-slate-100 px-2 py-1 rounded font-bold text-slate-500">₩{log.price.toLocaleString()}</span>}
                                </header>
                                <p className="text-slate-600 text-sm leading-relaxed mb-4">{log.content}</p>
                                <footer className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex justify-between">
                                    <span>{log.company ? `협력사: ${log.company}` : '자체 점검'}</span>
                                    <span>{log.date}</span>
                                </footer>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FacilityManagementView;
