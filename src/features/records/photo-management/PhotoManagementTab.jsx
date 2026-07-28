import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MedicineInModel } from '../../medicine/MedicineInModel';
import { SludgePhotoModel } from '../../sludge/SludgePhotoModel';
import SludgePhotoButton from '../../sludge/SludgePhotoButton';

const CATEGORIES = [
    { id: 'sludge', label: '슬러지 사진' },
    { id: 'medicine', label: '약품 입고사진' },
    { id: 'kit', label: '키트 입고사진' },
];

const amount = (value) => Number(value || 0).toLocaleString();

export default function PhotoManagementTab({ date, onError }) {
    const [category, setCategory] = useState('sludge');
    const [data, setData] = useState({ sludge: [], medicines: [], kits: [], tradePhotoDates: [] });
    const [loading, setLoading] = useState(false);
    const [busyKey, setBusyKey] = useState('');

    const [year, month] = useMemo(
        () => String(date || '').split('-').map(Number),
        [date]
    );

    const reload = useCallback(async () => {
        if (!year || !month) return;
        setLoading(true);
        try {
            const [sludge, inventory] = await Promise.all([
                SludgePhotoModel.fetchByMonth(year, month),
                MedicineInModel.fetchMonthly(year, month),
            ]);
            if (!sludge?.success) throw new Error(sludge?.error || '슬러지 사진 정보를 불러오지 못했습니다.');
            if (!inventory?.success) throw new Error(inventory?.error || '입고 사진 정보를 불러오지 못했습니다.');
            setData({
                sludge: sludge.items || [],
                medicines: inventory.medicines || [],
                kits: inventory.kits || [],
                tradePhotoDates: inventory.tradePhotoDates || [],
            });
        } catch (error) {
            onError?.(error.message);
        } finally {
            setLoading(false);
        }
    }, [month, onError, year]);

    useEffect(() => {
        reload();
    }, [reload]);

    const uploadSludge = async (row, type, files) => {
        const list = Array.from(files || []);
        if (!list.length) return;
        const key = `${row.date}:${type}`;
        setBusyKey(key);
        try {
            for (const file of list) {
                const result = await SludgePhotoModel.uploadPhoto(row.date, type, file);
                if (!result?.success) throw new Error(result?.error || '사진 저장에 실패했습니다.');
            }
            await reload();
        } catch (error) {
            onError?.(error.message);
        } finally {
            setBusyKey('');
        }
    };

    const uploadInventory = async (row, files, isKit = false, itemName = row.name) => {
        const list = Array.from(files || []);
        if (!list.length) return;
        const key = `${row.date}:${itemName}`;
        setBusyKey(key);
        try {
            for (let index = 0; index < list.length; index += 1) {
                const result = await MedicineInModel.uploadPhoto(
                    row.date,
                    itemName,
                    list[index],
                    isKit ? index : 0
                );
                if (!result?.success) throw new Error(result?.error || '사진 저장에 실패했습니다.');
            }
            await reload();
        } catch (error) {
            onError?.(error.message);
        } finally {
            setBusyKey('');
        }
    };

    const rows = category === 'sludge'
        ? data.sludge
        : category === 'medicine'
            ? data.medicines
            : data.kits;

    return (
        <div className="unified-photo-management">
            <aside className="unified-photo-management__menu">
                {CATEGORIES.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className={category === item.id ? 'is-active' : ''}
                        onClick={() => setCategory(item.id)}
                    >
                        {item.label}
                    </button>
                ))}
            </aside>
            <section className="unified-photo-management__content">
                <div className="unified-photo-management__heading">
                    <strong>{CATEGORIES.find((item) => item.id === category)?.label}</strong>
                    <span>{year}년 {month}월 · {rows.length}건</span>
                </div>
                {loading ? (
                    <div className="unified-photo-management__empty">사진 정보를 확인하는 중입니다.</div>
                ) : rows.length === 0 ? (
                    <div className="unified-photo-management__empty">선택한 달에 사진을 등록할 대상이 없습니다.</div>
                ) : (
                    <div className="unified-photo-management__rows">
                        {category === 'sludge' && rows.map((row) => (
                            <div className="unified-photo-management__row" key={row.date}>
                                <div><strong>{row.date}</strong><span>반출량 {amount(row.sludge_amount)} m3</span></div>
                                <div className="unified-photo-management__actions">
                                    <SludgePhotoButton
                                        label="반출사진"
                                        multiple
                                        busy={busyKey === `${row.date}:sludge`}
                                        hasPhoto={Boolean(row.sludge_photo_url)}
                                        onFiles={(files) => uploadSludge(row, 'sludge', files)}
                                    />
                                    <SludgePhotoButton
                                        label="청소필증"
                                        busy={busyKey === `${row.date}:certificate`}
                                        hasPhoto={Boolean(row.certificate_photo_url)}
                                        onFile={(file) => uploadSludge(row, 'certificate', [file])}
                                    />
                                </div>
                            </div>
                        ))}
                        {category === 'medicine' && rows.map((row) => (
                            <div className="unified-photo-management__row" key={`${row.date}:${row.name}`}>
                                <div><strong>{row.date} · {row.name}</strong><span>입고량 {amount(row.purchase)}</span></div>
                                <div className="unified-photo-management__actions">
                                    <SludgePhotoButton
                                        label="입고사진"
                                        busy={busyKey === `${row.date}:${row.name}`}
                                        hasPhoto={Boolean(row.photoUrl)}
                                        onFile={(file) => uploadInventory(row, [file])}
                                    />
                                    <SludgePhotoButton
                                        label="거래명세표"
                                        busy={busyKey === `${row.date}:거래명세서`}
                                        hasPhoto={data.tradePhotoDates.includes(row.date)}
                                        onFile={(file) => uploadInventory(row, [file], false, '거래명세서')}
                                    />
                                </div>
                            </div>
                        ))}
                        {category === 'kit' && rows.map((row) => (
                            <div className="unified-photo-management__row" key={`${row.date}:${row.name}`}>
                                <div><strong>{row.date} · {row.name}</strong><span>입고량 {amount(row.purchase)}</span></div>
                                <div className="unified-photo-management__actions">
                                    <SludgePhotoButton
                                        label="키트사진"
                                        multiple
                                        busy={busyKey === `${row.date}:${row.name}`}
                                        hasPhoto={Boolean(row.photoUrl)}
                                        onFiles={(files) => uploadInventory(row, files, true)}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
