// 유지보수 내역 사진 보기: 큰 이미지 + 하단 썸네일 행, 삭제/추가 지원.
// items: [{ id, url }]. 사진 데이터와 갱신 로직은 ViewModel/Model이 담당한다.
import React from 'react';

export default function HistoryPhotoViewer({
  entry, items = [], index, onSelect, onDelete, onAddFiles, onClose,
}) {
  const total = items.length;
  const safeIndex = Math.min(index, Math.max(0, total - 1));
  const current = total > 0 ? items[safeIndex] : null;
  return (
    <div className="equipment-editor-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="equipment-editor photo-viewer"
        role="dialog"
        aria-modal="true"
        aria-label="현장 사진 보기"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>현장 사진 보기</h2>
            <p>{entry ? `${entry.date} · ${entry.content}` : ''}</p>
          </div>
          <button type="button" className="catalog-close" onClick={onClose} aria-label="닫기">
            <span className="material-icons">close</span>
          </button>
        </header>
        <div className="photo-viewer-body">
          {total > 0 ? (
            <>
              <div className="photo-viewer-main">
                <img src={current.url} alt={`사진 ${safeIndex + 1}`} />
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
                <button type="button" className="viewer-delete" onClick={onDelete} title="이 사진 삭제">
                  <span className="material-icons">delete</span>
                  삭제
                </button>
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
            <p className="viewer-empty">저장된 사진이 없습니다. 아래 버튼으로 사진을 추가하세요.</p>
          )}
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
