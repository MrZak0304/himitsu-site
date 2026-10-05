// 月のまとめ通知の文面(ピュア)。v1.1 U4。毎月1日に「前月のポンとにっき」を知らせて再訪のきっかけにする。
// 文面に「無料」「暗号化」を使わない。データが無い月は汎用文面にフォールバックする。

import { monthlyTagRanking } from './tag-stats.js';
import { monthlyHabitCounts } from './habit-stats.js';
import { isValidKey, monthOfKey } from './dates.js';

export const MONTHLY_ID = 2; // リマインダー(REMINDER_ID=1)と別の通知ID
export const MONTHLY_HOUR = 9;
export const MONTHLY_TITLE = 'ポンとにっき';
export const MONTHLY_FALLBACK = '先月のふりかえりを開いてみましょう。';

// { year, month } の前月
export function prevMonthOf(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// 月内に記録(タグ・本文・写真のいずれか)がある日数
export function recordedDaysInMonth(entriesMap, year, month) {
  let n = 0;
  for (const [date, e] of Object.entries(entriesMap ?? {})) {
    if (!isValidKey(date)) continue;
    const mo = monthOfKey(date);
    if (mo.year !== year || mo.month !== month) continue;
    if ((e?.tags?.length ?? 0) > 0 || (e?.text ?? '') !== '' || (e?.images?.length ?? 0) > 0) n += 1;
  }
  return n;
}

// 通知本文。例: 「9月は12日記録。いちばん多かったタグは #まったり(8回)。日課は21日達成!」
// tagNameOf: id → 名前(hidden も含めて引ける Map)。habits: 現存する日課。
export function monthlySummaryText({ entriesMap, habitLogsMap, habits, tagNameOf, year, month }) {
  const days = recordedDaysInMonth(entriesMap, year, month);
  const [top] = monthlyTagRanking(entriesMap, year, month, { limit: 1 });
  const habitTotal = monthlyHabitCounts(habitLogsMap, habits, year, month).reduce((a, h) => a + h.count, 0);
  const topName = top ? tagNameOf?.get?.(top.id) : null;
  if (days === 0 && habitTotal === 0) return MONTHLY_FALLBACK;
  const parts = [];
  if (days > 0) parts.push(`${month}月は${days}日記録。`);
  if (top && topName) parts.push(`いちばん多かったタグは ${topName}(${top.count}回)。`);
  if (habitTotal > 0) parts.push(`日課は${habitTotal}日達成!`);
  return parts.join('');
}
