// タグ整理用フォルダの軽量ストア(U1/KTD3)。形は [{id, name, order}]。
// タグ側は folderId でフォルダを参照し、未設定=未分類。無料版でも使える。
// フォルダを消してもタグは消えない(呼び出し側が tags.clearFolder で未分類へ戻す)。

import { createKvStore, makeId } from './kv.js';

const KEY = 'diary-tag-folders-v1';

export const DUPLICATE_MESSAGE = '同じ名前のフォルダがすでにあります。';

function normalizeFolder(raw, i) {
  if (typeof raw !== 'object' || raw === null) return null;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || raw.name === '') return null;
  return {
    id: raw.id,
    name: raw.name,
    order: Number.isInteger(raw.order) ? raw.order : i,
  };
}

function normalizeAll(raw) {
  if (!Array.isArray(raw)) raw = [];
  const list = raw.map(normalizeFolder).filter(Boolean);
  list.sort((a, b) => a.order - b.order);
  return list;
}

export function createTagFoldersStore(storage) {
  const kv = createKvStore({ key: KEY, fallback: [], normalize: normalizeAll, storage });

  function persist(list) {
    list.forEach((f, i) => {
      f.order = i;
    });
    kv.save(list);
    return list;
  }

  return {
    async list() {
      return kv.load();
    },
    async add(name) {
      const list = kv.load();
      if (list.some((f) => f.name === name)) {
        const e = new Error(DUPLICATE_MESSAGE);
        e.code = 'duplicate';
        throw e;
      }
      const folder = { id: makeId('f'), name, order: list.length };
      persist([...list, folder]);
      return folder;
    },
    async rename(id, name) {
      const list = kv.load();
      if (list.some((f) => f.name === name && f.id !== id)) {
        const e = new Error(DUPLICATE_MESSAGE);
        e.code = 'duplicate';
        throw e;
      }
      const folder = list.find((f) => f.id === id);
      if (folder) {
        folder.name = name;
        persist(list);
      }
      return folder ?? null;
    },
    async remove(id) {
      persist(kv.load().filter((f) => f.id !== id));
    },
    async reorder(ids) {
      const list = kv.load();
      const byId = new Map(list.map((f) => [f.id, f]));
      const next = ids.map((id) => byId.get(id)).filter(Boolean);
      for (const f of list) if (!ids.includes(f.id)) next.push(f);
      return persist(next);
    },
    async replaceAll(list) {
      kv.save(normalizeAll(list));
    },
  };
}
