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
  }

  isAttached() { return this.attached; }
  attach() { this.attached = true; }
  detach() { this.attached = false; }

  async sendCommand(method, payload = {}) {
    if (method === 'Runtime.evaluate') {
      if (this.mode === 'chooser') {
        setImmediate(() => this.emit('message', {}, 'Page.fileChooserOpened', { backendNodeId: 700 + this.uploaderIndex }));
      }
      return { result: { value: true } };
    }
    if (method === 'DOM.getDocument') {
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
        results.push({ uploaderIndex, method: result.method });
      }
      return results;
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
