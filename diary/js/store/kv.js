// localStorage ストア共通部。storage を注入できるファクトリ(curly-train 方式)で
// Node からテスト可能。読み出しは必ず normalize を通し、壊れたデータでも落ちない。
// 日記データは端末内にのみ保存し、外部送信しない(CLAUDE.md 不変条件1)。

const PROBE_KEY = '__diary_probe__';

export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

// localStorage が使えるかプローブ書込みで確認し、ダメならメモリのみで動作継続
export function defaultStorage() {
  try {
    const s = globalThis.localStorage;
    s.setItem(PROBE_KEY, '1');
    s.removeItem(PROBE_KEY);
    return s;
  } catch {
    return memoryStorage();
  }
}

export const QUOTA_MESSAGE = '保存に失敗しました。端末の空き容量が不足している可能性があります。';

export function createKvStore({ key, fallback, normalize = (v) => v, storage = defaultStorage() }) {
  function load() {
    try {
      const raw = storage.getItem(key);
      if (raw == null) return normalize(structuredClone(fallback), { fresh: true });
      return normalize(JSON.parse(raw), { fresh: false });
    } catch {
      return normalize(structuredClone(fallback), { fresh: true });
    }
  }

  // 日記データはユーザーの明示保存物なので、容量超過時に勝手に削らず日本語エラーで委ねる
  function save(value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (err) {
      const e = new Error(QUOTA_MESSAGE);
      e.code = 'quota';
      e.cause = err;
      throw e;
    }
  }

  return { key, load, save };
}

export function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
