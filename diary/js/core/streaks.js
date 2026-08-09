// 連続日数の計算。日記の連続記録日数と、日課ごとの連続達成日数で共用する。

import { prevDayKey } from './dates.js';

// dateSet: 記録(達成)がある日付キーの Set。today: 今日の日付キー。
// 今日が未記録でも「昨日までの連続」を維持して返す(今日はまだ終わっていないため)。
export function streak(dateSet, today) {
  let cur = dateSet.has(today) ? today : prevDayKey(today);
  let n = 0;
  while (dateSet.has(cur)) {
    n += 1;
    cur = prevDayKey(cur);
  }
  return n;
}
