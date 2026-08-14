// js/core/presets-store.js — 保存データ(条件+体型調整)のピュアロジック
// storage は {getItem, setItem, removeItem} を注入する(localStorage またはテスト用フェイク)。
// 保存形式は v フィールドでバージョン管理(不変条件)。形式変更時は v を上げ読み込み互換を保つ。

export const STORE_KEY = 'shinzaiMaker.presets';
export const FORMAT_VERSION = 1;

export function loadPresets(storage) {
  try {
    const raw = storage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.v !== FORMAT_VERSION || !Array.isArray(parsed.items)) return [];
    return parsed.items.filter((it) => typeof it?.name === 'string' && it.data);
  } catch {
    return [];
  }
}

function persist(storage, items) {
  storage.setItem(STORE_KEY, JSON.stringify({ v: FORMAT_VERSION, items }));
}

// 同名は上書き(上書き確認はUI側の責務)。新規追加で limit 超過なら日本語エラー。
export function savePreset(storage, { name, data, savedAt = 0 }, { limit = Infinity } = {}) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('保存する名前を入力してください');
  const items = loadPresets(storage);
  const idx = items.findIndex((it) => it.name === trimmed);
  const entry = { name: trimmed, savedAt, data };
  if (idx >= 0) {
    items[idx] = entry;
  } else {
    if (items.length >= limit) {
      throw new Error(`無料版で保存できるのは${limit}件までです(有料版は無制限)`);
    }
    items.push(entry);
  }
  persist(storage, items);
  return items;
}

export function deletePreset(storage, name) {
  const items = loadPresets(storage).filter((it) => it.name !== name);
  persist(storage, items);
  return items;
}

export function hasPreset(storage, name) {
  return loadPresets(storage).some((it) => it.name === (name ?? '').trim());
}
