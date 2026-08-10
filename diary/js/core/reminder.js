// リマインダー時刻のピュア変換。'HH:MM' → LocalNotifications の schedule.on 引数。

export function parseReminderTime(time) {
  const m = /^(\d{2}):(\d{2})$/.exec(time ?? '');
  if (!m) return { hour: 21, minute: 0 }; // 既定21:00(SPEC §1)
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return { hour: 21, minute: 0 };
  return { hour, minute };
}

export const REMINDER_ID = 1;
export const REMINDER_TITLE = 'ポンとにっき';
export const REMINDER_BODY = 'きょうの記録をつけましょう!';
