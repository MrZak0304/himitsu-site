// ネイティブ(Capacitor)ストレージ層。Webビルドでは読み込まれない(app.js がネイティブ判定後に dynamic import)。
// - capacitorBackend():   Preferences / Filesystem(Documents)への薄いラッパ(バックエンド契約)
// - createNativeStorage:  kv.js へ注入する storage。メモリキャッシュ+キー別直列化 write-through(プランKTD2)
// - createFilesystemImageBackend: images.js へ注入する画像バックエンド(原寸/.thumb/.json の3ファイル形)
// - runMigration:         WebViewストレージ→ネイティブへの一方向移行(判定はマーカーのみ・staging→アトミック切替。プランKTD3)
//
// 日記データはOSに消されない Documents 配下へ置く。WebViewのlocalStorage/IndexedDBは移行後は参照しない
// (移行元データは復旧原本として保持し、削除は次期リリースで再検討)。

import { collectReferencedImageIds, findMissingImageIds } from '../core/migration.js';

export const DATA_DIR = 'data';
export const IMAGE_DIR = 'images';
export const STAGING_DIR = 'migrating';
export const MARKER_PATH = `${DATA_DIR}/migrated.json`;
export const SETTINGS_KEY = 'diary-settings-v1';
export const COLLECTION_KEYS = ['diary-entries-v1', 'diary-tags-v1', 'diary-tag-folders-v1', 'diary-habits-v1', 'diary-habitlogs-v1'];
export const PREFERENCES_MAX = 100_000; // Preferencesは小さな設定のみ(プランKTD2)

export const MESSAGES = {
  notReady: 'ストレージの初期化が終わる前にデータへアクセスしました。アプリを再起動してください。',
  writeFailed: 'データの保存に失敗しました。端末の空き容量をご確認ください。',
  corrupt: (key) => `保存データの一部(${key})を読み込めませんでした。壊れたファイルは退避し、以降の記録は新しく保存します。`,
  tooLarge: '設定データが大きすぎるため保存できませんでした。',
  migrateFailed: 'データの引っ越しに失敗しました。空き容量を確認してください(次回起動時に自動で再試行します)。',
  missingImages: (n) => `引っ越し後の確認で、${n}件の画像が見つかりませんでした。バックアップをお持ちの場合は取り込みで復元できます。`,
};

// --- base64 ヘルパ(1画像単位の小サイズ変換。バックアップの一括変換はWorker側が担当) ---

const CHUNK = 0x8000;

export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || 'application/octet-stream' });
}

// --- Capacitor バックエンド(契約: テストでは同じ形のメモリ実装を注入する) ---

export function capacitorBackend() {
  const { Filesystem, Preferences } = window.Capacitor.Plugins;
  const DIR = 'DOCUMENTS';

  // 一時ファイル→rename のアトミック書き込み。renameは既存宛先で失敗しうるため先に削除する。
  // 削除→rename間のクラッシュは readText の .tmp フォールバックで回復する。
  async function writeTextAtomic(path, text) {
    const tmp = `${path}.tmp`;
    await Filesystem.writeFile({ path: tmp, directory: DIR, data: text, encoding: 'utf8', recursive: true });
    try {
      await Filesystem.deleteFile({ path, directory: DIR });
    } catch {
      /* 初回は無い */
    }
    await Filesystem.rename({ from: tmp, to: path, directory: DIR, toDirectory: DIR });
  }

  async function readTextRaw(path) {
    try {
      const r = await Filesystem.readFile({ path, directory: DIR, encoding: 'utf8' });
      return typeof r.data === 'string' ? r.data : null;
    } catch {
      return null;
    }
  }

  return {
    async prefsGet(key) {
      const { value } = await Preferences.get({ key });
      return value ?? null;
    },
    async prefsSet(key, value) {
      await Preferences.set({ key, value });
    },
    async readText(path) {
      const v = await readTextRaw(path);
      if (v !== null) return v;
      return readTextRaw(`${path}.tmp`); // クラッシュ窓(削除→rename間)の回復
    },
    writeTextAtomic,
    async writeBase64(path, data) {
      await Filesystem.writeFile({ path, directory: DIR, data, recursive: true });
    },
    async readBase64(path) {
      try {
        const r = await Filesystem.readFile({ path, directory: DIR });
        return typeof r.data === 'string' ? r.data : null;
      } catch {
        return null;
      }
    },
    async deleteFile(path) {
      try {
        await Filesystem.deleteFile({ path, directory: DIR });
      } catch {
        /* 無ければ無視 */
      }
    },
    async rename(from, to) {
      await Filesystem.rename({ from, to, directory: DIR, toDirectory: DIR });
    },
    async mkdir(path) {
      try {
        await Filesystem.mkdir({ path, directory: DIR, recursive: true });
      } catch {
        /* 既存なら無視 */
      }
    },
    async rmdir(path) {
      try {
        await Filesystem.rmdir({ path, directory: DIR, recursive: true });
      } catch {
        /* 無ければ無視 */
      }
    },
    async readdir(path) {
      try {
        const r = await Filesystem.readdir({ path, directory: DIR });
        return (r.files ?? []).map((f) => (typeof f === 'string' ? f : f.name));
      } catch {
        return [];
      }
    },
  };
}

