'use strict';

const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');

function loadPhotoHelper() {
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return { session: {}, webContents: { fromId: () => null } };
    return originalLoad.apply(this, [request, parent, isMain]);
  };
  try {
    return require(path.join(PROJECT_ROOT, 'electron', 'roadworkDumpHelper.cjs'));
  } finally {
    Module._load = originalLoad;
  }
}

class DiagnosticDebugger extends EventEmitter {
  constructor(mode, uploaderIndex) {
    super();
    this.mode = mode;
    this.uploaderIndex = uploaderIndex;
    this.attached = false;
    this.setFileCalls = [];
    this.runtimePayloads = [];
    this.inputEvents = [];
  }

  isAttached() { return this.attached; }
  attach() { this.attached = true; }
  detach() { this.attached = false; }

  async sendCommand(method, payload = {}) {
    if (method === 'Runtime.evaluate') {
      this.runtimePayloads.push(payload);
      if (this.mode === 'chooser') {
        setImmediate(() => this.emit('message', {}, 'Page.fileChooserOpened', { backendNodeId: 700 + this.uploaderIndex }));
      }
      return { result: { value: true } };
    }
    if (method === 'Input.dispatchKeyEvent') {
      this.inputEvents.push(payload);
      if (this.mode === 'trusted-key' && payload.type === 'rawKeyDown') {
        setImmediate(() => this.emit('message', {}, 'Page.fileChooserOpened', { backendNodeId: 800 + this.uploaderIndex }));
      }
      return {};
    }
    if (method === 'DOM.getDocument') {
      if (this.mode === 'trusted-key') return { root: { nodeName: '#document', nodeId: 1, children: [] } };
      return {
        root: {
          nodeName: '#document',
          nodeId: 1,
          children: [
            { nodeName: 'INPUT', nodeId: 101, attributes: ['id', 'dragDrop1_input', 'type', 'file'] },
            { nodeName: 'INPUT', nodeId: 100 + this.uploaderIndex, attributes: ['id', `dragDrop${this.uploaderIndex}_input`, 'type', 'file'] },
          ],
        },
      };
    }
    if (method === 'DOM.setFileInputFiles') {
      this.setFileCalls.push(payload);
      return {};
    }
    return {};
  }
}

module.exports = {
  id: 'roadwork-photo-injection',
  covers: ['roadwork-helper'],
  version: '0.2.0',
  status: 'implemented',
  async run({ ctx }) {
    const helper = loadPhotoHelper();

    await ctx.step('load-real-photo-injector', async () => {
      ctx.assert(typeof helper.attachRoadworkPhotoFile === 'function',
        '공사입력도우미 CDP 사진 첨부 헬퍼가 export되지 않았습니다.', 'PHOTO_INJECTOR_NOT_EXPORTED');
      return 'loaded';
    });

    await ctx.step('attach-four-first-round-photos-sequentially', async () => {
      const results = [];
      for (let uploaderIndex = 1; uploaderIndex <= 4; uploaderIndex += 1) {
        const mode = uploaderIndex <= 2 ? 'chooser' : 'direct';
        const debuggerApi = new DiagnosticDebugger(mode, uploaderIndex);
        const result = await helper.attachRoadworkPhotoFile({
          target: { debugger: debuggerApi },
          filePath: `C:\\diagnostic\\first-round-${uploaderIndex}.jpg`,
          uploaderIndex,
          chooserTimeouts: [5],
          retryDelayMs: 0,
        });
        ctx.assert(result.success, `사진 ${uploaderIndex}번 연속 첨부가 실패했습니다.`, 'SEQUENTIAL_PHOTO_ATTACH_FAILED', result);
        ctx.assert(debuggerApi.setFileCalls.length === 1,
          `사진 ${uploaderIndex}번이 정확히 한 번 첨부되지 않았습니다.`, 'PHOTO_ATTACH_COUNT_WRONG', debuggerApi.setFileCalls);
        if (mode === 'direct') {
          ctx.assert(debuggerApi.setFileCalls[0].nodeId === 100 + uploaderIndex,
            '공통 파일선택창 미감지 시 다른 사진 보드의 input을 선택했습니다.', 'WRONG_UPLOADER_INPUT_SELECTED', debuggerApi.setFileCalls[0]);
          ctx.assert(result.method === 'direct-file-input',
            '숨은 파일 input 복구 경로가 사용되지 않았습니다.', 'DIRECT_INPUT_FALLBACK_MISSED', result);
        } else {
          ctx.assert(result.method === 'file-chooser',
            '정상 공통 파일선택창 경로가 사용되지 않았습니다.', 'FILE_CHOOSER_PATH_MISSED', result);
        }
        ctx.assert(debuggerApi.runtimePayloads.every((payload) => payload.userGesture === true),
          '파일 추가 버튼 클릭에 CDP 사용자 제스처가 누락됐습니다.', 'PHOTO_USER_GESTURE_MISSING', debuggerApi.runtimePayloads);
        results.push({ uploaderIndex, method: result.method });
      }
      return results;
    });

    await ctx.step('recover-with-trusted-key-when-script-click-is-blocked', async () => {
      const debuggerApi = new DiagnosticDebugger('trusted-key', 2);
      const result = await helper.attachRoadworkPhotoFile({
        target: { debugger: debuggerApi },
        filePath: 'C:\\diagnostic\\trusted-key.jpg',
        uploaderIndex: 2,
        chooserTimeouts: [5, 20],
        retryDelayMs: 0,
      });
      ctx.assert(result.success && result.method === 'file-chooser',
        '스크립트 클릭 차단 후 신뢰 키 입력으로 복구하지 못했습니다.', 'TRUSTED_KEY_RECOVERY_FAILED', result);
      ctx.assert(debuggerApi.inputEvents.some((event) => event.type === 'rawKeyDown' && event.key === 'Enter'),
        '파일 버튼에 신뢰 Enter 입력이 전달되지 않았습니다.', 'TRUSTED_KEY_NOT_DISPATCHED', debuggerApi.inputEvents);
      ctx.assert(debuggerApi.runtimePayloads.every((payload) => payload.userGesture === true),
        '복구 시도에서 사용자 제스처 계약이 깨졌습니다.', 'TRUSTED_KEY_USER_GESTURE_MISSING', debuggerApi.runtimePayloads);
    });

    await ctx.step('photo-progress-and-no-photo-guidance-contract', async () => {
      const source = fs.readFileSync(path.join(PROJECT_ROOT, 'src/features/roadwork-helper/RoadworkHelperView.jsx'), 'utf8');
      ctx.assert(source.includes('실험분석 사진은 준비되지 않아 올리지 않습니다'),
        '준비 사진 없음 안내가 누락됐습니다.', 'NO_PHOTO_GUIDANCE_MISSING');
      ctx.assert(source.includes('role="progressbar"') && source.includes('사진 반영을 확인하고 있습니다'),
        '사진별 진행률 또는 지연 반영 확인 UI가 누락됐습니다.', 'PHOTO_PROGRESS_CONTRACT_MISSING');
      ctx.assert(source.includes("'photo-row-added-delayed'"),
        '늦게 반영된 사진의 성공 판정이 누락됐습니다.', 'DELAYED_PHOTO_CONFIRMATION_MISSING');
    });
  },
};
