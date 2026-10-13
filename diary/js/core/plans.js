// 予定(v1.06・SPEC §2.7)。手帳のように「その日の印」を絵文字 1 つ+ひとことで入れる。ピュア関数。
// 予定は記録(entries)とは別物: 連続記録・月のまとめ・カード・カレンダーの「記録あり」判定には一切影響しない。
// 形: { [date]: [{ id, emoji, title, createdAt }] }(1 日 PLANS_PER_DAY_MAX 件まで。時刻は持たない=PD 決定 2026-10-12)

export const PLAN_TITLE_MAX = 20; // ひとことの上限(書記素)
export const PLANS_PER_DAY_MAX = 5;

// よく使う絵文字(パレット)。画像・外部フォントは使わない(不変条件 7)
export const PLAN_EMOJI_PRESETS = Object.freeze([
  '🎂', '🍻', '🏥', '✈️', '💼', '🏃', '📚', '🎬', '🎁', '💇', '🦷', '🏠',
  '🛒', '📞', '🎓', '⚽', '🎤', '🍽️', '💊', '🚗', '🌸', '🎄', '🎃', '❤️',
]);

export const MESSAGES = {
  noEmoji: '絵文字を1つえらんでください。',
  tooMany: `予定は1日に${PLANS_PER_DAY_MAX}件までです。`,
  pastDate: '予定は今日以降の日にちに入れられます。',
  badDate: '日にちを選んでください。',
};

// 文字列を書記素(見た目の 1 文字)に分ける。絵文字の結合(👨‍👩‍👧・🇯🇵・❤️ など)を 1 つとして数える
export function graphemes(s) {
  const str = typeof s === 'string' ? s : '';
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(str)].map((x) => x.segment);
  }
  return [...str];
}

// 入力から絵文字 1 つを取り出す(先頭の書記素。空白は除く)。無ければ ''
export function normalizeEmoji(raw) {
  const g = graphemes(typeof raw === 'string' ? raw.trim() : '');
  return g.length > 0 ? g[0] : '';
}

// ひとこと: 前後の空白を除き、PLAN_TITLE_MAX 書記素で切る
export function normalizeTitle(raw) {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return graphemes(s).slice(0, PLAN_TITLE_MAX).join('');
}

// 1 件の正規化。id と絵文字が無ければ捨てる
export function normalizePlan(raw) {
  if (typeof raw !== 'object' || raw === null) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  const emoji = normalizeEmoji(raw.emoji);
  if (!emoji) return null;
  return {
    id: raw.id,
    emoji,
    title: normalizeTitle(raw.title),
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
  };
}

// 1 日分の正規化(壊れた要素を捨て、入れた順に並べ、上限で切る)
export function normalizeDayPlans(raw) {
  const list = (Array.isArray(raw) ? raw : []).map(normalizePlan).filter(Boolean);
  list.sort((a, b) => a.createdAt - b.createdAt);
  return list.slice(0, PLANS_PER_DAY_MAX);
}

export function canAddPlan(dayPlans) {
  return (dayPlans?.length ?? 0) < PLANS_PER_DAY_MAX;
}

// カレンダーのマスに出す絵文字(先頭 max 個)
export function cellEmojis(dayPlans, max = 2) {
  return (dayPlans ?? []).slice(0, max).map((p) => p.emoji);
}

// 今日以降の予定を日付順に平らにする({date, ...plan})。days を指定すると today+days まで
export function upcomingPlans(plansByDate, todayKey, { days = null, limit = null, from = todayKey } = {}) {
  const out = [];
  const keys = Object.keys(plansByDate ?? {}).sort();
  for (const date of keys) {
    if (date < from) continue;
    if (days !== null && daysBetween(todayKey, date) > days) continue;
    for (const p of plansByDate[date] ?? []) out.push({ date, ...p });
  }
  return limit !== null ? out.slice(0, limit) : out;
}

// 2 つの日付キーの日数差(b - a)。ローカル日付の差なので DST の影響を受けない
export function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// 日付の表示(きょう画面の「このあと」用): 「10/15(水)」
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
export function shortDateLabel(dateKey, todayKey = null) {
  if (todayKey && dateKey === todayKey) return 'きょう';
  if (todayKey && daysBetween(todayKey, dateKey) === 1) return 'あした';
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${dow})`;
}
