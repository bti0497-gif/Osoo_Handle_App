import React, { useEffect } from 'react';

const buildPdfPreviewUrl = (url) => {
    if (!url) {
        return '';
    }

    return `${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`;
};

const DailyLogPdfPreview = ({ url, title, onRenderStart, onRenderComplete, onRenderError }) => {
    useEffect(() => {
        if (!url) {
            return;
        }

        onRenderStart?.();
    }, [url]);

    if (!url) {
        return null;
    }

    return (
        <div
            aria-label={title}
            style={{
                flex: 1,
                width: '100%',
                minHeight: 0,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'flex-start',
                padding: '24px',
                overflow: 'auto',
                backgroundColor: '#ffffff'
            }}
        >
            <iframe
                title={title}
                src={buildPdfPreviewUrl(url)}
                onLoad={() => onRenderComplete?.({ ready: true })}
                onError={() => onRenderError?.(new Error('PDF 미리보기를 렌더링하지 못했습니다.'))}
                style={{
                    width: 'min(100%, 960px)',
                    height: '100%',
                    minHeight: '100%',
                    border: '1px solid #94a3b8',
                    backgroundColor: '#ffffff',
                    boxShadow: '0 18px 40px -24px rgba(15, 23, 42, 0.45)'
                }}
            />
        </div>
    );
};

export default DailyLogPdfPreview;