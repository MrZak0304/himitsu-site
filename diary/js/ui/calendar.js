// ふりかえりタブ。月カレンダー(一押しサムネ背景+タグ上位1〜2個)と日別詳細(R8, R9)。
// このタブへの進入ガード(ロック)は app.js 側で行う。

import { buildMonth, prevMonth, nextMonth } from '../core/calendar.js';
import { monthOfKey } from '../core/dates.js';

export function initCalendar(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    title: $('cal-title'),
    grid: $('cal-grid'),
    prev: $('cal-prev'),
    next: $('cal-next'),
    detail: $('day-detail'),
    detailTitle: $('detail-title'),
    detailTags: $('detail-tags'),
    detailText: $('detail-text'),
    detailImages: $('detail-images'),
    detailHabits: $('detail-habits'),
    detailEmpty: $('detail-empty'),
    detailClose: $('detail-close'),
  };
  let cur = monthOfKey(ctx.todayKey());
  let urls = [];
  let detailUrls = [];
  let renderSeq = 0; // 古い描画が新しい描画を上書きしないための世代トークン

  async function refresh() {
    renderSeq += 1;
    const seq = renderSeq;
    const today = ctx.todayKey();
    els.detail.hidden = true;
    els.title.textContent = `${cur.year}年${cur.month}月`;
    const [entries, tags] = await Promise.all([ctx.stores.entries.all(), ctx.stores.tags.list()]);
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
  }

  async function openDetail(date) {
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
    refresh();
  }

  els.prev.onclick = () => move(-1);
  els.next.onclick = () => move(1);
  els.detailClose.onclick = () => {
    els.detail.hidden = true;
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

  return { refresh };
}
