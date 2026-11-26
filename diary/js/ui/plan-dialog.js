// 予定の追加・編集ダイアログ(v1.06)。きょう画面(日付を選べる)とふりかえりの日別詳細(日付固定)から開く。
// 2 行: 日にち / タイトル+「🎉▾」(2026-10-30 開発リード FB: 新しいタグの入力と同じ動き。それまでは絵文字の欄+「えらぶ」のドロップダウン)。
// 「🎉▾」で選んだ絵文字はタイトル欄の先頭に入る。キーボードで先頭に打った絵文字も同じ。保存のときに先頭の絵文字を予定の絵文字として取り出す。
// 絵文字が無ければタイトルの頭文字を印にする(2026-10-31 PD FB)
// 3 行目「🔔 お知らせ」(v1.16): オンにすると時刻を選べ、その時刻に通知が届く。初期値・過ぎた時刻の判定は core/plan-reminders.js

import { PLAN_TITLE_MAX, planFromInput, planInputText, putLeadingEmoji, MESSAGES } from '../core/plans.js';
import { defaultRemindTime, isPastRemind, normalizeRemindAt } from '../core/plan-reminders.js';
import { requestNotificationPermission } from '../notifications.js';
import { tr } from '../i18n/index.js';

export function createPlanDialog(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    root: $('plan-dialog'),
    title: $('plan-dialog-title'),
    dateRow: $('plan-date-row'),
    date: $('plan-date'),
    emojiPick: $('plan-emoji-pick'),
    text: $('plan-title'),
    remind: $('plan-remind'),
    remindTime: $('plan-remind-time'),
    remindWebNote: $('plan-remind-web-note'),
    note: $('plan-note'),
    save: $('plan-save'),
    remove: $('plan-delete'),
    cancel: $('plan-cancel'),
  };
  // state: { date, plan(編集中なら既存の予定), pickDate, minDate, resolve }
  let state = null;

  function note(message) {
    els.note.hidden = !message;
    els.note.textContent = message ?? '';
  }

  const isNative = () => !!window.Capacitor?.isNativePlatform?.();

  function showRemind(on) {
    els.remindTime.hidden = !on;
    els.remindWebNote.hidden = !on || isNative(); // Web は保存だけで、通知はアプリで届く
  }

  function currentDate() {
    return state?.pickDate ? els.date.value : state?.date;
  }

  function finish(result) {
    const r = state?.resolve;
    state = null;
    els.root.hidden = true;
    r?.(result);
  }

  // open({ date, plan, pickDate, minDate }) → Promise<{ saved: boolean, removed: boolean }>
  function open({ date, plan = null, pickDate = false, minDate = null }) {
    return new Promise((resolve) => {
      state = { date, plan, pickDate, minDate, resolve };
      els.title.textContent = plan ? tr('予定を編集') : tr('予定を追加');
      els.dateRow.hidden = !pickDate;
      els.date.value = date;
      els.date.min = minDate ?? '';
      els.text.value = plan ? planInputText(plan) : ''; // 編集は絵文字を先頭に戻して出す(頭文字の印ならタイトルだけ)
      els.text.maxLength = PLAN_TITLE_MAX + 11; // 先頭の絵文字のぶん(結合絵文字は UTF-16 で 11 まで)。タイトルは保存のときに 20 文字で切る
      els.remove.hidden = !plan;
      els.remind.checked = !!plan?.remindAt;
      els.remindTime.value = plan?.remindAt ?? '';
      showRemind(els.remind.checked);
      note(null);
      els.root.hidden = false;
    });
  }

  els.emojiPick.onclick = async () => {
    if (!state) return;
    const emoji = await ctx.emojiPicker.pick(); // 予定のダイアログの上に重なって開く。やめたら null
    if (!emoji || !state) return;
    const r = putLeadingEmoji(els.text.value, emoji, els.text.maxLength);
    if (!r) return;
    els.text.value = r.value;
    try {
      els.text.setSelectionRange(r.caret, r.caret); // 続けてタイトルを打てるように、絵文字のうしろへ
    } catch {
      // setSelectionRange が使えない入力欄では何もしない
    }
    note(null);
  };

  // オンにしたら時刻の初期値(設定の時刻。きょうで過ぎていれば次の正時)を入れ、通知の許可を求める。断られても保存はできる
  els.remind.onchange = async () => {
    if (!state) return;
    const on = els.remind.checked;
    showRemind(on);
    note(null);
    if (!on) return;
    if (!els.remindTime.value) {
      const s = await ctx.stores.settings.get();
      els.remindTime.value = defaultRemindTime(currentDate(), s?.planReminder?.time, new Date());
    }
    const r = await requestNotificationPermission();
    if (state && els.remind.checked && !r.ok) note(r.reason);
  };
  els.remindTime.onchange = () => note(null);

  els.save.onclick = async () => {
    if (!state) return;
    const date = state.pickDate ? els.date.value : state.date;
    // タイトル欄の先頭の絵文字が予定の絵文字(「🎂母の誕生日」→ 🎂 と「母の誕生日」)。絵文字が無ければ頭文字(「誕生日」→ 誕)
    const { emoji, title } = planFromInput(els.text.value);
    if (!emoji) {
      note(MESSAGES.noEmoji);
      return;
    }
    if (state.pickDate && state.minDate && date < state.minDate) {
      note(MESSAGES.pastDate);
      return;
    }
    const remindAt = els.remind.checked ? normalizeRemindAt(els.remindTime.value) : null;
    if (els.remind.checked && !remindAt) {
      note(tr('お知らせの時刻を選んでください。'));
      els.remindTime.focus();
      return;
    }
    if (isPastRemind({ date, remindAt, prevRemindAt: state.plan?.remindAt ?? null, now: new Date() })) {
      note(tr('その時刻はもう過ぎています。'));
      els.remindTime.focus();
      return;
    }
    try {
      if (state.plan) {
        await ctx.stores.plans.update(state.date, state.plan.id, { emoji, title, remindAt });
      } else {
        await ctx.stores.plans.add(date, { emoji, title, remindAt });
      }
    } catch (err) {
      note(err?.message ?? tr('予定を保存できませんでした。'));
      return;
    }
    ctx.notifySaved?.({ diary: false }); // 予定は日記の記録ではない(評価ダイアログの判定に数えない)
    ctx.syncPlanReminders?.(); // お知らせを予約し直す(オフにした・消した分も外れる)
    finish({ saved: true, removed: false, date });
  };

  els.remove.onclick = async () => {
    if (!state?.plan) return;
    if (!(await ctx.confirm(tr('この予定を消しますか?')))) return;
    await ctx.stores.plans.remove(state.date, state.plan.id);
    ctx.syncPlanReminders?.();
    finish({ saved: false, removed: true, date: state.date });
  };

  els.cancel.onclick = () => finish({ saved: false, removed: false });

  return {
    open,
    close: () => {
      ctx.emojiPicker?.close(); // 絵文字のポップアップが重なっていれば一緒に閉じる
      finish({ saved: false, removed: false });
    },
  };
}

