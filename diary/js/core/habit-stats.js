// 日課の集計(ピュア)。ふりかえりで「この月に各日課を何日達成したか」を出す(達成感の可視化)。
// 2026-08-14 PD要望。月間タグランキング(tag-stats.js)と同じ発想の日課版。

import { isValidKey, monthOfKey } from './dates.js';
import { streak } from './streaks.js';
import { tr } from '../i18n/index.js';

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

// ---- 日課の達成スタンプ(v1.09・2026-10-18 PD 依頼「今日の一枚に日課〇日達成スタンプ」)----
// きょうの1枚カードに「運動 連続12日達成」のようなスタンプを貼る。連続か累計かはスタンプごとに選ぶ(PD 回答 2026-10-19)。
// 形はタグ用スタンプと同じ 4 種から選ぶ(PD 追加要望 2026-10-19)。
// 色はタグ用スタンプと同じ定番色+テーマ色+透明から選ぶ。選べるのは買い切り版だけで、広告つき版はテーマ色のまま
// (2026-10-26 PD 回答 A・案1: 広告つき版には色の行を出さない)。

export const HABIT_STAMP_MODES = Object.freeze(['streak', 'total']);
export const DEFAULT_HABIT_STAMP = Object.freeze({ mode: 'streak', shape: 'round', color: 'theme' });

// 日課のスタンプの色を選べるか(買い切り版と Web のデモ。広告つき版は選べない)
export function canPickHabitStampColor(variant) {
  return variant !== 'free';
}

// 描くときの色。選べない版・不正値はテーマ色
export function habitStampColor(color, variant, colorIds) {
  if (!canPickHabitStampColor(variant)) return DEFAULT_HABIT_STAMP.color;
  return (colorIds ?? []).includes(color) ? color : DEFAULT_HABIT_STAMP.color;
}

// checkedDates: その日課を達成した日付キーの Set。dateKey: カードの日。
// streak=その日を終点に続けて達成した日数(その日が未達成なら 0)/ total=その日までに達成した日数の合計
export function habitStampCount(checkedDates, dateKey, mode = 'streak') {
  const set = checkedDates ?? new Set();
  if (!isValidKey(dateKey)) return 0;
  if (mode === 'total') {
    let n = 0;
    for (const d of set) if (isValidKey(d) && d <= dateKey) n += 1;
    return n;
  }
  if (!set.has(dateKey)) return 0;
  return streak(set, dateKey);
}

export function habitStampText(name, count, mode = 'streak') {
  return mode === 'total' ? tr('{0} 累計{1}日達成', name, count) : tr('{0} 連続{1}日達成', name, count);
}

// 前回選んだ連続/累計・形・色(次に貼るときの既定)。不正値は既定に落とす
export function normalizeHabitStampPrefs(raw, shapeIds, colorIds = []) {
  const mode = HABIT_STAMP_MODES.includes(raw?.mode) ? raw.mode : DEFAULT_HABIT_STAMP.mode;
  const shape = (shapeIds ?? []).includes(raw?.shape) ? raw.shape : DEFAULT_HABIT_STAMP.shape;
  const color = (colorIds ?? []).includes(raw?.color) ? raw.color : DEFAULT_HABIT_STAMP.color;
  return { mode, shape, color };
}

// 日課ごとのスタンプの見た目(2026-10-26 PD 回答 Q1「日課ごと」)。日課タブで決め、その見た目でカードに貼る(カード画面では変えない=2026-10-26 PD 実機確認)。
// habit.stamp: { shape, color } | 無し(=カードで前回選んだ形・色)。色は買い切り版だけ意味を持つ(広告つき版はテーマ色で描く)
export function normalizeHabitStamp(raw, shapeIds, colorIds = []) {
  if (typeof raw !== 'object' || raw === null) return null;
  const shape = (shapeIds ?? []).includes(raw.shape) ? raw.shape : DEFAULT_HABIT_STAMP.shape;
  const color = (colorIds ?? []).includes(raw.color) ? raw.color : DEFAULT_HABIT_STAMP.color;
  return { shape, color };
}

// カードに日課のスタンプを貼るときの最初の形・色。日課に設定があればそれ、無ければ前回カードで選んだもの(prefs)
export function initialHabitStamp(habitStamp, prefs) {
  const src = habitStamp ?? prefs ?? DEFAULT_HABIT_STAMP;
  return { shape: src.shape ?? DEFAULT_HABIT_STAMP.shape, color: src.color ?? DEFAULT_HABIT_STAMP.color };
}

// 「日課を追加」で名前を書かなかったときの名前(2026-10-28 開発リードの家族の FB「アイコンを選べば名前は書いても書かなくても追加できるように」)。
// 名前は空にしない(旧版のバックアップ・ストアは名前の空の日課を捨てるため)。アイコン=その名前(例: 運動)/絵文字=その絵文字/画像=fallback
export function defaultHabitName(icon, labels = {}, fallback = '') {
  if (icon?.type === 'builtin') return labels[icon.value] ?? fallback;
  if (icon?.type === 'emoji' && typeof icon.value === 'string' && icon.value !== '') return icon.value;
  return fallback;
}

// 一覧に出す名前。絵文字だけの日課(名前=アイコンの絵文字)は、アイコンと同じ絵文字を 2 つ並べないよう名前を出さない
export function habitNameShown(habit) {
  if (habit?.icon?.type === 'emoji' && habit.name === habit.icon.value) return '';
  return habit?.name ?? '';
}
