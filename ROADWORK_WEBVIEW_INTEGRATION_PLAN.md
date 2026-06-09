# 도로공사 웹사이트 자동입력 통합 계획서

## 📋 목차
1. [개요](#개요)
2. [기술 아키텍처](#기술-아키텍처)
3. [구현 범위](#구현-범위)
4. [상세 구현 방안](#상세-구현-방안)
5. [기술 검증 항목](#기술-검증-항목)
6. [구현 일정](#구현-일정)
7. [주요 리스크 및 대응](#주요-리스크-및-대응)

---

## 개요

### 목적
오수처리장 현장관리자가 **도로공사 홈페이지의 일일운영일지 입력 시** 로컬 DB의 운영 데이터(유량, 약품, 슬러지, 수질분석값 등)를 **자동으로 입력 필드에 채워**주고, 비밀번호 변경 시 **자동으로 새 비밀번호를 생성/저장/적용**하여 입력 편의성을 극대화합니다.

### 현재 상태
- ✅ RoadworkHelperView (입력 도우미) 구현 완료 → 로컬 DB 데이터를 표 형태로 정렬만 함
- ❌ webview 기반 도로공사 사이트 자동입력 미구현
- ❌ 비밀번호 자동 변경 미구현

### 최종 목표
```
사용자 workflow:
1. 공사 입력 도우미 메뉴 클릭
2. "도로공사 사이트" 탭 클릭 → webview로 사이트 로드
3. 로그인 + 2FA 수동 진행 (앱 자동화 불가)
4. 일일운영일지 → "신규" 버튼 클릭 (날짜 페이지 로드)
5. [자동] 오늘 날짜의 로컬 DB 데이터 자동 입력
6. [자동] 체크리스트 "이상무" 자동 체크
7. [자동] 비밀번호 변경 요구 시 새 비밀번호 자동 생성 + 저장
8. 사용자가 "저장" 버튼 클릭 → 도로공사 서버 저장

사진 업로드: 사용자 수동 진행 (웹 보안 정책상 파일 input 자동 제어 불가)
```

---

## 기술 아키텍처

### 1. 구성 요소

```
┌─────────────────────────────────────────────┐
│         RoadworkHelperView (React)          │
│  ┌─────────────────┬──────────────────────┐ │
│  │  "입력 도우미"  │  "도로공사 사이트"   │ │  ← 탭 전환
│  │   (현재 UI)     │  (새로 추가)         │ │
│  └─────────────────┴──────────────────────┘ │
│           ↓              ↓                    │
│     표 렌더링      webview 렌더링             │
└─────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────┐
│        Electron webview (내장 브라우저)     │
│  ┌─────────────────────────────────────────┐ │
│  │  도로공사 홈페이지                       │ │
│  │  (격리된 세션, 로컬 쿠키 저장)         │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
         ↑ (preload 스크립트)
┌─────────────────────────────────────────────┐
│    electron/preload-roadwork.js             │
│  ┌─────────────────────────────────────────┐ │
│  │ • 날짜 감지 (MutationObserver)         │ │
│  │ • 입력 필드 자동 채우기                 │ │
│  │ • 비밀번호 변경 페이지 감지            │ │
│  │ • IPC로 로컬 DB 조회                  │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
         ↓ (IPC 통신)
┌─────────────────────────────────────────────┐
│    electron/main.cjs (Main Process)         │
│  ┌─────────────────────────────────────────┐ │
│  │ • 로컬 DB 조회 (better-sqlite3)       │ │
│  │ • 비밀번호 생성 + 저장                  │ │
│  │ • preload로 데이터 반환                 │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────┐
│    server/database.cjs (로컬 SQLite)       │
│  ┌─────────────────────────────────────────┐ │
│  │ • app_settings (도로공사 ID/PW)        │ │
│  │ • flow_readings (유량)                  │ │
│  │ • medicine_usage (약품)                 │ │
│  │ • water_readings (수질)                 │ │
│  │ • kit_usage (분석키트)                  │ │
│  │ • sludge_export (슬러지)                │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 2. 통신 흐름

```
Timeline:

[1] 사용자가 "도로공사 사이트" 탭 클릭
    ↓
[2] webview src="${roadworkUrl}" 로드
    ↓
[3] preload 스크립트 주입 (Renderer Process)
    ↓
[4] 사용자 로그인 + 2FA 수동 진행
    ↓
[5] 페이지가 "일일운영일지" 페이지로 변경
    ↓
[6] 사용자가 "신규" 버튼 클릭 → 새 입력 폼 로드
    ↓
[7] MutationObserver가 날짜 필드 감지
    ↓
[8] preload → IPC.invoke('getRoadworkData', date)
    ↓
[9] Main Process에서 로컬 DB 조회
    ↓
[10] 조회 결과를 preload로 반환
    ↓
[11] preload가 입력 필드에 값 자동 입력
    ↓
[12] 페이지가 비밀번호 변경 요구 시
    ↓
[13] preload가 감지 → IPC.invoke('generateNewPassword')
    ↓
[14] Main Process에서 새 비밀번호 생성 + DB 저장
    ↓
[15] preload가 입력 필드에 자동 입력 + 저장 버튼 클릭
    ↓
[16] 사용자가 최종 "저장" 클릭 → 도로공사 서버 저장
```

---

## 구현 범위

### Phase 1: 기반 구조 (필수)
- [ ] RoadworkHelperView에 탭 UI 추가
- [ ] webview 동적 생성 로직
- [ ] Electron preload 스크립트 틀 작성
- [ ] IPC 채널 등록 (getRoadworkData, generateNewPassword)

### Phase 2: 자동입력 기능 (핵심)
- [ ] 날짜 필드 감지 로직
- [ ] 로컬 DB 조회 쿼리 작성
- [ ] 입력 필드 자동 채우기
- [ ] 체크박스 자동 체크

### Phase 3: 비밀번호 자동화 (부가)
- [ ] 비밀번호 변경 페이지 감지
- [ ] 보안 비밀번호 생성 함수
- [ ] DB 저장 로직
- [ ] 입력 필드 자동 채우기

### Phase 4: 검증 및 최적화
- [ ] 도로공사 실제 페이지에서 테스트
- [ ] HTML 구조 파싱 검증
- [ ] 에러 핸들링
- [ ] 성능 최적화

---

## 상세 구현 방안

### 1. RoadworkHelperView 수정

**파일**: `src/features/roadwork-helper/RoadworkHelperView.jsx`

```jsx
import { useEffect, useRef, useState } from 'react';
import RoadworkCopyGrid from './components/RoadworkCopyGrid';
import { useRoadworkHelperViewModel } from './useRoadworkHelperViewModel';

export default function RoadworkHelperView() {
  const vm = useRoadworkHelperViewModel();
  const [activeTab, setActiveTab] = useState('helper'); // 'helper' | 'site'
  const webviewContainerRef = useRef(null);

  // webview 초기화
  useEffect(() => {
    if (activeTab === 'site' && webviewContainerRef.current && !webviewContainerRef.current.hasChildNodes()) {
      const webview = document.createElement('webview');
      const roadworkUrl = vm.getRoadworkUrl(); // 설정에서 가져온 URL
      
      webview.src = roadworkUrl;
      webview.preload = './preload-roadwork.js';
      webview.style.width = '100%';
      webview.style.height = 'calc(100vh - 200px)';
      webview.style.border = '1px solid #cfd8e3';
      
      webviewContainerRef.current.appendChild(webview);
    }
  }, [activeTab, vm]);

  const tabButtonStyle = (isActive) => ({
    padding: '0.5rem 1rem',
    border: 'none',
    borderRadius: '4px',
    fontWeight: 700,
    cursor: 'pointer',
    background: isActive ? '#2563eb' : '#e2e8f0',
    color: isActive ? 'white' : '#1f2937'
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 탭 버튼 */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', padding: '0.75rem' }}>
        <button 
          style={tabButtonStyle(activeTab === 'helper')}
          onClick={() => setActiveTab('helper')}
        >
          📋 입력 도우미
        </button>
        <button 
          style={tabButtonStyle(activeTab === 'site')}
          onClick={() => setActiveTab('site')}
        >
          🌐 도로공사 사이트
        </button>
      </div>

      {/* 탭 콘텐츠 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0.75rem' }}>
        {activeTab === 'helper' ? (
          <HelperTab vm={vm} />
        ) : (
          <SiteTab webviewContainerRef={webviewContainerRef} />
        )}
      </div>
    </div>
  );
}

function HelperTab({ vm }) {
  return (
    <div style={{ /* 기존 입력 도우미 UI */ }}>
      {/* 기존 코드 유지 */}
    </div>
  );
}

function SiteTab({ webviewContainerRef }) {
  return (
    <div 
      ref={webviewContainerRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#f8fafc'
      }}
    />
  );
}
```

---

### 2. Electron preload 스크립트 작성

**파일**: `electron/preload-roadwork.js`

```javascript
const { contextBridge, ipcRenderer } = require('electron');

// contextIsolation 활성화 상태에서 안전한 API 노출
contextBridge.exposeInMainWorld('roadworkHelper', {
  // 1. 날짜 감지 + 데이터 조회
  async getRoadworkData(date) {
    return ipcRenderer.invoke('getRoadworkData', date);
  },

  // 2. 새 비밀번호 생성
  async generateNewPassword() {
    return ipcRenderer.invoke('generateNewPassword');
  },

  // 3. 비밀번호 저장 확인
  async confirmPasswordChange(newPassword) {
    return ipcRenderer.invoke('confirmPasswordChange', newPassword);
  }
});

// 페이지 로드 완료 후 자동 실행
document.addEventListener('DOMContentLoaded', async () => {
  setupDateObserver();
  setupPasswordObserver();
  setupChecklistObserver();
});

/**
 * [기능 1] 날짜 필드 감지 + 자동입력
 */
function setupDateObserver() {
  const observer = new MutationObserver(async (mutations) => {
    try {
      // 도로공사 사이트 HTML 구조에 맞게 수정 필요
      const dateField = document.querySelector(
        'input[name="작업일자"]' || 
        'input[id="workDate"]' || 
        '#date-input'
      );

      if (!dateField || !dateField.value) return;

      const selectedDate = dateField.value; // YYYY-MM-DD 형식 가정
      console.log('[Roadwork Helper] 날짜 감지:', selectedDate);

      // Main Process에서 해당 날짜 데이터 조회
      const data = await window.roadworkHelper.getRoadworkData(selectedDate);

      if (data && data.success) {
        console.log('[Roadwork Helper] 데이터 조회 성공:', data);
        await fillFormFields(data.payload);
      }
    } catch (err) {
      console.error('[Roadwork Helper] 날짜 감지 오류:', err);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false
  });
}

/**
 * [기능 2] 비밀번호 변경 페이지 감지 + 자동화
 */
function setupPasswordObserver() {
  const observer = new MutationObserver(async (mutations) => {
    try {
      // 비밀번호 변경 폼 감지
      const passwordForm = document.querySelector(
        'form.password-change' || 
        'form[name="passwordChangeForm"]' || 
        '#password-change-form'
      );

      if (!passwordForm) return;

      const newPasswordField = passwordForm.querySelector(
        'input[name="newPassword"]' ||
        'input[name="new_password"]' ||
        'input[id="newPwd"]'
      );

      const confirmPasswordField = passwordForm.querySelector(
        'input[name="confirmPassword"]' ||
        'input[name="confirm_password"]' ||
        'input[id="confirmPwd"]'
      );

      const submitButton = passwordForm.querySelector(
        'button[type="submit"]' ||
        'button.submit-btn'
      );

      if (!newPasswordField || !confirmPasswordField || !submitButton) return;

      console.log('[Roadwork Helper] 비밀번호 변경 페이지 감지');

      // 새 비밀번호 생성
      const result = await window.roadworkHelper.generateNewPassword();

      if (result && result.success) {
        const newPassword = result.payload.password;
        console.log('[Roadwork Helper] 새 비밀번호 생성됨');

        // 입력 필드 자동 채우기
        newPasswordField.value = newPassword;
        confirmPasswordField.value = newPassword;

        // 입력 이벤트 트리거 (페이지 유효성 검사)
        newPasswordField.dispatchEvent(new Event('input', { bubbles: true }));
        confirmPasswordField.dispatchEvent(new Event('input', { bubbles: true }));
        newPasswordField.dispatchEvent(new Event('change', { bubbles: true }));
        confirmPasswordField.dispatchEvent(new Event('change', { bubbles: true }));

        console.log('[Roadwork Helper] 비밀번호 필드 자동 채우기 완료');

        // 저장 버튼 클릭 대기 (사용자가 클릭하거나 자동 제출)
        submitButton.addEventListener('click', async () => {
          try {
            // 비밀번호 변경 완료 확인 대기 (최대 5초)
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const confirmResult = await window.roadworkHelper.confirmPasswordChange(newPassword);
            if (confirmResult?.success) {
              console.log('[Roadwork Helper] 비밀번호 변경 저장됨');
            }
          } catch (err) {
            console.error('[Roadwork Helper] 비밀번호 변경 확인 오류:', err);
          }
        }, { once: true });
      }
    } catch (err) {
      console.error('[Roadwork Helper] 비밀번호 변경 감지 오류:', err);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/**
 * [기능 3] 체크리스트 자동 체크 ("이상무" 항목)
 */
function setupChecklistObserver() {
  const observer = new MutationObserver(() => {
    try {
      // "이상무" 체크박스 찾기
      const checkboxes = document.querySelectorAll(
        'input[type="checkbox"][value="이상무"]' ||
        'input[type="checkbox"][id*="normal"]'
      );

      checkboxes.forEach(checkbox => {
        if (!checkbox.checked) {
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('[Roadwork Helper] 이상무 체크');
        }
      });
    } catch (err) {
      console.error('[Roadwork Helper] 체크리스트 감지 오류:', err);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/**
 * 입력 필드 자동 채우기
 * 
 * @param {Object} data - 로컬 DB에서 조회한 데이터
 * @param {number} data.flow - 유량
 * @param {number} data.medicine - 약품 사용량
 * @param {number} data.sludge - 슬러지 반출량
 * @param {number} data.water_bod - 수질 BOD
 * @param {number} data.water_ss - 수질 SS
 * @param {number} data.kit_usage - 분석키트 사용량
 */
async function fillFormFields(data) {
  try {
    const fieldMappings = [
      { selector: 'input[name="유량"]', value: data.flow },
      { selector: 'input[name="약품"]', value: data.medicine },
      { selector: 'input[name="슬러지"]', value: data.sludge },
      { selector: 'input[name="BOD"]', value: data.water_bod },
      { selector: 'input[name="SS"]', value: data.water_ss },
      { selector: 'input[name="키트"]', value: data.kit_usage },
      // 추가 필드는 실제 HTML 구조 확인 후 매핑
    ];

    for (const mapping of fieldMappings) {
      const element = document.querySelector(mapping.selector);
      if (element && mapping.value !== undefined && mapping.value !== null) {
        element.value = mapping.value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        console.log(`[Roadwork Helper] ${mapping.selector} = ${mapping.value}`);
      }
    }
  } catch (err) {
    console.error('[Roadwork Helper] 필드 채우기 오류:', err);
  }
}
```

---

### 3. Electron Main Process 수정

**파일**: `electron/main.cjs`

```javascript
const { ipcMain } = require('electron');
const Database = require('better-sqlite3');
const path = require('path');

// 로컬 DB 연결
const dbPath = path.join(app.getPath('userData'), 'wastewater.db');
const db = new Database(dbPath);

/**
 * IPC 핸들러 1: 특정 날짜의 운영 데이터 조회
 */
ipcMain.handle('getRoadworkData', async (event, date) => {
  try {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('Invalid date format: ' + date);
    }

    // 로컬 DB에서 해당 날짜의 데이터 조회
    const flowRow = db.prepare(`
      SELECT SUM(calculated_flow) as total_flow
      FROM flow_readings
      WHERE DATE(date) = ?
      LIMIT 1
    `).get(date);

    const medicineRow = db.prepare(`
      SELECT SUM(usage_amount) as total_medicine
      FROM medicine_usage
      WHERE DATE(date) = ?
      LIMIT 1
    `).get(date);

    const sludgeRow = db.prepare(`
      SELECT SUM(export_amount) as total_sludge
      FROM sludge_export
      WHERE DATE(date) = ?
      LIMIT 1
    `).get(date);

    const waterRow = db.prepare(`
      SELECT 
        AVG(bod) as avg_bod,
        AVG(ss) as avg_ss,
        AVG(t_n) as avg_t_n,
        AVG(t_p) as avg_t_p
      FROM water_readings
      WHERE DATE(date) = ?
      LIMIT 1
    `).get(date);

    const kitRow = db.prepare(`
      SELECT SUM(usage_count) as total_kit
      FROM kit_usage
      WHERE DATE(date) = ?
      LIMIT 1
    `).get(date);

    return {
      success: true,
      payload: {
        date,
        flow: flowRow?.total_flow || 0,
        medicine: medicineRow?.total_medicine || 0,
        sludge: sludgeRow?.total_sludge || 0,
        water_bod: waterRow?.avg_bod || 0,
        water_ss: waterRow?.avg_ss || 0,
        water_tn: waterRow?.avg_t_n || 0,
        water_tp: waterRow?.avg_t_p || 0,
        kit_usage: kitRow?.total_kit || 0
      }
    };
  } catch (err) {
    console.error('[getRoadworkData]', err);
    return {
      success: false,
      message: err.message
    };
  }
});

/**
 * IPC 핸들러 2: 새 비밀번호 생성 + DB 저장
 */
ipcMain.handle('generateNewPassword', async (event) => {
  try {
    // 보안 비밀번호 생성 (12자, 대문자/소문자/숫자/특수문자 포함)
    const newPassword = generateSecurePassword();

    // 도로공사 ID 조회
    const settingsRow = db.prepare(`
      SELECT roadwork_user_id FROM app_settings WHERE id = 1
    `).get();

    if (!settingsRow || !settingsRow.roadwork_user_id) {
      throw new Error('도로공사 ID가 설정되지 않았습니다.');
    }

    // DB에 새 비밀번호 저장
    db.prepare(`
      UPDATE app_settings 
      SET roadwork_password = ?
      WHERE id = 1
    `).run(newPassword);

    return {
      success: true,
      payload: {
        password: newPassword,
        timestamp: new Date().toISOString()
      }
    };
  } catch (err) {
    console.error('[generateNewPassword]', err);
    return {
      success: false,
      message: err.message
    };
  }
});

/**
 * IPC 핸들러 3: 비밀번호 변경 완료 확인
 */
ipcMain.handle('confirmPasswordChange', async (event, newPassword) => {
  try {
    // 변경된 비밀번호 검증
    const settingsRow = db.prepare(`
      SELECT roadwork_password FROM app_settings WHERE id = 1
    `).get();

    if (settingsRow?.roadwork_password === newPassword) {
      return {
        success: true,
        message: '비밀번호 변경이 저장되었습니다.'
      };
    } else {
      throw new Error('비밀번호 검증 실패');
    }
  } catch (err) {
    console.error('[confirmPasswordChange]', err);
    return {
      success: false,
      message: err.message
    };
  }
});

/**
 * 보안 비밀번호 생성 함수
 * - 12자 이상
 * - 대문자(A-Z), 소문자(a-z), 숫자(0-9), 특수문자(!@#$%^&*) 포함
 */
function generateSecurePassword() {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*';
  
  const allChars = uppercase + lowercase + numbers + special;
  
  let password = '';
  
  // 각 카테고리에서 최소 1개씩 선택
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  // 나머지 8자는 랜덤
  for (let i = password.length; i < 12; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // 순서 섞기
  return password.split('').sort(() => Math.random() - 0.5).join('');
}
```

---

### 4. RoadworkHelperViewModel 수정

**파일**: `src/features/roadwork-helper/useRoadworkHelperViewModel.js`

```javascript
import { useState, useCallback } from 'react';
import { RoadworkHelperModel } from './RoadworkHelperModel';

export const useRoadworkHelperViewModel = () => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(null);

  // 도로공사 URL 조회 (설정에서 가져옴)
  const getRoadworkUrl = useCallback(() => {
    // 설정 API에서 도로공사 URL 가져오기
    // TODO: 실제 구현 시 설정값 조회
    return process.env.REACT_APP_ROADWORK_URL || 'https://example.com/roadwork';
  }, []);

  const reload = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await RoadworkHelperModel.fetchAll(date);
      if (response.success) {
        setSections(response.sections || []);
      } else {
        setError(response.message || '데이터 로드 실패');
      }
    } catch (err) {
      setError(err.message || '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const copySection = useCallback((section) => {
    // 표 데이터를 텍스트로 변환해서 클립보드에 복사
    const text = sectionToText(section);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(section.id);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);

  const copyAll = useCallback(() => {
    const allText = sections.map(sectionToText).join('\n\n');
    navigator.clipboard.writeText(allText).then(() => {
      setCopied('all');
      setTimeout(() => setCopied(null), 2000);
    });
  }, [sections]);

  return {
    date,
    setDate,
    sections,
    loading,
    error,
    copied,
    getRoadworkUrl,
    reload,
    copySection,
    copyAll
  };
};

function sectionToText(section) {
  let text = `${section.number} ${section.title}\n`;
  text += section.columns.map(c => c.label).join('\t') + '\n';
  text += section.rows
    .map(row => section.columns.map(c => row[c.key] || '').join('\t'))
    .join('\n');
  return text;
}
```

---

## 기술 검증 항목

도로공사 실제 페이지 접근 후 다음 항목을 **반드시 확인**해야 합니다:

### HTML 구조 확인

```
□ 날짜 입력 필드
  - Selector: ____________
  - Type: [ ] text  [ ] date  [ ] 기타
  - Name/ID: ____________

□ 유량 입력 필드
  - Selector: ____________
  - 값의 단위: ____________

□ 약품 입력 필드
  - Selector: ____________
  - 복수 항목인가? [ ] Yes [ ] No

□ 슬러지 입력 필드
  - Selector: ____________
  - 값의 단위: ____________

□ 수질분석값 입력 필드
  - BOD Selector: ____________
  - SS Selector: ____________
  - T-N Selector: ____________
  - T-P Selector: ____________

□ 체크리스트
  - "이상무" 체크박스 Selector: ____________
  - 다른 체크 항목들: ____________

□ 비밀번호 변경 폼
  - Form Selector: ____________
  - 새 비밀번호 필드 Selector: ____________
  - 비밀번호 확인 필드 Selector: ____________
  - 저장 버튼 Selector: ____________
  - 비밀번호 복잡도 요구사항: ____________

□ 사진 업로드 필드
  - File Input Selector: ____________
  - 단일 업로드인가? [ ] Yes [ ] No
  - 최대 파일 크기: ____________
```

### 기술적 제약 사항 확인

```
□ webview에서 CORS 이슈 없음
□ 세션/쿠키가 webview에서 유지되는가?
□ JavaScript 주입이 동작하는가?
□ 파일 업로드 input은 보안상 자동화 불가능한가? ✅ (웹 표준)
□ 2FA는 수동으로만 가능한가? ✅ (보안)
```

---

## 구현 일정

### Week 1: 기반 구조
- **Mon-Tue**: 도로공사 사이트 접근 → HTML 구조 파악
- **Wed**: RoadworkHelperView + webview 기본 구현
- **Thu**: preload 스크립트 틀 작성
- **Fri**: IPC 채널 등록 + 기본 테스트

### Week 2: 자동입력 기능
- **Mon-Tue**: 날짜 감지 + DB 조회 로직
- **Wed**: 입력 필드 자동 채우기
- **Thu**: 체크리스트 자동 체크
- **Fri**: 통합 테스트 + 버그 수정

### Week 3: 비밀번호 자동화
- **Mon-Tue**: 비밀번호 변경 페이지 감지 로직
- **Wed**: 비밀번호 생성 함수 + DB 저장
- **Thu**: 자동입력 + 저장 버튼 클릭
- **Fri**: 전체 테스트 + 최적화

### Week 4: 검증 및 배포
- **Mon-Tue**: 현장 환경에서 실제 테스트
- **Wed-Thu**: 버그 수정 + 성능 최적화
- **Fri**: 문서화 + 릴리즈 준비

---

## 주요 리스크 및 대응

### Risk 1: webview 세션 격리
**문제**: 각 사용자/현장마다 별도의 로그인 세션 필요
**대응**: 
- webview별 쿠키 저장소 분리 (사용자별 디렉토리)
- 현장 선택 시 webview 재초기화

### Risk 2: 도로공사 사이트 변경
**문제**: 도로공사가 HTML 구조를 변경하면 자동화 실패
**대응**:
- 에러 로깅 + 사용자에게 알림
- 입력 도우미(테이블 복사)는 계속 제공
- 정기적인 모니터링 및 유지보수 계획

### Risk 3: 파일 업로드 자동화 불가
**문제**: 웹 보안 정책상 JS에서 파일 input 자동 제어 불가
**대응**: 
- 사진은 사용자가 수동으로 드래그드롭 또는 파일 선택
- 입력 도우미에서 "사진 업로드" 단계는 안내만 제공

### Risk 4: 2FA 자동화 불가
**문제**: 문자메시지 수신 자동화 불가능
**대응**:
- 2FA는 사용자 수동 진행 (앱에서 안내)
- 2FA 통과 후 나머지는 완전 자동화

### Risk 5: 성능 저하
**문제**: MutationObserver가 전체 DOM을 감시하면서 성능 저하
**대응**:
- 감시 범위 제한 (특정 컨테이너만)
- 이벤트 디바운싱
- preload 스크립트 최소화

---

## 검토 체크리스트

- [ ] 아키텍처 검증
- [ ] 보안 관점 검증 (IPC, preload, contextIsolation)
- [ ] 법적/규정 검증 (자동 로그인 가능성?)
- [ ] 사용자 UX 검증 (2FA 단계에서의 사용자 경험)
- [ ] 비용/일정 검증
- [ ] 도로공사 약관 검증 (자동화 허용 여부)

---

## 다음 단계

1. **검토 완료** → 2. 도로공사 사이트 접근 + HTML 구조 파악 → 3. 개발 시작
