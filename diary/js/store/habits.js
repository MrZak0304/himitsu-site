// 日課ストア。アイコンは内蔵SVG / 絵文字 / ユーザー画像の3択(SPEC §2.2)。

import { createKvStore, makeId } from './kv.js';
import { normalizeHabitStamp } from '../core/habit-stats.js';
import { STAMP_SHAPES, STAMP_COLORS } from '../core/stamp.js';

const SHAPE_IDS = STAMP_SHAPES.map((sh) => sh.id);
const COLOR_IDS = STAMP_COLORS.map((c) => c.id);

const KEY = 'diary-habits-v1';
const ICON_TYPES = new Set(['builtin', 'emoji', 'image']);

function normalizeHabit(raw, i) {
  if (typeof raw !== 'object' || raw === null) return null;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || raw.name === '') return null;
  const icon = typeof raw.icon === 'object' && raw.icon !== null && ICON_TYPES.has(raw.icon.type)
    ? { type: raw.icon.type, value: String(raw.icon.value ?? '') }
    : { type: 'builtin', value: 'star' };
  const habit = {
    id: raw.id,
    name: raw.name,
    icon,
    order: Number.isInteger(raw.order) ? raw.order : i,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
  };
  // カード用スタンプの見た目(2026-10-26・バックアップ v5)。無い日課(旧データ)は持たない
  const stamp = normalizeHabitStamp(raw.stamp, SHAPE_IDS, COLOR_IDS);
  if (stamp) habit.stamp = stamp;
  return habit;
}

function normalizeAll(raw) {
  if (!Array.isArray(raw)) raw = [];
  const list = raw.map(normalizeHabit).filter(Boolean);
  list.sort((a, b) => a.order - b.order);
  return list;
}

export function createHabitsStore(storage) {
  const kv = createKvStore({ key: KEY, fallback: [], normalize: normalizeAll, storage });

  function persist(list) {
    list.forEach((h, i) => {
      h.order = i;
    });
    kv.save(list);
    return list;
  }

  return {
    async list() {
      return kv.load();
    },
    async add(name, icon, stamp = null) {
      const habit = { id: makeId('h'), name, icon, order: kv.load().length, createdAt: Date.now() };
      const st = normalizeHabitStamp(stamp, SHAPE_IDS, COLOR_IDS);
      if (st) habit.stamp = st;
      persist([...kv.load(), habit]);
      return habit;
    },
    async update(id, patch) {
      const list = kv.load();
      const habit = list.find((h) => h.id === id);
      if (!habit) return null;
      Object.assign(habit, patch, { id: habit.id, createdAt: habit.createdAt });
      persist(list);
      return habit;
    },
    async remove(id) {
      persist(kv.load().filter((h) => h.id !== id));
    },
    async replaceAll(list) {
      kv.save(normalizeAll(list));
    },
  };
}
