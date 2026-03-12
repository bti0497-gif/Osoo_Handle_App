function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

    const SECTION_CONFIG = [
      { key: 'nh3_n', photoKey: 'ammonia', label: 'NH₃-N(질산화)', note: '기준치 20ppm' },
      { key: 'no3_n', photoKey: 'nitrate', label: 'NO₃-N(탈질)', note: '기준치 20ppm' },
      { key: 'po4_p', photoKey: 'phosphorus', label: 'PO₄³⁻-P(인)', note: '기준치 2ppm' },
      { key: 'alkalinity', photoKey: 'alkalinity', label: 'Alkalinity\n(알칼리도)', note: '' },
    ];

    function buildValueSlots(rows = [], fieldKey) {
      const values = rows.slice(0, 5).map((row) => row?.[fieldKey] ?? '');
      while (values.length < 5) {
        values.push('');
      }
      return values;
    }

export function buildBindingsFromPage(page) {
    if (!page) {
        return {};
    }

    const bindings = {
        날짜: page.date || '',
    };

    (page.rows || []).slice(0, 5).forEach((row, index) => {
        const position = index + 1;
        bindings[`암모니아${position}`] = row?.nh3_n ?? '';
        bindings[`질산${position}`] = row?.no3_n ?? '';
        bindings[`인${position}`] = row?.po4_p ?? '';
        bindings[`알칼리${position}`] = row?.alkalinity ?? '';
    });

    return bindings;
}

export function applyBindingsToHtml(html, bindings) {
    if (!html) {
        return '';
    }

    const parser = new DOMParser();
    const documentNode = parser.parseFromString(html, 'text/html');

    documentNode.querySelectorAll('[data-named-cell]').forEach((node) => {
        const key = node.getAttribute('data-named-cell');
        if (!Object.prototype.hasOwnProperty.call(bindings, key)) {
            return;
        }

        node.textContent = bindings[key] ?? '';
    });

    return documentNode.documentElement.outerHTML;
}

function splitDocumentHtml(html) {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(html, 'text/html');

    return {
        headHtml: documentNode.head?.innerHTML || '',
        bodyHtml: documentNode.body?.innerHTML || '',
    };
}

export function buildPrintableDocumentHtml({ templateHtml, pages, title }) {
    const normalizedPages = Array.isArray(pages) ? pages.filter(Boolean) : [];
    const renderedPages = normalizedPages.map((page) => applyBindingsToHtml(templateHtml, buildBindingsFromPage(page)));
    const parsedPages = renderedPages.map(splitDocumentHtml);
    const baseHeadHtml = parsedPages[0]?.headHtml || '';
    const pageMarkup = parsedPages
        .map(({ bodyHtml }, index) => `<section class="dailylog-print-page" data-page-index="${index + 1}">${bodyHtml}</section>`)
        .join('');

    return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title || 'print')}</title>
  ${baseHeadHtml}
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
    }

    body {
      font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
    }

    .dailylog-print-root {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 24px;
      align-items: center;
      background: #ffffff;
    }

    .dailylog-print-page {
      width: 100%;
      max-width: 1120px;
      break-after: page;
      page-break-after: always;
      background: #ffffff;
    }

    .dailylog-print-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }

    @page {
      size: A4;
      margin: 10mm;
    }

    @media print {
      .dailylog-print-root {
        padding: 0;
        gap: 0;
      }

      .dailylog-print-page {
        max-width: none;
      }
    }
  </style>
</head>
<body>
  <div class="dailylog-print-root">${pageMarkup}</div>
