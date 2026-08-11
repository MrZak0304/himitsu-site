// タグストア。定番タグ(builtin)を初回に同梱し、ユーザーが自由に追加できる。
// 枠制限の判定は core/tag-slots.js が担当し、ここでは数の管理のみ行う。

import { createKvStore, makeId } from './kv.js';

const KEY = 'diary-tags-v1';

// 定番タグ初期セット案(SPEC §9-2 の初稿。PD確認で差し替え可能)
export const DEFAULT_TAGS = [
  '#最高の一日',
  '#がんばった',
  '#おつかれ',
  '#まったり',
  '#たのしかった',
  '#しんどかった',
  '#おでかけ',
  '#おうち時間',
  '#いいことあった',
  '#ふつうの日',
];

export const DUPLICATE_MESSAGE = '同じ名前のタグがすでにあります。';
export const IN_USE_MESSAGE = 'このタグは過去の記録で使われているため削除できません。';

function normalizeTag(raw, i) {
  if (typeof raw !== 'object' || raw === null) return null;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || raw.name === '') return null;
  return {
    id: raw.id,
    name: raw.name,
    builtin: raw.builtin === true,
    // hidden: 入力候補・頻出表示から外すが、過去の記録のスタンプは残す(記録を変えない)
    hidden: raw.hidden === true,
    // folderId: タグ整理用フォルダの参照。未設定・不正値は null(未分類)
    folderId: typeof raw.folderId === 'string' ? raw.folderId : null,
    order: Number.isInteger(raw.order) ? raw.order : i,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
  };
}

function normalizeAll(raw, { fresh } = {}) {
  if (!Array.isArray(raw)) raw = [];
  let list = raw.map(normalizeTag).filter(Boolean);
  // ストレージにキーが無い初回のみ定番タグを同梱投入(取り込み置き換え後は再投入しない)
  if (fresh && list.length === 0) {
    list = DEFAULT_TAGS.map((name, i) => ({
      id: `b${i + 1}`,
      name,
      builtin: true,
      order: i,
      createdAt: Date.now(),
    }));
  }
  list.sort((a, b) => a.order - b.order);
  return list;
}

export function createTagsStore(storage) {
  const kv = createKvStore({ key: KEY, fallback: [], normalize: normalizeAll, storage });

  function persist(list) {
    list.forEach((t, i) => {
      t.order = i;
    });
    kv.save(list);
    return list;
  }

  return {
    // opts.includeHidden=false(既定)なら hidden タグを除く(入力候補・頻出向け)。
    // 管理画面は全件を扱うため includeHidden:true を渡す。
    async list({ includeHidden = true } = {}) {
      const all = kv.load();
      return includeHidden ? all : all.filter((t) => !t.hidden);
    },
    async userTagCount() {
      return kv.load().filter((t) => !t.builtin).length;
    },
    async add(name) {
      const list = kv.load();
      if (list.some((t) => t.name === name)) {
        const e = new Error(DUPLICATE_MESSAGE);
        e.code = 'duplicate';
        throw e;
      }
      const tag = {
        id: makeId('t'),
        name,
        builtin: false,
        hidden: false,
        folderId: null,
        order: list.length,
        createdAt: Date.now(),
      };
      persist([...list, tag]);
      return tag;
    },
    async rename(id, name) {
      const list = kv.load();
      if (list.some((t) => t.name === name && t.id !== id)) {
        const e = new Error(DUPLICATE_MESSAGE);
        e.code = 'duplicate';
        throw e;
      }
      const tag = list.find((t) => t.id === id);
      if (tag) {
        tag.name = name;
        persist(list);
      }
      return tag ?? null;
    },
    // usedIds: 過去の記録で使用中のタグID集合。使用中は削除不可(日本語エラー)。
    // 使用中タグの整理は setHidden(隠す)/ forceRemove(警告つき完全削除)で行う(U4)。
    async remove(id, usedIds = new Set()) {
      if (usedIds.has(id)) {
        const e = new Error(IN_USE_MESSAGE);
        e.code = 'in-use';
        throw e;
      }
      persist(kv.load().filter((t) => t.id !== id));
    },
    // 使用中でも消せる完全削除。過去の記録からのタグ除去は呼び出し側(entries)が担う。
    async forceRemove(id) {
      persist(kv.load().filter((t) => t.id !== id));
    },
    // 一覧から隠す/戻す。過去の記録のスタンプは変えない(C案の既定動作)。
    async setHidden(id, hidden) {
      const list = kv.load();
      const tag = list.find((t) => t.id === id);
      if (tag) {
        tag.hidden = hidden === true;
        persist(list);
      }
      return tag ?? null;
    },
    // タグをフォルダへ割り当てる(null で未分類に戻す)。
    async setFolder(id, folderId) {
      const list = kv.load();
      const tag = list.find((t) => t.id === id);
      if (tag) {
        tag.folderId = typeof folderId === 'string' ? folderId : null;
        persist(list);
      }
      return tag ?? null;
    },
    // 指定フォルダに属す全タグを未分類へ戻す(フォルダ削除時に使う)。
    async clearFolder(folderId) {
      const list = kv.load();
      let changed = false;
      for (const t of list) {
        if (t.folderId === folderId) {
          t.folderId = null;
          changed = true;
        }
      }
      if (changed) persist(list);
      return list;
    },
    async reorder(ids) {
      const list = kv.load();
      const byId = new Map(list.map((t) => [t.id, t]));
      const next = ids.map((id) => byId.get(id)).filter(Boolean);
      for (const t of list) if (!ids.includes(t.id)) next.push(t);
      return persist(next);
    },
    async replaceAll(list) {
      kv.save(normalizeAll(list, { fresh: false }));
    },
  };
}
