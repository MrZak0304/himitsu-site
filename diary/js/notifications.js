// リマインダー通知の窓口(@capacitor/local-notifications)。ネイティブのみ実動作、Webは保存のみ(no-op)。
// exact alarm は要求しない(プラグイン既定精度の毎日通知で十分。プランU5)。

import { parseReminderTime, REMINDER_ID, REMINDER_TITLE, REMINDER_BODY } from './core/reminder.js';
import { MONTHLY_ID, MONTHLY_HOUR, MONTHLY_TITLE } from './core/monthly-summary.js';
import { buildPlanReminders, planReminderTitle, planReminderBody, isPlanReminderId } from './core/plan-reminders.js';
import { tr } from './i18n/index.js';

export const PERMISSION_DENIED_MESSAGE =
  tr('通知が許可されていません。端末の設定からこのアプリの通知を許可すると、リマインダーが届きます(設定した時刻は保存されています)。');

function plugin() {
  if (!window.Capacitor?.isNativePlatform?.()) return null;
  return window.Capacitor.Plugins?.LocalNotifications ?? null;
}

// settings.reminder({enabled, time})に合わせて通知スケジュールを同期する。
// 戻り値: {ok, reason?}。Webでは常に {ok:true}(保存のみ)。
export async function syncReminder(reminder) {
  const ln = plugin();
  if (!ln) return { ok: true };
  try {
    await ln.cancel({ notifications: [{ id: REMINDER_ID }] }).catch(() => {});
    if (!reminder?.enabled) return { ok: true };
    const perm = await ln.requestPermissions();
    if (perm?.display !== 'granted') return { ok: false, reason: PERMISSION_DENIED_MESSAGE };
    const { hour, minute } = parseReminderTime(reminder.time);
    await ln.schedule({
      notifications: [
        {
          id: REMINDER_ID,
          title: REMINDER_TITLE,
          body: REMINDER_BODY,
          schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
        },
      ],
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: tr('通知の設定に失敗しました。時刻は保存されています。') };
  }
}

// 月のまとめ通知(v1.1): 毎月1日 9:00 に前月のまとめを届ける。文面は呼び出し側が
// 起動時に前月データから作る(通知内でアプリのデータは読めないため)。
// 権限が無ければ静かに諦める(設定画面のトグル時だけ理由を返す)。
export async function syncMonthlySummary(enabled, body, { requestPermission = false } = {}) {
  const ln = plugin();
  if (!ln) return { ok: true };
  try {
    await ln.cancel({ notifications: [{ id: MONTHLY_ID }] }).catch(() => {});
    if (!enabled) return { ok: true };
    const perm = requestPermission ? await ln.requestPermissions() : await ln.checkPermissions();
    if (perm?.display !== 'granted') return { ok: false, reason: PERMISSION_DENIED_MESSAGE };
    await ln.schedule({
      notifications: [
        {
          id: MONTHLY_ID,
          title: MONTHLY_TITLE,
          body,
          extra: { kind: 'monthly-summary' },
          schedule: { on: { day: 1, hour: MONTHLY_HOUR, minute: 0 }, repeats: true, allowWhileIdle: true },
        },
      ],
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: tr('通知の設定に失敗しました。') };
  }
}

// 予定のお知らせ(v1.16): { [date]: plans[] } から、お知らせ付きの予定を「日付+時刻」ごとに 1 通にまとめて予約し直す。
// 消すのは予約中(getPending)の範囲内の ID だけ。Android の cancel は表示中の通知まで消す
// (LocalNotificationManager.cancel → dismissVisibleNotification)ので、届いた通知をアプリに戻っただけで消さない。
// Android の schedule も同じ ID の表示中の通知を消すので、届いて表示中(getDeliveredNotifications)の ID は使わない。
// 許可は求めない(求めるのは予定ダイアログでオンにしたときだけ=requestNotificationPermission)
export async function syncPlanReminders(plansByDate) {
  const ln = plugin();
  if (!ln) return { ok: true };
  try {
    const pending = await ln.getPending().catch(() => ({ notifications: [] }));
    const ours = (pending?.notifications ?? []).map((n) => Number(n.id)).filter(isPlanReminderId);
    if (ours.length > 0) await ln.cancel({ notifications: ours.map((id) => ({ id })) }).catch(() => {});
    const perm = await ln.checkPermissions();
    if (perm?.display !== 'granted') return { ok: false, reason: PERMISSION_DENIED_MESSAGE };
    const delivered = await (ln.getDeliveredNotifications?.() ?? Promise.resolve({ notifications: [] })).catch(() => ({ notifications: [] }));
    const skipIds = (delivered?.notifications ?? []).map((n) => Number(n.id)).filter(isPlanReminderId);
    const list = buildPlanReminders(plansByDate, new Date(), { skipIds }); // 「いま」は予約の直前に取る(iOS は過ぎた at を即時に出す)
    if (list.length === 0) return { ok: true };
    await ln.schedule({
      notifications: list.map((r) => ({
        id: r.id,
        title: planReminderTitle(),
        body: planReminderBody(r.plans),
        extra: { kind: 'plan', date: r.date },
        schedule: { at: r.at, allowWhileIdle: true },
      })),
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: tr('通知の設定に失敗しました。') };
  }
}

// 通知の許可を求める(予定ダイアログでお知らせをオンにしたとき)。Web では常に { ok: true, web: true }
export async function requestNotificationPermission() {
  const ln = plugin();
  if (!ln) return { ok: true, web: true };
  try {
    const perm = await ln.requestPermissions();
    return perm?.display === 'granted' ? { ok: true } : { ok: false, reason: PLAN_PERMISSION_DENIED_MESSAGE };
  } catch {
    return { ok: false, reason: PLAN_PERMISSION_DENIED_MESSAGE };
  }
}

export const PLAN_PERMISSION_DENIED_MESSAGE =
  tr('通知が許可されていません。端末の設定からこのアプリの通知を許可すると、予定のお知らせが届きます。');

// 通知タップ時の遷移。月のまとめ→ふりかえり(前月)。リマインダー・予定のお知らせ→きょう。
export function onNotificationTap(handler) {
  const ln = plugin();
  if (!ln?.addListener) return;
  ln.addListener('localNotificationActionPerformed', (ev) => {
    const kind = ev?.notification?.extra?.kind;
    handler(kind === 'monthly-summary' ? 'monthly-summary' : kind === 'plan' ? 'plan' : 'reminder');
  });
}
