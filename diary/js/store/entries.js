// 記録(entry)ストア。キーは日付(YYYY-MM-DD)。公開APIは async に統一し、
// モバイル化時に SQLite 等へ実装だけ差し替えられるようにする(プランKTD2)。

import { isValidKey } from '../core/dates.js';
import { removeTagFromEntries } from '../core/tags-usage.js';
import { createKvStore } from './kv.js';

const KEY = 'diary-entries-v1';

function normalizeEntry(raw, date) {
  if (typeof raw !== 'object' || raw === null) raw = {};
  const images = Array.isArray(raw.images) ? raw.images.filter((v) => typeof v === 'string') : [];
  let push = raw.pushImageIndex;
  if (!Number.isInteger(push) || push < 0 || push >= images.length) push = images.length > 0 ? 0 : null;
  return {
    date,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((v) => typeof v === 'string') : [],
    text: typeof raw.text === 'string' ? raw.text : '',
    images,
    pushImageIndex: push,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
  };
}

function normalizeAll(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out = {};
  for (const [date, entry] of Object.entries(raw)) {
    if (!isValidKey(date)) continue;
    out[date] = normalizeEntry(entry, date);
  }
  return out;
}

export function createEntriesStore(storage) {
  const kv = createKvStore({ key: KEY, fallback: {}, normalize: normalizeAll, storage });

  return {
    async get(date) {
      return kv.load()[date] ?? null;
    },
    async all() {
      return kv.load();
    },
    // patch を当てて保存し、正規化後の entry を返す
    async upsert(date, patch) {
      const map = kv.load();
      const cur = map[date] ?? normalizeEntry({}, date);
      const next = normalizeEntry({ ...cur, ...patch, createdAt: cur.createdAt, updatedAt: Date.now() }, date);
      map[date] = next;
      kv.save(map);
      return next;
    },
    async replaceAll(map) {
      kv.save(normalizeAll(map));
    },
    // タグの完全削除時に、全記録からそのタグIDを取り除く(記録が変わる=C案の完全削除)。
    // 変更のあった日付数を返す。
    async removeTagEverywhere(tagId) {
      const { entries, changed } = removeTagFromEntries(kv.load(), tagId);
      if (changed.length > 0) kv.save(entries);
      return changed.length;
    },
  };
}
