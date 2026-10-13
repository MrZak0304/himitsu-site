// 予定のストア(v1.06)。形は { [date]: [{ id, emoji, title, createdAt }] }。
// 記録(entries)とは別キーに置き、記録の統計(連続記録・月のまとめ)に混ざらないようにする。
// 日記データは端末内にのみ保存し、外部送信しない(不変条件 1)。バックアップは v4 で plans を含む。

import { createKvStore, makeId } from './kv.js';
import { isValidKey } from '../core/dates.js';
import { normalizeDayPlans, normalizeEmoji, normalizeTitle, canAddPlan, MESSAGES } from '../core/plans.js';

const KEY = 'diary-plans-v1';

function normalizeAll(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out = {};
  for (const [date, list] of Object.entries(raw)) {
    if (!isValidKey(date)) continue;
    const plans = normalizeDayPlans(list);
    if (plans.length > 0) out[date] = plans;
  }
  return out;
}

function fail(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

export function createPlansStore(storage) {
  const kv = createKvStore({ key: KEY, fallback: {}, normalize: normalizeAll, storage });

  function persist(map) {
    kv.save(normalizeAll(map));
  }

  return {
    async all() {
      return kv.load();
    },
    async forDate(date) {
      return kv.load()[date] ?? [];
    },
    // 追加。絵文字が無い・日付が不正・上限は日本語エラー
    async add(date, { emoji, title = '' }) {
      if (!isValidKey(date)) throw fail(MESSAGES.badDate, 'bad-date');
      const em = normalizeEmoji(emoji);
      if (!em) throw fail(MESSAGES.noEmoji, 'no-emoji');
      const map = kv.load();
      const list = map[date] ?? [];
      if (!canAddPlan(list)) throw fail(MESSAGES.tooMany, 'too-many');
      const plan = { id: makeId('p'), emoji: em, title: normalizeTitle(title), createdAt: Date.now() };
      map[date] = [...list, plan];
      persist(map);
      return plan;
    },
    async update(date, id, { emoji, title }) {
      const map = kv.load();
      const list = map[date] ?? [];
      const plan = list.find((p) => p.id === id);
      if (!plan) return null;
      if (emoji !== undefined) {
        const em = normalizeEmoji(emoji);
        if (!em) throw fail(MESSAGES.noEmoji, 'no-emoji');
        plan.emoji = em;
      }
      if (title !== undefined) plan.title = normalizeTitle(title);
      persist(map);
      return plan;
    },
    async remove(date, id) {
      const map = kv.load();
      if (!map[date]) return;
      map[date] = map[date].filter((p) => p.id !== id);
      persist(map);
    },
    async replaceAll(map) {
      kv.save(normalizeAll(map));
    },
  };
}
