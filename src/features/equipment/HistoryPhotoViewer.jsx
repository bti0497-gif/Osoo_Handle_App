// 유지보수 내역 사진 보기: 큰 이미지 + 하단 썸네일 행.
// items: [{ id, url }]. readOnly면 삭제·추가를 숨긴다(업무사진 열람은 읽기 전용).
// 사진 데이터와 갱신 로직은 ViewModel/Model이 담당한다.
import React, { useEffect, useRef, useState } from 'react';

export default function HistoryPhotoViewer({
  title = '', items = [], readOnly = false, index, onSelect, onDelete, onAddFiles, onClose,
}) {
  const total = items.length;
  const requestedIndex = Number.isFinite(Number(index)) ? Number(index) : 0;
  const safeIndex = Math.max(0, Math.min(requestedIndex, Math.max(0, total - 1)));
  const current = total > 0 ? items[safeIndex] : null;
  const dialogRef = useRef(null);
  const [failedUrl, setFailedUrl] = useState(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => previous?.focus?.();
  }, []);
  return (
    <div className="equipment-editor-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="equipment-editor photo-viewer"
        role="dialog"
        aria-modal="true"
        aria-label="현장 사진 보기"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
          if (event.key === 'Tab') {
            const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not([type="file"])')];
            const first = controls[0]; const last = controls[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>현장 사진 보기</h2>
            <p>{title}</p>
          </div>
          <button type="button" className="catalog-close" onClick={onClose} aria-label="닫기">
            <span className="material-icons">close</span>
          </button>
        </header>
        <div className="photo-viewer-body">
          {total > 0 ? (
            <>
              <div className="photo-viewer-main">
                {failedUrl === current.url ? <p role="alert">사진을 불러오지 못했습니다. 창을 닫고 다시 시도해 주세요.</p> : <img src={current.url} alt={`사진 ${safeIndex + 1}`} onError={() => setFailedUrl(current.url)} />}
                {total > 1 ? (
                  <>
                    <button
                      type="button"
                      className="viewer-nav prev"
                      onClick={() => onSelect((safeIndex - 1 + total) % total)}
                      aria-label="이전 사진"
                    >‹</button>
                    <button
                      type="button"
                      className="viewer-nav next"
                      onClick={() => onSelect((safeIndex + 1) % total)}
                      aria-label="다음 사진"
                    >›</button>
                  </>
                ) : null}
                {!readOnly ? (
                  <button type="button" className="viewer-delete" onClick={onDelete} title="이 사진 삭제">
                    <span className="material-icons">delete</span>
                    삭제
                  </button>
                ) : null}
                <span className="viewer-counter">{safeIndex + 1} / {total}</span>
              </div>
              <div className="photo-viewer-thumbs">
                {items.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`viewer-thumb${i === safeIndex ? ' on' : ''}`}
                    onClick={() => onSelect(i)}
                    aria-label={`사진 ${i + 1} 보기`}
                  >
                    <img src={item.url} alt={`썸네일 ${i + 1}`} />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="viewer-empty">{readOnly ? '저장된 사진이 없습니다.' : '저장된 사진이 없습니다. 아래 버튼으로 사진을 추가하세요.'}</p>
          )}
          {!readOnly ? (
          <label className="viewer-add">
            <span className="material-icons">add_photo_alternate</span>
            사진 추가
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = '';
                if (files.length) onAddFiles(files);
              }}
            />
          </label>
          ) : null}
        </div>
        <footer>
          <div>
            <button type="button" onClick={onClose}>닫기</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
