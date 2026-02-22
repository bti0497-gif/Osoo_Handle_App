import React from 'react';
import { useMedicineViewModel } from './useMedicineViewModel';
import PhotoUpload from '../../components/PhotoUpload';
import { useDialog } from '../../components/common/DialogProvider';

const MedicineManagementView = ({ currentUser }) => {
    const { showAlert } = useDialog();
    const {
        date,
        setDate,
        logs,
        loading,
        form,
        updateForm,
        submitForm
    } = useMedicineViewModel(currentUser, { showAlert });

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
        <div className="panel-container">
            {/* 약품 입력 패널 */}
            <div className="dynamic-panel shadow-2xl border-slate-200">
                <div className="panel-header bg-slate-50/50 flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">약품 관리</h1>
                        <p className="text-slate-500 text-[11px] font-medium">입고 및 사용량을 기록합니다.</p>
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
                                <label className="w-24 text-sm font-bold text-slate-600 text-right">약품명</label>
                                <div className="flex-1 relative">
                                    <select
                                        className="w-full border-2 border-slate-800 h-10 px-3 appearance-none focus:border-blue-500 outline-none bg-white font-bold"
                                        value={form.medicine_name}
                                        onChange={e => updateForm({ medicine_name: e.target.value })}
                                    >
                                        {medicineTypes.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                    </select>
                                    <span className="material-icons absolute right-2 top-2 pointer-events-none text-slate-800">arrow_drop_down</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <label className="w-24 text-sm font-bold text-slate-600 text-right">입고량 (kg/L)</label>
                                <input
                                    type="number" step="0.1"
                                    className="flex-1 border-2 border-slate-800 h-10 px-3 focus:border-green-500 outline-none font-bold text-green-600 bg-green-50/10"
                                    value={form.purchase_amount}
                                    placeholder="0.0"
                                    onChange={e => updateForm({ purchase_amount: e.target.value })}
                                />
                            </div>

                            <div className="flex items-center gap-4">
                                <label className="w-24 text-sm font-bold text-slate-600 text-right">사용량 (kg/L)</label>
                                <input
                                    type="number" step="0.1"
                                    className="flex-1 border-2 border-slate-800 h-10 px-3 focus:border-red-500 outline-none font-bold text-red-600 bg-red-50/10"
                                    value={form.usage_amount}
                                    placeholder="0.0"
                                    onChange={e => updateForm({ usage_amount: e.target.value })}
                                />
                            </div>

                            <div className="pt-4 border-t border-slate-100">
                                <label className="text-xs font-bold text-slate-800 mb-2 flex items-center gap-1">
                                    <span className="material-icons text-[16px]">receipt_long</span>
                                    거래명세표/사진
                                </label>
                                <PhotoUpload
                                    date={date}
                                    type={`medicine_${form.medicine_name}_delivery`}
                                    onUploadSuccess={(path) => console.log("Medicine photo uploaded:", path)}
                                />
                            </div>
                        </div>

                        <button type="submit" className="w-full bg-slate-800 text-white font-black py-5 rounded-2xl hover:bg-slate-700 transition-all shadow-xl active:scale-95 text-xl tracking-widest mt-8">
                            재고 기록 저장
                        </button>
                    </form>
                </div>
            </div>

            {/* 재고 현황 패널 */}
            <div className="dynamic-panel flex-1 max-w-[500px] border-slate-200">
                <div className="panel-header bg-slate-50/30">
                    <h2 className="text-lg font-bold text-slate-700 flex items-center gap-2">
                        <span className="material-icons text-corporate-blue">inventory_2</span>
                        실시간 재고 현황
                    </h2>
                </div>
                <div className="panel-content p-0">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b">
                            <tr>
                                <th className="px-6 py-4">약품명</th>
                                <th className="px-6 py-4">금일 변동</th>
                                <th className="px-6 py-4">현재 재고</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading ? (
                                <tr><td colSpan="3" className="text-center py-12 text-slate-400">Loading...</td></tr>
                            ) : medicineTypes.map(type => {
                                const log = logs.find(l => l.medicine_name === type.id);
                                const isLow = log && log.current_inventory < 10;
                                return (
                                    <tr key={type.id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-4 font-bold text-slate-700">{type.label}</td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col text-[11px] font-bold">
                                                {log?.purchase_amount > 0 && <span className="text-green-600">+{log.purchase_amount}</span>}
                                                {log?.usage_amount > 0 && <span className="text-red-500">-{log.usage_amount}</span>}
                                                {(!log?.purchase_amount && !log?.usage_amount) && <span className="text-slate-300">-</span>}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-base font-black ${isLow ? 'text-orange-600' : 'text-slate-800'}`}>
                                                    {log?.current_inventory?.toLocaleString() || '-'}
                                                    <span className="text-[10px] ml-1 font-bold text-slate-400">{type.unit}</span>
                                                </span>
                                                {isLow && <span className="material-icons text-orange-500 text-sm animate-pulse">warning</span>}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <div className="p-4 m-4 bg-blue-50/50 border border-blue-100 rounded-xl">
                        <p className="text-[10px] text-blue-700 leading-relaxed font-bold">
                            * 재고는 (전일재고 + 입고 - 사용) 으로 자동 계산됩니다. <br />
                            * 10단위 미만 시 경고 알림이 표시됩니다.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MedicineManagementView;
