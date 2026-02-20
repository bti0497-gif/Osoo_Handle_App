import React from 'react';
import { useFacilityViewModel } from './useFacilityViewModel';

const FacilityManagementView = ({ currentUser }) => {
    const {
        date,
        setDate,
        logs,
        loading,
        form,
        updateForm,
        submitForm
    } = useFacilityViewModel(undefined, currentUser);

    const handleSubmit = (e) => {
        e.preventDefault();
        submitForm();
    };

    return (
        <div className="panel-container">
            {/* 점검 내용 기록 패널 */}
            <div className="dynamic-panel shadow-2xl border-slate-200">
                <div className="panel-header bg-slate-50/50 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">시설/특이사항 기록</h1>
                        <p className="text-slate-500 text-[11px] font-medium">기기 점검 및 수리 내용을 기록합니다.</p>
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
                            <div className="flex flex-col gap-1">
                                <label className="text-sm font-black text-slate-600">기기/시설명</label>
                                <input
                                    className="w-full border-2 border-slate-800 h-10 px-3 focus:border-blue-500 outline-none font-bold"
                                    value={form.facility_name}
                                    placeholder="예) 유입 펌프 #1"
                                    onChange={e => updateForm({ facility_name: e.target.value })}
                                />
                            </div>

                            <div className="flex flex-col gap-1">
                                <label className="text-sm font-black text-slate-600">내용 및 조치</label>
                                <textarea
                                    className="w-full border-2 border-slate-800 min-h-[120px] p-3 focus:border-blue-500 outline-none font-medium leading-relaxed"
                                    value={form.content}
                                    placeholder="상세 내용을 입력하세요."
                                    onChange={e => updateForm({ content: e.target.value })}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="flex flex-col gap-1">
                                    <label className="text-sm font-black text-slate-600">업체/부품</label>
                                    <input
                                        className="w-full border-2 border-slate-800 h-10 px-3 focus:border-blue-500 outline-none font-bold"
                                        value={form.company}
                                        placeholder="자체점검"
                                        onChange={e => updateForm({ company: e.target.value })}
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-sm font-black text-slate-600">소요 비용</label>
                                    <input
                                        type="number"
                                        className="w-full border-2 border-slate-800 h-10 px-3 focus:border-blue-500 outline-none font-bold font-mono"
                                        value={form.price}
                                        placeholder="0"
                                        onChange={e => updateForm({ price: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>

                        <button type="submit" className="w-full bg-slate-800 text-white font-black py-5 rounded-2xl hover:bg-slate-700 transition-all shadow-xl active:scale-95 text-xl tracking-widest mt-8">
                            점검 내용 저장
                        </button>
                    </form>
                </div>
            </div>

            {/* 일지 목록 패널 */}
            <div className="dynamic-panel flex-1 min-w-[400px] border-slate-200">
                <div className="panel-header bg-slate-50/30">
                    <h2 className="text-lg font-bold text-slate-700 flex items-center gap-2">
                        <span className="material-icons text-corporate-blue">history</span>
                        최근 기록 내역
                    </h2>
                </div>
                <div className="panel-content space-y-4">
                    {loading ? (
                        <p className="text-center py-12 text-slate-400 font-bold">Loading records...</p>
                    ) : logs.length === 0 ? (
                        <div className="text-center py-20 text-slate-300 italic">
                            <span className="material-icons text-4xl mb-2">inbox</span>
                            <p>기록된 내역이 없습니다.</p>
                        </div>
                    ) : logs.map(log => (
                        <div key={log.id} className="bg-slate-50 border-2 border-slate-200 p-4 rounded-xl hover:border-corporate-blue transition-colors group">
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="font-black text-slate-800 group-hover:text-corporate-blue transition-colors">{log.facility_name}</h3>
                                {log.price > 0 && (
                                    <span className="text-[10px] bg-slate-200 px-2 py-1 rounded font-black text-slate-600">
                                        ₩ {log.price.toLocaleString()}
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-slate-600 leading-relaxed mb-3 font-medium">{log.content}</p>
                            <div className="flex justify-between items-center text-[10px] font-black text-slate-400 uppercase tracking-tighter">
                                <span>{log.company || '자체 점검'}</span>
                                <span>{log.date}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default FacilityManagementView;
