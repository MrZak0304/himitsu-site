// 予定の追加・編集ダイアログ(v1.06)。きょう画面(日付を選べる)とふりかえりの日別詳細(日付固定)から開く。
// 3 行: 日にち / タイトル(任意) / 絵文字(入力欄に 1 文字、または「えらぶ」のドロップダウンで検索して選ぶ)。PD FB 2026-10-13

import { PLAN_TITLE_MAX, normalizeEmoji, searchEmojis, MESSAGES } from '../core/plans.js';

export function createPlanDialog(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    root: $('plan-dialog'),
    title: $('plan-dialog-title'),
    dateRow: $('plan-date-row'),
    date: $('plan-date'),
    emojis: $('plan-emojis'),
    emojiInput: $('plan-emoji-input'),
    emojiPick: $('plan-emoji-pick'),
    emojiPanel: $('plan-emoji-panel'),
    emojiSearch: $('plan-emoji-search'),
    emojiNone: $('plan-emoji-none'),
    text: $('plan-title'),
    note: $('plan-note'),
    save: $('plan-save'),
    remove: $('plan-delete'),
    cancel: $('plan-cancel'),
  };
  // state: { date, plan(編集中なら既存の予定), pickDate, minDate, emoji, resolve }
  let state = null;

  function note(message) {
    els.note.hidden = !message;
    els.note.textContent = message ?? '';
  }

  function setPanel(open) {
    els.emojiPanel.hidden = !open;
    els.emojiPick.setAttribute('aria-expanded', open ? 'true' : 'false');
    els.emojiPick.textContent = open ? 'とじる ▴' : 'えらぶ ▾';
    if (open) {
      els.emojiSearch.value = '';
      renderPalette();
    }
  }

  function renderPalette() {
    const list = state ? searchEmojis(els.emojiSearch.value) : [];
    els.emojiNone.hidden = list.length > 0;
    els.emojis.replaceChildren(
      ...list.map((e) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `emoji-btn${state.emoji === e ? ' on' : ''}`;
        b.dataset.emoji = e;
        b.textContent = e;
        b.setAttribute('aria-label', `絵文字 ${e}`);
        b.onclick = () => {
          state.emoji = e;
          els.emojiInput.value = e;
          note(null);
          setPanel(false); // 選んだら閉じる(ドロップダウン)
        };
        return b;
      }),
    );
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
      state = { date, plan, pickDate, minDate, emoji: plan?.emoji ?? '', resolve };
      els.title.textContent = plan ? '予定を編集' : '予定を追加';
      els.dateRow.hidden = !pickDate;
      els.date.value = date;
      els.date.min = minDate ?? '';
      els.emojiInput.value = state.emoji;
      els.text.value = plan?.title ?? '';
      els.text.maxLength = PLAN_TITLE_MAX;
      els.remove.hidden = !plan;
      note(null);
      setPanel(false);
      els.root.hidden = false;
    });
  }

  els.emojiInput.oninput = () => {
    if (!state) return;
    state.emoji = normalizeEmoji(els.emojiInput.value);
    if (!els.emojiPanel.hidden) renderPalette();
  };

  els.emojiPick.onclick = () => {
    if (!state) return;
    setPanel(els.emojiPanel.hidden);
    if (!els.emojiPanel.hidden) els.emojiSearch.focus();
  };

  els.emojiSearch.oninput = () => {
    if (state) renderPalette();
  };

  els.save.onclick = async () => {
    if (!state) return;
    const date = state.pickDate ? els.date.value : state.date;
    const emoji = normalizeEmoji(els.emojiInput.value) || state.emoji;
    if (!emoji) {
      note(MESSAGES.noEmoji);
      return;
    }
    if (state.pickDate && state.minDate && date < state.minDate) {
      note(MESSAGES.pastDate);
      return;
    }
    try {
      if (state.plan) {
        await ctx.stores.plans.update(state.date, state.plan.id, { emoji, title: els.text.value });
      } else {
        await ctx.stores.plans.add(date, { emoji, title: els.text.value });
      }
    } catch (err) {
      note(err?.message ?? '予定を保存できませんでした。');
      return;
    }
    ctx.notifySaved?.();
    finish({ saved: true, removed: false, date });
  };

  els.remove.onclick = async () => {
    if (!state?.plan) return;
    if (!(await ctx.confirm('この予定を消しますか?'))) return;
    await ctx.stores.plans.remove(state.date, state.plan.id);
    finish({ saved: false, removed: true, date: state.date });
  };

  els.cancel.onclick = () => finish({ saved: false, removed: false });

  return { open, close: () => finish({ saved: false, removed: false }) };
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
