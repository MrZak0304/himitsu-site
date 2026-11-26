// ストアの評価ダイアログ(マーケ施策・2026-10-21 PD 承認)を呼ぶかの判定。ピュア。
// 記録した日(本文・タグ・写真のどれかがある日)が 7 日に達し、きょうの記録がある保存の直後に 1 回だけ。
// すでに 7 日を超えている既存の利用者も、更新後に初めてきょうの記録を保存したときに 1 回だけ呼ぶ。

import { hasEntryContent } from './calendar.js';

export const REVIEW_MIN_DAYS = 7;

// entriesMap: {日付キー: entry}。today: 今日の日付キー。requested: すでに呼んだか(端末に記録した値)
export function shouldRequestReview({ entriesMap, today, requested }) {
  if (requested) return false;
  if (!hasEntryContent(entriesMap?.[today])) return false;
  let days = 0;
  for (const e of Object.values(entriesMap ?? {})) {
    if (hasEntryContent(e)) days += 1;
    if (days >= REVIEW_MIN_DAYS) return true;
  }
  return false;
}
