// 장비/이력 사진 로컬 저장소(프로토타입): IndexedDB에 저장한다.
// - 'photos' 스토어: 장비 대표사진 1장 (key = equipment id, value = Blob)
// - 'multi' 스토어: 이력 사진 여러 장 (key = `history:<id>`, value = Blob 배열)
// Phase 2에서는 앱 데이터 경로(사진관리/장비이력/...) + equipment_asset_photos 테이블로 대체된다.
const DB_NAME = 'osoo-equipment-photos';
const STORE = 'photos';
const MULTI_STORE = 'multi';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(MULTI_STORE)) db.createObjectStore(MULTI_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export const photoStore = {
  async save(id, file) {
    await withStore(STORE, 'readwrite', (store) => store.put(file, id));
    return true;
  },

  async load(id) {
    return withStore(STORE, 'readonly', (store) => store.get(id));
  },

  async remove(id) {
    await withStore(STORE, 'readwrite', (store) => store.delete(id));
    return true;
  },

  // 다중 사진(이력용): 배열 전체를 저장한다(교체 방식).
  async saveSet(key, blobs) {
    await withStore(MULTI_STORE, 'readwrite', (store) => store.put(blobs, key));
    return true;
  },

  async loadSet(key) {
    return (await withStore(MULTI_STORE, 'readonly', (store) => store.get(key))) || [];
  },

  async removeSet(key) {
    await withStore(MULTI_STORE, 'readwrite', (store) => store.delete(key));
    return true;
  },
};

export default photoStore;
