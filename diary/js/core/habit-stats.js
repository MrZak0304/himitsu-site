// 日課の集計(ピュア)。ふりかえりで「この月に各日課を何日達成したか」を出す(達成感の可視化)。
// 2026-08-14 PD要望。月間タグランキング(tag-stats.js)と同じ発想の日課版。

import { isValidKey, monthOfKey } from './dates.js';

// habitLogsMap: {日付キー: {habitId: true}}。habits: [{id, name, ...}](現在の日課)。
// 指定月に各日課を達成した日数を、habits の並び順で返す [{id, name, count}]。
// 現存する日課のみ対象(削除済みの日課は出さない)。達成0日も並べる(一覧としての安定と比較のため)。
export function monthlyHabitCounts(habitLogsMap, habits, year, month) {
  const count = new Map();
  for (const [date, day] of Object.entries(habitLogsMap ?? {})) {
    if (!isValidKey(date)) continue;
    const mo = monthOfKey(date);
    if (mo.year !== year || mo.month !== month) continue;
    for (const [hid, done] of Object.entries(day ?? {})) {
      if (done === true) count.set(hid, (count.get(hid) ?? 0) + 1);
    }
  }
  return (habits ?? []).map((h) => ({ id: h.id, name: h.name, count: count.get(h.id) ?? 0 }));
}
