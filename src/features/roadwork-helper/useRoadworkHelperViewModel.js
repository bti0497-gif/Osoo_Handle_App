import { useCallback, useEffect, useMemo, useState } from 'react';
import { getTodayKST } from '../../core/constants';
import { RoadworkHelperModel } from './RoadworkHelperModel';

const FLOW_COLUMNS = [
  { key: 'item', label: '구분' },
  { key: 'previousReading', label: '전일지침' },
  { key: 'todayReading', label: '금일지침' },
  { key: 'todayFlow', label: '처리량(사용량)' },
  { key: 'monthTotal', label: '월간누계' },
  { key: 'yearTotal', label: '연간누계' },
];

const ELECTRICITY_COLUMNS = [
  { key: 'item', label: '구분' },
  { key: 'previousReading', label: '전일지침' },
  { key: 'todayReading', label: '금일지침' },
  { key: 'usage', label: '사용량' },
];

const INVENTORY_COLUMNS = [
  { key: 'item', label: '품명' },
  { key: 'purchase', label: '구입량' },
  { key: 'usage', label: '사용량' },
  { key: 'monthUsage', label: '월간누계' },
  { key: 'yearUsage', label: '연간누계' },
  { key: 'inventory', label: '잔량' },
  { key: 'note', label: '비고' },
];

function formatCell(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value);
}

function toTsv(columns, rows) {
  const body = rows.map((row) => columns.map((col) => formatCell(row[col.key])).join('\t'));
  return body.join('\n');
}

export function useRoadworkHelperViewModel() {
  const [date, setDate] = useState(getTodayKST());
  const [data, setData] = useState({ flow: [], electricity: [], medicine: [], kit: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const load = useCallback(async (targetDate = date) => {
    setLoading(true);
    setError('');
    try {
      const res = await RoadworkHelperModel.fetchAll(targetDate);
      setData({
        flow: res.flow || [],
        electricity: res.electricity || [],
        medicine: res.medicine || [],
        kit: res.kit || [],
      });
    } catch (err) {
      setError(err.message || '공사 입력 도우미 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load(date);
  }, [date, load]);

  const sections = useMemo(() => [
    {
      id: 'flow',
      number: '2.',
      title: '유량 현황',
      columns: FLOW_COLUMNS,
      rows: data.flow || [],
    },
    {
      id: 'electricity',
      number: '3.',
      title: '전력량 현황',
      columns: ELECTRICITY_COLUMNS,
      rows: data.electricity || [],
    },
    {
      id: 'inventory',
      number: '4.',
      title: '약품/키트 사용현황',
      columns: INVENTORY_COLUMNS,
      rows: [...(data.medicine || []), ...(data.kit || [])],
    },
  ], [data]);

  const fillPayload = useMemo(() => ({
    flow: data.flow || [],
    electricity: data.electricity || [],
    medicine: data.medicine || [],
    kit: data.kit || [],
  }), [data]);

  const hasFillData = useMemo(() => {
    const hasFlow = fillPayload.flow.some((row) => (
      row.todayReading !== null
      && row.todayReading !== undefined
      && row.todayReading !== ''
    ) || Number(row.todayFlow || 0) !== 0);

    const hasElectricity = fillPayload.electricity.some((row) => (
      row.todayReading !== null
      && row.todayReading !== undefined
      && row.todayReading !== ''
    ) || Number(row.usage || 0) !== 0);

    const hasInventory = [...fillPayload.medicine, ...fillPayload.kit].some((row) => (
      Number(row.purchase || 0) !== 0
      || Number(row.usage || 0) !== 0
    ));

    return hasFlow || hasElectricity || hasInventory;
  }, [fillPayload]);

  const copySection = useCallback(async (section) => {
    try {
      await navigator.clipboard.writeText(toTsv(section.columns, section.rows));
      setCopied(section.id);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setError('클립보드 복사에 실패했습니다. 표를 직접 선택해서 복사해 주세요.');
    }
  }, []);

  const copyAll = useCallback(async () => {
    try {
      const merged = sections
        .map((section) => `${section.title}\n${section.columns.map((col) => col.label).join('\t')}\n${toTsv(section.columns, section.rows)}`)
        .join('\n\n');
      await navigator.clipboard.writeText(merged);
      setCopied('all');
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setError('클립보드 복사에 실패했습니다. 표를 직접 선택해서 복사해 주세요.');
    }
  }, [sections]);

  return {
    date,
    setDate,
    sections,
    loading,
    error,
    copied,
    fillPayload,
    hasFillData,
    reload: () => load(date),
    copyAll,
    copySection,
  };
}
