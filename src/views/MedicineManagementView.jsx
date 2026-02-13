import React from 'react';
import { useMedicineViewModel } from '../viewmodels/useMedicineViewModel';
import PhotoUpload from '../components/PhotoUpload';

const MedicineManagementView = () => {
    const {
        date,
        setDate,
        logs,
        loading,
        form,
        updateForm,
        submitForm
    } = useMedicineViewModel();

    const medicineTypes = [
        { id: 'hypochlorite', label: '차아염소산나트륨', unit: 'kg' },
        { id: 'pac', label: 'PAC', unit: 'kg' },
        { id: 'polymer', label: '고분자응집제', unit: 'kg' },
        { id: 'methanol', label: '메탄올', unit: 'L' },
        { id: 'defoamer', label: '소포제', unit: 'L' }
    ];

    const handleSubmit = (e) => {
        e.preventDefault();
        submitForm();
    };

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <header className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">약품 관리 및 재고</h1>
                    <p className="text-slate-500 text-sm">약품의 입고, 사용량 및 현재 재고를 관리합니다.</p>
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
                {/* 입력 폼 */}
                <div className="lg:col-span-1">
                    <div className="glass-card p-6 sticky top-6">
                        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                            <span className="material-icons text-corporate-blue">inventory</span>
                            약품 기록
                        </h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">약품명</label>
                                <select
                                    className="form-input w-full"
                                    value={form.medicine_name}
                                    onChange={e => updateForm({ medicine_name: e.target.value })}
                                >
                                    {medicineTypes.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                </select>
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">입고량 (Purchase)</label>
                                <input
                                    type="number" step="0.1"
                                    className="form-input w-full border-green-100 focus:border-green-500"
                                    value={form.purchase_amount}
                                    placeholder="0.0"
                                    onChange={e => updateForm({ purchase_amount: e.target.value })}
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-slate-500">사용량 (Usage)</label>
                                <input
                                    type="number" step="0.1"
                                    className="form-input w-full border-red-100 focus:border-red-500"
                                    value={form.usage_amount}
                                    placeholder="0.0"
                                    onChange={e => updateForm({ usage_amount: e.target.value })}
                                />
                            </div>

                            <div className="space-y-2 py-4 border-y border-slate-100">
                                <label className="text-xs font-bold text-slate-800 flex items-center gap-1">
                                    <span className="material-icons text-[14px]">photo_camera</span>
                                    약품 입고 및 거래명세표 사진 (선택)
                                </label>
                                <PhotoUpload
                                    date={date}
                                    type={`medicine_${form.medicine_name}_delivery`}
                                    onUploadSuccess={(path) => console.log("Medicine photo uploaded:", path)}
                                />
                                <p className="text-[10px] text-slate-400 leading-tight">
                                    * 업로드된 사진은 일지 생성 시 지정된 양식 칸에 자동 리사이징되어 삽입됩니다. (보안 가공 처리됨)
                                </p>
                            </div>

                            <div className="pt-4">
                                <button type="submit" className="w-full bg-slate-800 text-white font-bold py-3 rounded-lg hover:bg-slate-700 transition-all shadow-lg active:scale-95">
                                    기록 저장하기
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                {/* 데이터 테이블 */}
                <div className="lg:col-span-2">
                    <div className="glass-card overflow-hidden">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-bottom">
                                <tr>
                                    <th className="px-6 py-4">약품명</th>
                                    <th className="px-6 py-4">입고량</th>
                                    <th className="px-6 py-4">사용량</th>
                                    <th className="px-6 py-4">현재 재고</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {loading ? (
                                    <tr>
                                        <td colSpan="4" className="text-center py-8 text-slate-400">불러오는 중...</td>
                                    </tr>
                                ) : medicineTypes.map(type => {
                                    const log = logs.find(l => l.medicine_name === type.id);
                                    return (
                                        <tr key={type.id} className="hover:bg-slate-50 transition-colors">
                                            <td className="px-6 py-4 font-bold text-slate-700">{type.label}</td>
                                            <td className="px-6 py-4 text-green-600 font-semibold">
                                                {log?.purchase_amount ? `+ ${log.purchase_amount} ${type.unit}` : '-'}
                                            </td>
                                            <td className="px-6 py-4 text-red-500 font-semibold">
                                                {log?.usage_amount ? `- ${log.usage_amount} ${type.unit}` : '-'}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <span className={`font-bold ${!log || log.current_inventory < 10 ? 'text-orange-500' : 'text-slate-700'}`}>
                                                        {log?.current_inventory?.toLocaleString() || '-'} {type.unit}
                                                    </span>
                                                    {!log && <span className="text-[10px] text-slate-400 italic">연속 데이터 없음</span>}
                                                    {log && log.current_inventory < 10 && (
                                                        <span className="material-icons text-orange-500 text-sm animate-pulse">warning</span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="mt-4 p-4 bg-blue-50 border border-blue-100 rounded-lg flex gap-3 text-blue-700">
                        <span className="material-icons">info</span>
                        <p className="text-xs leading-relaxed">
                            현재 재고는 전일 재고량을 기준으로 <strong>(입고량 - 사용량)</strong>이 자동 합산되어 계산됩니다. <br />
                            재고가 부족한 항목(10kg/L 미만)은 자동으로 경고 아이콘이 표시됩니다.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MedicineManagementView;