// --- kv.js へ注入する storage(メモリ+キー別直列化 write-through) ---

export function createNativeStorage({ backend, onError = () => {} }) {
  const mem = new Map();
  const queues = new Map(); // key → { writing: Promise|null, pending: boolean }
  let ready = false;

  function ensureReady() {
    if (!ready) throw new Error(MESSAGES.notReady);
  }

  function persist(key) {
    let q = queues.get(key);
    if (!q) {
      q = { writing: null, pending: false };
      queues.set(key, q);
    }
    if (q.writing) {
      q.pending = true; // latest-wins: 進行中なら完了後に最新値をもう一度書く
      return;
    }
    q.pending = false;
    const value = mem.has(key) ? mem.get(key) : null;
    q.writing = (async () => {
      // 代入(q.writing = …)より先に本体が完走して finally の null 代入が上書きされるのを防ぐ。
      // await に到達せず同期で throw する経路(サイズ上限など)があるため、必ず一度譲る。
      await null;
      try {
        if (key === SETTINGS_KEY) {
          if (value !== null && value.length > PREFERENCES_MAX) throw new Error(MESSAGES.tooLarge);
          if (value === null) await backend.prefsSet(key, '');
          else await backend.prefsSet(key, value);
        } else if (value === null) {
          await backend.deleteFile(`${DATA_DIR}/${key}.json`);
        } else {
          await backend.writeTextAtomic(`${DATA_DIR}/${key}.json`, value);
        }
      } catch (err) {
        onError(err?.message === MESSAGES.tooLarge ? MESSAGES.tooLarge : MESSAGES.writeFailed);
      } finally {
        q.writing = null;
        if (q.pending) persist(key);
      }
    })();
  }

  return {
    async bootstrap() {
      const s = await backend.prefsGet(SETTINGS_KEY);
      if (s) mem.set(SETTINGS_KEY, s);
      for (const key of COLLECTION_KEYS) {
        const path = `${DATA_DIR}/${key}.json`;
        const text = await backend.readText(path);
        if (text === null) continue;
        try {
          JSON.parse(text);
          mem.set(key, text);
        } catch {
          // 破損ファイルは退避して上書き禁止(空データで全損させない: プランKTD2)
          await backend.rename(path, `${path}.corrupt`).catch(() => {});
          onError(MESSAGES.corrupt(key));
        }
      }
      ready = true;
    },
    // pause時に呼ぶ。未書き込みが無くなるまで待つ
    async flush() {
      for (;;) {
        const writing = [...queues.values()].map((q) => q.writing).filter(Boolean);
        if (writing.length === 0) return;
        await Promise.all(writing);
      }
    },
    getItem(key) {
      ensureReady();
      return mem.has(key) ? mem.get(key) : null;
    },
    setItem(key, value) {
      ensureReady();
      mem.set(key, String(value));
      persist(key);
    },
    removeItem(key) {
      ensureReady();
      mem.delete(key);
      persist(key);
    },
  };
}

// --- images.js へ注入する画像バックエンド(Documents/images/<id> + <id>.thumb + <id>.json) ---

export function createFilesystemImageBackend({ backend }) {
  async function readRecord(id) {
    const metaText = await backend.readText(`${IMAGE_DIR}/${id}.json`);
    if (!metaText) return undefined;
    let meta;
    try {
      meta = JSON.parse(metaText);
    } catch {
      return undefined;
    }
    const main = await backend.readBase64(`${IMAGE_DIR}/${id}`);
    if (main === null) return undefined;
    const thumb = await backend.readBase64(`${IMAGE_DIR}/${id}.thumb`);
    return {
      id,
      blob: base64ToBlob(main, meta.mime),
      thumbBlob: thumb !== null ? base64ToBlob(thumb, meta.thumbMime) : null,
      width: meta.width,
      height: meta.height,
      kind: meta.kind,
    };
  }

  return {
    async put(record) {
      await backend.mkdir(IMAGE_DIR);
      await backend.writeBase64(`${IMAGE_DIR}/${record.id}`, await blobToBase64(record.blob));
      if (record.thumbBlob) {
        await backend.writeBase64(`${IMAGE_DIR}/${record.id}.thumb`, await blobToBase64(record.thumbBlob));
      }
      // メタは最後に書く(メタの存在=レコード完成の印)
      await backend.writeTextAtomic(
        `${IMAGE_DIR}/${record.id}.json`,
        JSON.stringify({
          mime: record.blob?.type ?? 'image/jpeg',
          thumbMime: record.thumbBlob?.type ?? 'image/jpeg',
          width: record.width,
          height: record.height,
          kind: record.kind ?? 'entry',
        }),
      );
    },
    async get(id) {
      return readRecord(id);
    },
    async delete(id) {
      await backend.deleteFile(`${IMAGE_DIR}/${id}.json`);
      await backend.deleteFile(`${IMAGE_DIR}/${id}`);
      await backend.deleteFile(`${IMAGE_DIR}/${id}.thumb`);
    },
    async getAll() {
      const names = await backend.readdir(IMAGE_DIR);
      const ids = names.filter((n) => n.endsWith('.json') && !n.endsWith('.corrupt')).map((n) => n.slice(0, -5));
      const out = [];
      for (const id of ids) {
        const rec = await readRecord(id);
        if (rec) out.push(rec);
      }
      return out;
    },
    async clear() {
      await backend.rmdir(IMAGE_DIR);
      await backend.mkdir(IMAGE_DIR);
    },
  };
}

