// 予定のお知らせ(v1.16・SPEC §2.7)。ピュア関数。
// 予定ごとに「お知らせ」をオンにでき、その予定の通知の時刻 remindAt('HH:MM')に通知を届ける(2026-11-01 PD 回答)。
// remindAt は通知のためだけの時刻で、予定の出来事の時刻ではない(カレンダー・きょうの帯には出さない=PD 2026-10-31)。
// 同じ日・同じ時刻の予定は 1 通にまとめ、違う時刻はそれぞれ届く。

import { tr } from '../i18n/index.js';
import { todayKey } from './dates.js';
import { isEmojiGrapheme, normalizeRemindAt } from './plans.js';

export { normalizeRemindAt };

export const PLAN_REMINDER_DEFAULT_TIME = '08:00'; // 設定「予定のお知らせの時刻」の既定(新しくオンにするときの初期値)
export const PLAN_REMINDER_ID_BASE = 1000; // 通知の ID の範囲の先頭(日記のリマインダー 1・月のまとめと重ならない)
export const PLAN_REMINDER_ID_SPAN = 100; // ID の範囲は 1000〜1099。届いて表示中の通知の ID を避けて振るので、予約の上限より広く取る
export const PLAN_REMINDER_MAX = 40; // 予約する数の上限(iOS は予約が 64 件まで)
export const PLAN_REMINDER_MARGIN_MS = 5 * 1000; // いまから 5 秒以内は予約しない(iOS は過ぎた at を即時に出してしまう)

// 'YYYY-MM-DD' と 'HH:MM' から、端末の時刻帯のその日その時刻の Date
export function localDateAt(dateKey, time) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

// 予約するお知らせの一覧。{ [date]: plans[] } と「いま」から、「日付+時刻」ごとにまとめ、近い順に上限まで。
// ID は範囲の中で skipIds(届いて表示中の通知)を避けて振る。Android の schedule は同じ ID の表示中の通知を消すため
// 戻り値: [{ id, at, date, time, plans }]
export function buildPlanReminders(plansByDate, now = new Date(), { skipIds = [] } = {}) {
  const groups = new Map();
  for (const [date, list] of Object.entries(plansByDate ?? {})) {
    for (const plan of list ?? []) {
      const time = normalizeRemindAt(plan?.remindAt);
      if (!time) continue;
      const at = localDateAt(date, time);
      if (Number.isNaN(at.getTime()) || at.getTime() - now.getTime() < PLAN_REMINDER_MARGIN_MS) continue;
      const key = `${date} ${time}`;
      if (!groups.has(key)) groups.set(key, { at, date, time, plans: [] });
      groups.get(key).plans.push(plan);
    }
  }
  const skip = new Set(skipIds.map(Number));
  const ids = [];
  for (let id = PLAN_REMINDER_ID_BASE; id < PLAN_REMINDER_ID_BASE + PLAN_REMINDER_ID_SPAN && ids.length < PLAN_REMINDER_MAX; id++) {
    if (!skip.has(id)) ids.push(id);
  }
  return [...groups.values()]
    .sort((a, b) => a.at - b.at)
    .slice(0, ids.length)
    .map((g, i) => ({ id: ids[i], ...g }));
}

export function isPlanReminderId(id) {
  const n = Number(id);
  return n >= PLAN_REMINDER_ID_BASE && n < PLAN_REMINDER_ID_BASE + PLAN_REMINDER_ID_SPAN;
}

// 1 件分の文字。絵文字+タイトル。頭文字の印(絵文字でない)はタイトルだけ、タイトルが空なら絵文字だけ
export function planReminderLine(plan) {
  const emoji = plan?.emoji ?? '';
  const title = plan?.title ?? '';
  if (!isEmojiGrapheme(emoji)) return title || emoji;
  return `${emoji}${title}`;
}

export function planReminderTitle() {
  return tr('きょうの予定');
}

export function planReminderBody(plans) {
  return (plans ?? []).map(planReminderLine).join(tr('・'));
}

// オンにしたときの時刻の初期値。設定の時刻(不正なら 8:00)。その予定がきょうで設定の時刻がもう過ぎていれば次の正時。
// 次の正時が翌日になる(23 時台)ときは設定の時刻のまま(保存で「過ぎています」と知らせる)
export function defaultRemindTime(dateKey, settingTime, now = new Date()) {
  const base = normalizeRemindAt(settingTime) ?? PLAN_REMINDER_DEFAULT_TIME;
  if (dateKey !== todayKey(now) || localDateAt(dateKey, base) > now) return base;
  const next = now.getHours() + 1;
  return next <= 23 ? `${String(next).padStart(2, '0')}:00` : base;
}

// 保存を止めるか: 時刻を新しく選んだ・変えたときで、その日その時刻がもう過ぎている。
// 予約しない「いまから 5 秒以内」も止める(保存できたのに届かない、を作らない。Android エミュレーターの確認で見つけた)。
// 前から付いていた時刻をそのまま保存し直すときは止めない(タイトルだけ直したいときに困らないように)
export function isPastRemind({ date, remindAt, prevRemindAt = null, now = new Date() }) {
  const time = normalizeRemindAt(remindAt);
  if (!time || time === prevRemindAt) return false;
  return localDateAt(date, time).getTime() - now.getTime() < PLAN_REMINDER_MARGIN_MS;
}
