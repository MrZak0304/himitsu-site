// リマインダー通知の窓口(@capacitor/local-notifications)。ネイティブのみ実動作、Webは保存のみ(no-op)。
// exact alarm は要求しない(プラグイン既定精度の毎日通知で十分。プランU5)。

import { parseReminderTime, REMINDER_ID, REMINDER_TITLE, REMINDER_BODY } from './core/reminder.js';
import { MONTHLY_ID, MONTHLY_HOUR, MONTHLY_TITLE } from './core/monthly-summary.js';

export const PERMISSION_DENIED_MESSAGE =
  '通知が許可されていません。端末の設定からこのアプリの通知を許可すると、リマインダーが届きます(設定した時刻は保存されています)。';

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
    return { ok: false, reason: '通知の設定に失敗しました。時刻は保存されています。' };
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
    return { ok: false, reason: '通知の設定に失敗しました。' };
  }
}

// 通知タップ時の遷移。月のまとめ→ふりかえり(前月)。リマインダー→きょう。
export function onNotificationTap(handler) {
  const ln = plugin();
  if (!ln?.addListener) return;
  ln.addListener('localNotificationActionPerformed', (ev) => {
    const kind = ev?.notification?.extra?.kind;
    handler(kind === 'monthly-summary' ? 'monthly-summary' : 'reminder');
  });
}
