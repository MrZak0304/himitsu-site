// 画像ストア(実体保存)。Webでは IndexedDB、モバイル化時は Filesystem 実装に差し替える。
// backend を注入できるので、Node からは契約(API形)をモックで検証する。
// レコード形: {id, blob, thumbBlob, width, height, kind}
//   kind: 'entry'(記録の添付) | 'icon'(日課アイコン) | 'character'(ユーザー保存キャラ)

export const IMAGE_SAVE_MESSAGE = '画像の保存に失敗しました。端末の空き容量をご確認ください。';

const DB_NAME = 'diary-images-v1';
const STORE = 'images';

function idbBackend() {
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function tx(mode, run) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(STORE, mode);
          const req = run(t.objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }),
    );
  }

  return {
    put: (record) => tx('readwrite', (s) => s.put(record)),
    get: (id) => tx('readonly', (s) => s.get(id)),
    delete: (id) => tx('readwrite', (s) => s.delete(id)),
    getAll: () => tx('readonly', (s) => s.getAll()),
    clear: () => tx('readwrite', (s) => s.clear()),
  };
}

export function createImageStore(backend = idbBackend()) {
  return {
    async put(record) {
      try {
        await backend.put(record);
        return record.id;
      } catch (err) {
        const e = new Error(IMAGE_SAVE_MESSAGE);
        e.code = 'image-store';
        e.cause = err;
        throw e;
      }
    },
    async get(id) {
      return (await backend.get(id)) ?? null;
    },
    async remove(id) {
      await backend.delete(id);
    },
    async list() {
      return (await backend.getAll()) ?? [];
    },
    async clear() {
      await backend.clear();
    },
  };
}
