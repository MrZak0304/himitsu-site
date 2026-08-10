// リマインダー通知の窓口(@capacitor/local-notifications)。ネイティブのみ実動作、Webは保存のみ(no-op)。
// exact alarm は要求しない(プラグイン既定精度の毎日通知で十分。プランU5)。

import { parseReminderTime, REMINDER_ID, REMINDER_TITLE, REMINDER_BODY } from './core/reminder.js';

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