// --- 一方向マイグレーション(判定はマーカーのみ。staging→アトミック切替・冪等再実行) ---
// マーカーはネイティブstoreの使用開始前に必ず書かれるため、「マーカーなし」の data/ images/ は
// 移行途中のクラッシュ残骸でしかなく、破棄して最初からやり直してよい(プランRisks表1行目)。

export async function runMigration({ backend, webStorage, idbStore, onProgress = () => {} }) {
  const marker = await backend.readText(MARKER_PATH);
  if (marker !== null) return { migrated: false, skipped: true };

  // 残骸の破棄(冪等)
  await backend.rmdir(STAGING_DIR);
  await backend.rmdir(DATA_DIR);
  await backend.rmdir(IMAGE_DIR);
  await backend.mkdir(`${STAGING_DIR}/${DATA_DIR}`);
  await backend.mkdir(`${STAGING_DIR}/${IMAGE_DIR}`);

  // WebViewストレージからの読み出し
  const collected = {};
  for (const key of [SETTINGS_KEY, ...COLLECTION_KEYS]) {
    let v = null;
    try {
      v = webStorage?.getItem(key) ?? null;
    } catch {
      v = null;
    }
    if (v !== null) {
      collected[key] = v;
      await backend.writeTextAtomic(`${STAGING_DIR}/${DATA_DIR}/${key}.json`, v);
    }
  }

  let images = [];
  try {
    images = (await idbStore?.list()) ?? [];
  } catch {
    images = [];
  }
  let done = 0;
  const imageIds = [];
  for (const rec of images) {
    imageIds.push(rec.id);
    await backend.writeBase64(`${STAGING_DIR}/${IMAGE_DIR}/${rec.id}`, await blobToBase64(rec.blob));
    if (rec.thumbBlob) {
      await backend.writeBase64(`${STAGING_DIR}/${IMAGE_DIR}/${rec.id}.thumb`, await blobToBase64(rec.thumbBlob));
    }
    await backend.writeTextAtomic(
      `${STAGING_DIR}/${IMAGE_DIR}/${rec.id}.json`,
      JSON.stringify({
        mime: rec.blob?.type ?? 'image/jpeg',
        thumbMime: rec.thumbBlob?.type ?? 'image/jpeg',
        width: rec.width,
        height: rec.height,
        kind: rec.kind ?? 'entry',
      }),
    );
    done += 1;
    onProgress(done, images.length);
  }

  // 参照整合チェック(欠落があっても移行は続行し、件数を報告する)
  const referenced = collectReferencedImageIds(collected);
  const missing = findMissingImageIds(referenced, imageIds);

  // コミット: staging → 最終位置。settings は Preferences へ
  await backend.rename(`${STAGING_DIR}/${DATA_DIR}`, DATA_DIR);
  await backend.rename(`${STAGING_DIR}/${IMAGE_DIR}`, IMAGE_DIR);
  await backend.rmdir(STAGING_DIR);
  if (collected[SETTINGS_KEY]) {
    await backend.prefsSet(SETTINGS_KEY, collected[SETTINGS_KEY]);
    await backend.deleteFile(`${DATA_DIR}/${SETTINGS_KEY}.json`); // 設定の正本はPreferences(平文の重複を残さない)
  }

  // マーカーは最後(これが書けたら移行完了)
  await backend.writeTextAtomic(
    MARKER_PATH,
    JSON.stringify({ v: 1, migratedAt: Date.now(), images: imageIds.length, missingImages: missing.length }),
  );

  return { migrated: true, skipped: false, images: imageIds.length, missing };
}
