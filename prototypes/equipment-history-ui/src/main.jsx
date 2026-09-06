// 장비이력카드 UI 프로토타입 진입점.
// 앱 본체의 셸(헤더/사이드바/상태바)을 모방한 프레임 안에
// src/features/equipment 로 이식될 화면을 그대로 띄운다.
// '설정' 메뉴는 앱의 기본설정을 시뮬레이션한다(공법 = app_settings.method).
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './icons.css';
import EquipmentCardView from './equipment/EquipmentCardView';
import { EQUIPMENT_PROCESS_METHODS } from './equipment/equipmentPreviewData';
import { PrototypeDialogHost, useDialog } from './dialog';

const MENUS = ['대시보드', '유량관리', '약품관리', '수질관리', '키트관리', '성적서', '장비이력', '설정'];

function PrototypeShell() {
  // 공법은 기본설정에서 지정되고 장비 기능은 그 값을 주입받기만 한다.
  const [processMethod, setProcessMethod] = useState('A2O');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftMethod, setDraftMethod] = useState('A2O');
  const { showConfirm } = useDialog();

  const openSettings = () => {
    setDraftMethod(processMethod);
    setSettingsOpen(true);
  };

  const applySettings = async () => {
    if (draftMethod !== processMethod) {
      const confirmed = await showConfirm(
        '공법을 변경하면 장비 목록이 해당 공법의 기본 설비로 다시 채워집니다.\n화면에서 추가·수정한 내용은 초기화됩니다. 계속할까요?',
        '공법 변경',
      );
      if (!confirmed) return;
    }
    setProcessMethod(draftMethod);
    setSettingsOpen(false);
  };

  return (
    <div className="prototype-shell">
      <header className="app-header">
        <div className="app-logo">O</div>
        <b>오수처리 통합관리시스템</b>
        <span>횡성휴게소(강릉방향)</span>
        <div className="user">김동철 · 현장관리자</div>
      </header>
      <aside className="sidebar">
        <p>업무 메뉴</p>
        {MENUS.map((name) => (
          <button
            key={name}
            type="button"
            className={name === '장비이력' ? 'active' : ''}
            onClick={name === '설정' ? openSettings : undefined}
          >
            <i>{name === '장비이력' || name === '설정' ? '▣' : '○'}</i>
            {name}
          </button>
        ))}
      </aside>
      <main className="workspace">
        <EquipmentCardView processMethod={processMethod} />
      </main>
      <footer className="statusbar">
        로컬 UI 프로토타입 · 서버 및 데이터베이스 연결 없음 · 새로고침 시 입력 데이터 초기화
      </footer>

      {settingsOpen ? (
        <div className="prototype-dialog-backdrop" role="presentation">
          <div className="prototype-dialog prototype-settings" role="dialog" aria-modal="true" aria-label="기본설정">
            <h3>기본설정 (시뮬레이션)</h3>
            <p className="prototype-settings-hint">
              본앱에서는 이 값이 기본설정(app_settings.method)에 저장되며,
              장비이력카드의 기본 설비 목록은 이 공법을 기준으로 채워집니다.
            </p>
            <div className="prototype-settings-field">
              <span>공법</span>
              <div className="method-options" role="radiogroup" aria-label="공법 선택">
                {EQUIPMENT_PROCESS_METHODS.map((method) => (
                  <button
                    key={method.value}
                    type="button"
                    className={draftMethod === method.value ? 'active' : ''}
                    onClick={() => setDraftMethod(method.value)}
                  >
                    {method.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="prototype-settings-note">
              A2O: 침사조 - 유량조정조 - 포기조 - 침전조 - 응집침전조 - 방류조
              <br />
              MBR: 침전조·외부반송·응집침전 없음, 막분리조(막모듈·흡인펌프·막세척펌프) 추가
            </p>
            <div className="prototype-dialog-actions">
              <button type="button" onClick={() => setSettingsOpen(false)}>취소</button>
              <button type="button" className="primary" onClick={applySettings}>적용</button>
            </div>
          </div>
        </div>
      ) : null}

      <PrototypeDialogHost />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<PrototypeShell />);
