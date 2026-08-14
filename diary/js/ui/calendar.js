// ふりかえりタブ。月カレンダー(一押しサムネ背景+タグ上位1〜2個)と日別詳細(R8, R9)。
// このタブへの進入ガード(ロック)は app.js 側で行う。

import { buildMonth, prevMonth, nextMonth } from '../core/calendar.js';
import { monthOfKey } from '../core/dates.js';
import { monthlyTagRanking } from '../core/tag-stats.js';
import { monthlyHabitCounts } from '../core/habit-stats.js';
import { createDayEditor } from './day-editor.js';

export function initCalendar(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    title: $('cal-title'),
    grid: $('cal-grid'),
    prev: $('cal-prev'),
    next: $('cal-next'),
    detail: $('day-detail'),
    detailTitle: $('detail-title'),
    detailView: $('detail-view'),
    detailEditView: $('detail-edit-view'),
    detailEdit: $('detail-edit'),
    detailEditDone: $('detail-edit-done'),
    detailTags: $('detail-tags'),
    detailText: $('detail-text'),
    detailImages: $('detail-images'),
    detailHabits: $('detail-habits'),
    detailEmpty: $('detail-empty'),
    detailClose: $('detail-close'),
    monthRanking: $('month-ranking'),
    monthRankingList: $('month-ranking-list'),
    monthRankingEmpty: $('month-ranking-empty'),
    monthHabits: $('month-habits'),
    monthHabitsList: $('month-habits-list'),
    monthHabitsEmpty: $('month-habits-empty'),
    subCalendar: $('subview-calendar'),
    subTags: $('subview-tags'),
    subHabits: $('subview-habits'),
    subtabs: $('cal-subtabs'),
  };
  let cur = monthOfKey(ctx.todayKey());
  let openDate = null; // 詳細/編集で開いている日付
  let editing = false;
  let subview = 'calendar'; // ふりかえりのサブタブ(calendar|tags|habits)
  let urls = [];
  let detailUrls = [];
  let renderSeq = 0; // 古い描画が新しい描画を上書きしないための世代トークン
  // 過去日編集はふりかえり(ロックの内側)でのみ動く。編集内容はカレンダーに反映する。
  const editor = createDayEditor(ctx, { onChange: () => renderGrid() });

  // カレンダーのグリッド描画のみ(編集中の保存反映で使う。詳細は編集中は閉じない)
  async function renderGrid() {
    renderSeq += 1;
    const seq = renderSeq;
    const today = ctx.todayKey();
    if (!editing) els.detail.hidden = true;
    els.title.textContent = `${cur.year}年${cur.month}月`;
    const [entries, tags, habits, habitLogs] = await Promise.all([
      ctx.stores.entries.all(),
      ctx.stores.tags.list(),
      ctx.stores.habits.list(),
      ctx.stores.habitLogs.all(),
    ]);
    const tagName = new Map(tags.map((t) => [t.id, t.name]));
    const weeks = buildMonth(cur.year, cur.month, entries, today);

    const newUrls = [];
    const cells = [];
    for (const week of weeks) {
      for (const cell of week) {
        const div = document.createElement('div');
        if (!cell) {
          div.className = 'cal-cell empty';
          cells.push(div);
          continue;
        }
        div.className = `cal-cell${cell.isToday ? ' today' : ''}`;
        div.dataset.date = cell.key;
        const day = document.createElement('span');
        day.className = 'cal-day';
        day.textContent = cell.day;
        div.append(day);
        if (cell.imageId) {
          const rec = await ctx.pipeline.store.get(cell.imageId);
          if (rec?.thumbBlob) {
            const url = URL.createObjectURL(rec.thumbBlob);
            newUrls.push(url);
            div.style.backgroundImage = `url(${url})`;
            div.classList.add('has-image');
          }
        }
        if (cell.tags.length > 0) {
          const wrap = document.createElement('span');
          wrap.className = 'cal-tags';
          for (const id of cell.tags) {
            const t = document.createElement('span');
            t.className = 'cal-tag';
            t.textContent = tagName.get(id) ?? '';
            wrap.append(t);
          }
          div.append(wrap);
        }
        div.onclick = () => openDetail(cell.key);
        cells.push(div);
      }
    }
    if (seq !== renderSeq) {
      for (const u of newUrls) URL.revokeObjectURL(u);
      return;
    }
    for (const u of urls) URL.revokeObjectURL(u);
    urls = newUrls;
    els.grid.replaceChildren(...cells);

    // 月間タグランキング(この月によく使ったタグ。上位5件・hidden除外)
    const hiddenIds = new Set(tags.filter((t) => t.hidden).map((t) => t.id));
    const ranking = monthlyTagRanking(entries, cur.year, cur.month, { hiddenTagIds: hiddenIds, limit: 5 });
    els.monthRanking.hidden = ranking.length === 0; // 見出し+一覧は空なら隠し、代わりに空メッセージ
    els.monthRankingEmpty.hidden = ranking.length > 0;
    els.monthRankingList.replaceChildren(
      ...ranking.map((r) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'ranking-name';
        name.textContent = tagName.get(r.id) ?? '';
        const c = document.createElement('span');
        c.className = 'ranking-count';
        c.textContent = `${r.count}回`;
        li.append(name, c);
        return li;
      }),
    );

    // 月間の日課達成日数(この月に各日課を何日達成したか。達成感の可視化。2026-08-14 PD要望)
    const habitCounts = monthlyHabitCounts(habitLogs, habits, cur.year, cur.month);
    els.monthHabits.hidden = habitCounts.length === 0; // 日課が無ければ隠し、空メッセージを出す
    els.monthHabitsEmpty.hidden = habitCounts.length > 0;
    els.monthHabitsList.replaceChildren(
      ...habitCounts.map((h) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'habit-count-name';
        name.textContent = h.name;
        const c = document.createElement('span');
        c.className = 'habit-count-days';
        c.textContent = `${h.count}日`;
        li.append(name, c);
        return li;
      }),
    );
  }

  // ふりかえりのサブタブ切替(カレンダー/よく使うタグ/日課の達成)
  function showSubview(name) {
    subview = name;
    // カレンダー以外へ移るときは開いていた詳細・編集を閉じる(詳細はカレンダー内の機能)
    if (name !== 'calendar') {
      editing = false;
      editor.close();
      els.detail.hidden = true;
      openDate = null;
    }
    els.subCalendar.hidden = name !== 'calendar';
    els.subTags.hidden = name !== 'tags';
    els.subHabits.hidden = name !== 'habits';
    for (const b of els.subtabs.querySelectorAll('.sub-tab')) {
      b.classList.toggle('active', b.dataset.subview === name);
    }
  }

  // タブ再入場時の入口: 編集・詳細をクリーンに戻してからグリッド描画
  async function refresh() {
    editing = false;
    editor.close();
    els.detail.hidden = true;
    openDate = null;
    showSubview('calendar'); // ふりかえりを開いたらカレンダーから
    await renderGrid();
  }

  // 指定日付の月を開いて詳細を表示(タグの使用日ジャンプ用)。カレンダーのサブビューに切替。
  async function openAt(date) {
    cur = monthOfKey(date);
    showSubview('calendar');
    await renderGrid();
    await openDetail(date);
  }

  async function openDetail(date) {
    openDate = date;
    editing = false;
    els.detailView.hidden = false;
    els.detailEditView.hidden = true;
    editor.close();
    const [entry, tags, habits, checks] = await Promise.all([
      ctx.stores.entries.get(date),
      ctx.stores.tags.list(),
      ctx.stores.habits.list(),
      ctx.stores.habitLogs.forDate(date),
    ]);
    const tagName = new Map(tags.map((t) => [t.id, t.name]));
    const [y, m, d] = date.split('-').map(Number);
    els.detailTitle.textContent = `${y}年${m}月${d}日`;

    els.detailTags.replaceChildren(
      ...(entry?.tags ?? []).map((id) => {
        const s = document.createElement('span');
        s.className = 'detail-tag';
        s.textContent = tagName.get(id) ?? '';
        return s;
      }),
    );
    els.detailText.textContent = entry?.text ?? '';

    for (const u of detailUrls) URL.revokeObjectURL(u);
    detailUrls = [];
    const imgs = [];
    for (const id of entry?.images ?? []) {
      const rec = await ctx.pipeline.store.get(id);
      if (!rec?.blob) continue;
      const url = URL.createObjectURL(rec.blob);
      detailUrls.push(url);
      const cell = document.createElement('div');
      cell.className = 'image-cell';
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      cell.append(img);
      imgs.push(cell);
    }
    els.detailImages.replaceChildren(...imgs);

    els.detailHabits.replaceChildren(
      ...habits.map((habit) => {
        const li = document.createElement('li');
        const mark = document.createElement('span');
        mark.className = 'habit-done-mark';
        mark.textContent = checks[habit.id] ? '✓' : '−';
        const icon = document.createElement('span');
        icon.className = 'habit-icon';
        ctx.renderHabitIcon(icon, habit.icon);
        const name = document.createElement('span');
        name.className = 'habit-name';
        name.textContent = habit.name;
        li.append(mark, icon, name);
        return li;
      }),
    );

    const hasAny = entry || Object.keys(checks).length > 0;
    els.detailEmpty.hidden = !!hasAny;
    els.detail.hidden = false;
    els.detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function move(dir) {
    cur = dir < 0 ? prevMonth(cur.year, cur.month) : nextMonth(cur.year, cur.month);
    // 月移動で編集・詳細は閉じる
    editing = false;
    editor.close();
    els.detail.hidden = true;
    openDate = null;
    renderGrid();
  }

  // 過去日の編集を開始/終了(ふりかえり=ロックの内側でのみ)
  async function startEdit() {
    if (!openDate) return;
    editing = true;
    els.detailView.hidden = true;
    els.detailEditView.hidden = false;
    await editor.open(openDate);
  }
  function endEdit() {
    editing = false;
    editor.close();
    if (openDate) openDetail(openDate); // 更新後の内容を閲覧ビューに反映
    refresh(); // カレンダーの一押し/タグも更新
  }

  els.prev.onclick = () => move(-1);
  els.next.onclick = () => move(1);
  for (const b of els.subtabs.querySelectorAll('.sub-tab')) {
    b.onclick = () => showSubview(b.dataset.subview);
  }
  els.detailEdit.onclick = startEdit;
  els.detailEditDone.onclick = endEdit;
  els.detailClose.onclick = () => {
    if (editing) {
      editing = false;
      editor.close();
      refresh();
    }
    els.detail.hidden = true;
    openDate = null;
  };

  // スワイプで前後の月へ(Pointer Events。HTML5 DnD は使わない: 教訓 drag-test)
  let downX = null;
  els.grid.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
  });
  els.grid.addEventListener('pointerup', (e) => {
    if (downX === null) return;
    const dx = e.clientX - downX;
    downX = null;
    if (Math.abs(dx) > 50) move(dx > 0 ? -1 : 1);
  });

  return { refresh, openAt };
}