// 予定の一覧を描く共通部(きょう画面・日別詳細)。onTap(plan) で編集に入る。dateLabel を渡すと日付を添える
export function renderPlanList(container, plans, { onTap, dateLabel = null } = {}) {
  container.replaceChildren(
    ...plans.map((p) => {
      const li = document.createElement('li');
      li.className = 'plan-item';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'plan-btn';
      b.dataset.planId = p.id;
      const em = document.createElement('span');
      em.className = 'plan-emoji';
      em.textContent = p.emoji;
      const t = document.createElement('span');
      t.className = 'plan-title';
      t.textContent = p.title || '';
      b.append(em, t);
      if (p.remindAt) {
        // お知らせ付きの印。時刻は出さない(予定の時刻に見えないように=PD 2026-10-31)
        const bell = document.createElement('span');
        bell.className = 'plan-bell';
        bell.textContent = '🔔';
        bell.setAttribute('role', 'img');
        bell.setAttribute('aria-label', tr('お知らせあり'));
        b.append(bell);
      }
      if (dateLabel) {
        const d = document.createElement('span');
        d.className = 'plan-date';
        d.textContent = dateLabel(p);
        b.append(d);
      }
      if (onTap) b.onclick = () => onTap(p);
      li.append(b);
      return li;
    }),
  );
  container.hidden = plans.length === 0;
}
