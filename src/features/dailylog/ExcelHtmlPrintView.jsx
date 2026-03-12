import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DailyLogModel } from './DailyLogModel';
import { applyBindingsToHtml, buildBindingsFromPage } from './dailyLogHtmlDocument';

const ExcelHtmlPrintView = ({ page, templateName }) => {
  const [templateHtml, setTemplateHtml] = useState('');
  const [error, setError] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setError('');

    (async () => {
      try {
        const html = await DailyLogModel.fetchTemplateHtml(templateName);
        if (!cancelled) setTemplateHtml(html);
      } catch (e) {
        if (!cancelled) setError(e?.data?.userMessage || e?.message || 'HTML 템플릿을 불러오지 못했습니다.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [templateName]);

  const bindings = useMemo(() => buildBindingsFromPage(page), [page]);
  const boundHtml = useMemo(() => applyBindingsToHtml(templateHtml, bindings), [templateHtml, bindings]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#fff', padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '12px' }}>
        <button
          type="button"
          onClick={() => window.print()}
          style={{
            height: '38px',
            padding: '0 14px',
            borderRadius: '10px',
            border: '1px solid #cbd5e1',
            background: '#1e293b',
            color: '#fff',
            fontWeight: 900,
            cursor: 'pointer',
          }}
        >
          인쇄 / PDF 저장
        </button>
      </div>

      {error ? (
        <div style={{ color: '#b91c1c', fontWeight: 800 }}>{error}</div>
      ) : (
        <div
          ref={containerRef}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: boundHtml }}
        />
      )}
    </div>
  );
};

export default ExcelHtmlPrintView;
