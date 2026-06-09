import React, { useMemo, useState } from 'react';
import RoadworkCopyGrid from './RoadworkCopyGrid';
import './RoadworkHelperModal.css';

export default function RoadworkHelperModal({ isOpen, onClose, vm }) {
  const [activeTab, setActiveTab] = useState('flow');

  const activeSection = useMemo(
    () => vm.sections.find((section) => section.id === activeTab) || vm.sections[0],
    [activeTab, vm.sections],
  );

  if (!isOpen) return null;

  return (
    <aside className="roadwork-helper-panel" aria-label="공사 입력 도우미">
      <header className="roadwork-helper-header">
        <div>
          <h2>공사 입력 도우미</h2>
          <span>도로공사 입력 화면을 보면서 옮겨 적는 보조창</span>
        </div>
        <button type="button" className="roadwork-icon-btn" onClick={onClose} title="닫기">
          <span className="material-icons">close</span>
        </button>
      </header>

      <div className="roadwork-helper-toolbar">
        <label>
          기준일
          <input
            type="date"
            value={vm.date}
            onChange={(e) => vm.setDate(e.target.value)}
            className="roadwork-date-input"
          />
        </label>
        <div className="roadwork-toolbar-actions">
          <button type="button" className="roadwork-btn-secondary" onClick={vm.reload} disabled={vm.loading} title="새로고침">
            <span className="material-icons">refresh</span>
          </button>
          <button type="button" className="roadwork-btn-primary" onClick={vm.copyAll}>
            <span className="material-icons">content_copy</span>
            {vm.copied === 'all' ? '전체 복사됨' : '전체 복사'}
          </button>
        </div>
      </div>

      <nav className="roadwork-helper-tabs" aria-label="입력 항목">
        {vm.sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className={section.id === activeSection.id ? 'active' : ''}
            onClick={() => setActiveTab(section.id)}
          >
            {section.title}
          </button>
        ))}
      </nav>

      <main className="roadwork-helper-content">
        {vm.error ? <div className="roadwork-alert-error">{vm.error}</div> : null}
        {vm.loading ? <div className="roadwork-alert-info">데이터를 불러오는 중입니다.</div> : null}

        {activeSection ? (
          <section className="roadwork-helper-section">
            <div className="roadwork-section-header">
              <h3>{activeSection.number} {activeSection.title}</h3>
              <button type="button" className="roadwork-btn-secondary compact" onClick={() => vm.copySection(activeSection)}>
                <span className="material-icons">content_copy</span>
                {vm.copied === activeSection.id ? '복사됨' : '복사'}
              </button>
            </div>
            <RoadworkCopyGrid columns={activeSection.columns} rows={activeSection.rows} />
          </section>
        ) : null}
      </main>

      <footer className="roadwork-helper-footer">
        복사 버튼은 표 데이터를 탭 구분 형식으로 클립보드에 담습니다. 붙여넣기가 막힌 칸은 이 창을 보면서 직접 입력하면 됩니다.
      </footer>
    </aside>
  );
}
