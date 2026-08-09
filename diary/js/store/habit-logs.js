// 日課チェックのログ。形は {日付キー: {habitId: true}}。
// 日付+habitId の複合キーで上書き(同じ日に何度チェックし直しても1件)。

import { isValidKey } from '../core/dates.js';
import { createKvStore } from './kv.js';

const KEY = 'diary-habitlogs-v1';

function normalizeAll(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out = {};
  for (const [date, checks] of Object.entries(raw)) {
    if (!isValidKey(date)) continue;
    if (typeof checks !== 'object' || checks === null || Array.isArray(checks)) continue;
    const day = {};
    for (const [habitId, checked] of Object.entries(checks)) {
      if (checked === true) day[habitId] = true;
    }
    if (Object.keys(day).length > 0) out[date] = day;
  }
  return out;
}

export function createHabitLogsStore(storage) {
  const kv = createKvStore({ key: KEY, fallback: {}, normalize: normalizeAll, storage });

  return {
    async forDate(date) {
      return kv.load()[date] ?? {};
    },
    async setChecked(date, habitId, checked) {
      const map = kv.load();
      const day = map[date] ?? {};
      if (checked) {
        day[habitId] = true;
        map[date] = day;
      } else {
        delete day[habitId];
        if (Object.keys(day).length === 0) delete map[date];
        else map[date] = day;
      }
      kv.save(map);
    },
    // habitId の達成日集合(連続日数計算用)
    async checkedDates(habitId) {
      const set = new Set();
      for (const [date, day] of Object.entries(kv.load())) {
        if (day[habitId] === true) set.add(date);
      }
      return set;
    },
    async all() {
      return kv.load();
    },
    async replaceAll(map) {
      kv.save(normalizeAll(map));
    },
  };
}
