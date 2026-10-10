// 記録(entry)ストア。キーは日付(YYYY-MM-DD)。公開APIは async に統一し、
// モバイル化時に SQLite 等へ実装だけ差し替えられるようにする(プランKTD2)。

import { isValidKey } from '../core/dates.js';
import { removeTagFromEntries } from '../core/tags-usage.js';
import { clampSticker } from '../core/card.js';
import { createKvStore, makeId } from './kv.js';

const KEY = 'diary-entries-v1';

// シール配置の正規化(再編集用)。text が無いものは捨て、位置・回転・倍率は core/card の範囲に丸める
function normalizeSticker(raw) {
  if (typeof raw !== 'object' || raw === null || typeof raw.text !== 'string' || raw.text === '') return null;
  const st = clampSticker({ text: raw.text, x: raw.x, y: raw.y, rotate: raw.rotate, orient: raw.orient, scale: raw.scale });
  const out = { text: st.text, x: st.x, y: st.y, rotate: st.rotate, orient: st.orient, scale: st.scale };
  // 画像スタンプ(v1.05)の等倍サイズ。無ければ文字から計算する
  if (Number.isFinite(raw.w) && raw.w > 0 && Number.isFinite(raw.h) && raw.h > 0) {
    out.w = raw.w;
    out.h = raw.h;
  }
  return out;
}

function normalizeCard(raw) {
  if (typeof raw !== 'object' || raw === null) return null;
  if (typeof raw.id !== 'string' || raw.id === '' || typeof raw.imageId !== 'string' || raw.imageId === '') return null;
  return {
    id: raw.id,
    imageId: raw.imageId,
    photoId: typeof raw.photoId === 'string' ? raw.photoId : null, // 元にした写真(無ければ null=写真なし)
    stickers: Array.isArray(raw.stickers) ? raw.stickers.map(normalizeSticker).filter(Boolean) : [],
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
  };
}

function normalizeEntry(raw, date) {
  if (typeof raw !== 'object' || raw === null) raw = {};
  const images = Array.isArray(raw.images) ? raw.images.filter((v) => typeof v === 'string') : [];
  let push = raw.pushImageIndex;
  if (!Number.isInteger(push) || push < 0 || push >= images.length) push = images.length > 0 ? 0 : null;
  // 写真ごとの切り出し範囲(v1.1 カード/一押しサムネイル用)。存在する写真の分だけ残す
  const imageCrops = {};
  if (typeof raw.imageCrops === 'object' && raw.imageCrops !== null) {
    for (const id of images) {
      const c = raw.imageCrops[id];
      if (typeof c === 'object' && c !== null && Number.isFinite(c.cx) && Number.isFinite(c.cy) && Number.isFinite(c.zoom)) {
        imageCrops[id] = { cx: c.cx, cy: c.cy, zoom: c.zoom };
      }
    }
  }
  // 日記内に保存したカード(v1.05): [{id, imageId, stickers, createdAt}]。壊れた要素は捨てる
  const cards = Array.isArray(raw.cards) ? raw.cards.map(normalizeCard).filter(Boolean) : [];
  const earned = Number.isInteger(raw.cardSlotsEarned) && raw.cardSlotsEarned > 0 ? raw.cardSlotsEarned : 0;
  return {
    date,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((v) => typeof v === 'string') : [],
    text: typeof raw.text === 'string' ? raw.text : '',
    images,
    pushImageIndex: push,
    imageCrops,
    cards,
    cardSlotsEarned: earned, // その日に広告で増やしたカード枠(広告つき版のみ意味を持つ)
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
    // --- 日記内に保存したカード(v1.05) ---
    // 追加して保存後のカードを返す。枠の判定(core/card-slots.js)は呼び出し側で済ませておく
    async addCard(date, { imageId, photoId = null, stickers = [] }) {
      const cur = (await this.get(date)) ?? normalizeEntry({}, date);
      const card = normalizeCard({ id: makeId('card'), imageId, photoId, stickers, createdAt: Date.now() });
      await this.upsert(date, { cards: [...cur.cards, card] });
      return card;
    },
    // 作り直し: 画像とシール配置を差し替える(id と作成日時は保つ)。無ければ null
    async updateCard(date, cardId, { imageId, photoId, stickers }) {
      const cur = await this.get(date);
      const card = cur?.cards.find((c) => c.id === cardId);
      if (!card) return null;
      const next = normalizeCard({ ...card, imageId: imageId ?? card.imageId, photoId: photoId === undefined ? card.photoId : photoId, stickers: stickers ?? card.stickers });
      await this.upsert(date, { cards: cur.cards.map((c) => (c.id === cardId ? next : c)) });
      return next;
    },
    // 削除したカードを返す(画像の削除は呼び出し側)。無ければ null
    async removeCard(date, cardId) {
      const cur = await this.get(date);
      const card = cur?.cards.find((c) => c.id === cardId);
      if (!card) return null;
      await this.upsert(date, { cards: cur.cards.filter((c) => c.id !== cardId) });
      return card;
    },
    // リワード広告でその日のカード枠を1つ増やす
    async earnCardSlot(date) {
      const cur = (await this.get(date)) ?? normalizeEntry({}, date);
      return this.upsert(date, { cardSlotsEarned: cur.cardSlotsEarned + 1 });
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