</body>
</html>`;
}

  function buildFixedPreviewPageHtml(page, title) {
      const locationHeader = escapeHtml((page.locationLabels || []).slice(0, 5).join(' / '));
      const sectionsHtml = SECTION_CONFIG.map((section, index) => {
          const values = buildValueSlots(page.rows, section.key);
          const photoUrl = String(page.photoUrls?.[section.photoKey] || '').trim();
          const photoMarkup = photoUrl
              ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(section.label)}" class="dailylog-fixed-photo-image" />`
              : '';
          const valuesHtml = values.map((value, valueIndex) => `<div class="dailylog-fixed-value-cell${valueIndex === 0 ? ' first' : ''}">${escapeHtml(value)}</div>`).join('');

          return `
          <div class="dailylog-fixed-section${index === 0 ? ' first' : ''}">
            <div class="dailylog-fixed-label">${escapeHtml(section.label)}</div>
            <div class="dailylog-fixed-center">
              <div class="dailylog-fixed-photo-cell">
                <div class="dailylog-fixed-photo-frame">${photoMarkup}</div>
              </div>
              <div class="dailylog-fixed-values-row">${valuesHtml}</div>
            </div>
            <div class="dailylog-fixed-note">${escapeHtml(section.note)}</div>
          </div>`;
      }).join('');

      return `
      <section class="dailylog-print-page">
        <div class="dailylog-fixed-page" aria-label="${escapeHtml(title)} Preview">
          <div class="dailylog-fixed-header">
            <div class="dailylog-fixed-title">수질분석 일지</div>
            <div class="dailylog-fixed-date">${escapeHtml(page.date || '')}</div>
          </div>
          <div class="dailylog-fixed-table-head">
            <div class="dailylog-fixed-head-cell left">구 분</div>
            <div class="dailylog-fixed-head-cell center">${locationHeader}</div>
            <div class="dailylog-fixed-head-cell right">비 고</div>
          </div>
          <div class="dailylog-fixed-table-body">${sectionsHtml}</div>
        </div>
      </section>`;
  }

  export function buildFixedPreviewPrintableDocumentHtml({ pages, title }) {
      const normalizedPages = Array.isArray(pages) ? pages.filter(Boolean) : [];
      const pagesHtml = normalizedPages.map((page) => buildFixedPreviewPageHtml(page, title || '수질분석일지')).join('');

      return `<!doctype html>
  <html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title || 'print')}</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
      }

      body {
        font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
        color: #0f172a;
      }

      .dailylog-print-page {
        break-after: page;
        page-break-after: always;
        margin: 0;
        padding: 0;
      }

      .dailylog-print-page:last-child {
        break-after: auto;
        page-break-after: auto;
      }

      .dailylog-fixed-page {
        width: 180mm;
        min-height: 262mm;
        margin: 0 auto;
        padding: 19mm 12mm 12mm;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        background: #ffffff;
      }

      .dailylog-fixed-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-bottom: 28px;
      }

      .dailylog-fixed-title {
        text-align: center;
        font-size: 26px;
        font-weight: 700;
        letter-spacing: 0.12em;
      }

      .dailylog-fixed-date {
        text-align: center;
        font-size: 14px;
        font-weight: 600;
        color: #64748b;
      }

      .dailylog-fixed-table-head {
        border: 1px solid #334155;
        display: grid;
        grid-template-columns: 126px 1fr 138px;
      }

      .dailylog-fixed-head-cell {
        padding: 7px 8px;
        text-align: center;
        font-size: 12px;
        font-weight: 600;
        box-sizing: border-box;
      }

      .dailylog-fixed-head-cell.left,
      .dailylog-fixed-head-cell.center {
        border-right: 1px solid #334155;
      }

      .dailylog-fixed-table-body {
        border-left: 1px solid #334155;
        border-right: 1px solid #334155;
        border-bottom: 1px solid #334155;
        display: flex;
        flex-direction: column;
        flex: 1;
      }

      .dailylog-fixed-section {
        display: grid;
        grid-template-columns: 126px 1fr 138px;
        flex: 1;
        min-height: 0;
        border-top: 1px solid #334155;
      }

      .dailylog-fixed-section.first {
        border-top: none;
      }

      .dailylog-fixed-label,
      .dailylog-fixed-note {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px;
        text-align: center;
        white-space: pre-line;
        box-sizing: border-box;
      }

      .dailylog-fixed-label {
        border-right: 1px solid #334155;
        font-size: 13px;
        color: #1e293b;
      }

      .dailylog-fixed-note {
        font-size: 12px;
        color: #1f2937;
      }

      .dailylog-fixed-center {
        border-right: 1px solid #334155;
        display: grid;
        grid-template-rows: 1fr 34px;
        min-height: 0;
      }

      .dailylog-fixed-photo-cell {
        position: relative;
        padding: 8px 0 6px;
        min-height: 0;
        background: #ffffff;
      }

      .dailylog-fixed-photo-frame {
        position: absolute;
        inset: 8px 0 6px;
        overflow: hidden;
        background: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .dailylog-fixed-photo-image {
        width: 60%;
        height: 100%;
        object-fit: fill;
        display: block;
      }

      .dailylog-fixed-values-row {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        border-top: 1px solid #334155;
      }

      .dailylog-fixed-value-cell {
        display: flex;
        align-items: center;
        justify-content: center;
        border-left: 1px solid #334155;
        font-size: 12px;
        color: #111827;
        font-weight: 500;
        box-sizing: border-box;
      }

      .dailylog-fixed-value-cell.first {
        border-left: none;
      }

      @page {
        size: A4;
        margin: 0;
      }

      @media print {
        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }
    </style>
  </head>
  <body>
    ${pagesHtml}
  </body>
  </html>`;
  }

export function openPrintableDocument(documentHtml) {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.opacity = '0';
      iframe.setAttribute('aria-hidden', 'true');

      const cleanup = () => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      };

      const handleLoad = () => {
        const printWindow = iframe.contentWindow;
        if (!printWindow) {
          cleanup();
          return;
        }

        let cleaned = false;
        const safeCleanup = () => {
          if (cleaned) {
            return;
          }
          cleaned = true;
          setTimeout(cleanup, 300);
        };

        printWindow.addEventListener('afterprint', safeCleanup, { once: true });
        setTimeout(() => {
          try {
            printWindow.focus();
            printWindow.print();
          } catch (_) {
            safeCleanup();
          }
        }, 250);

        setTimeout(safeCleanup, 60000);
      };

      iframe.addEventListener('load', handleLoad, { once: true });
      document.body.appendChild(iframe);

      const iframeDocument = iframe.contentDocument;
      if (!iframeDocument) {
        cleanup();
        throw new Error('출력 문서를 준비하지 못했습니다.');
      }

      iframeDocument.open();
      iframeDocument.write(documentHtml);
      iframeDocument.close();
      return iframe;
}