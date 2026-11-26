// ふりかえりタブ。月カレンダー(一押しサムネ背景+タグ上位1〜2個)と日別詳細(R8, R9)。
// このタブへの進入ガード(ロック)は app.js 側で行う。

import { buildMonth, prevMonth, nextMonth, swipeAxis, swipeSettle } from '../core/calendar.js';
import { monthOfKey } from '../core/dates.js';
import { monthlyTagRanking } from '../core/tag-stats.js';
import { monthlyHabitCounts, habitNameShown } from '../core/habit-stats.js';
import { createDayEditor } from './day-editor.js';
import { canMakeCard } from './card-dialog.js';
import { MONTH_CARD_EMPTY_MESSAGE } from './month-card-dialog.js';
import { monthHasEntries } from '../core/month-card.js';
import { cellEmojis } from '../core/plans.js';
import { renderPlanList } from './plan-dialog.js';
import { tr, formatDate, formatYearMonth } from '../i18n/index.js';

const MONTH_CARD_HINT = tr('月のカレンダーを1枚の画像にして、SNSや写真アプリに共有できます(本文・予定は入りません)。');

export function initCalendar(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    title: $('cal-title'),
    grid: $('cal-grid'),
    gridPrev: $('cal-grid-prev'),
    gridNext: $('cal-grid-next'),
    swipe: $('cal-swipe'),
    panel: $('panel-calendar'),
    track: $('cal-track'),
    prev: $('cal-prev'),
    next: $('cal-next'),
    detail: $('day-detail'),
    detailTitle: $('detail-title'),
    detailView: $('detail-view'),
    detailEditView: $('detail-edit-view'),
    detailEdit: $('detail-edit'),
    detailEditDone: $('detail-edit-done'),
    detailCard: $('detail-card-btn'),
    detailCardNote: $('detail-card-note'),
    detailCards: $('detail-cards'),
    detailPlans: $('detail-plans'),
    detailPlanAdd: $('detail-plan-add'),
    detailTags: $('detail-tags'),
    detailText: $('detail-text'),
    detailImages: $('detail-images'),
    detailHabits: $('detail-habits'),
    detailEmpty: $('detail-empty'),
    detailClose: $('detail-close'),
    monthCardBtn: $('month-card-btn'),
    monthCardHint: $('month-card-hint'),
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
    els.title.textContent = formatYearMonth(cur.year, cur.month);
    const [entries, tags, habits, habitLogs, plans] = await Promise.all([
      ctx.stores.entries.all(),
      ctx.stores.tags.list(),
      ctx.stores.habits.list(),
      ctx.stores.habitLogs.all(),
      ctx.stores.plans.all(),
    ]);
    const tagName = new Map(tags.map((t) => [t.id, t.name]));
    const newUrls = [];
    // 1 か月分のマス。隣の月(スワイプでのぞく分)はタップできないマスにする
    async function monthCells(ym, interactive) {
      const weeks = buildMonth(ym.year, ym.month, entries, today);
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
          // 予定(v1.06): マスの右上に絵文字(最大 2 個)。記録の有無とは独立
          const emojis = cellEmojis(plans[cell.key]);
          if (emojis.length > 0) {
            const pl = document.createElement('span');
            pl.className = 'cal-plans';
            pl.textContent = emojis.join('');
            div.append(pl);
          }
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
          if (interactive) div.onclick = () => openDetail(cell.key);
          cells.push(div);
        }
      }
      return cells;
    }
    const cells = await monthCells(cur, true);
    const cellsPrev = await monthCells(prevMonth(cur.year, cur.month), false);
    const cellsNext = await monthCells(nextMonth(cur.year, cur.month), false);
    if (seq !== renderSeq) {
      for (const u of newUrls) URL.revokeObjectURL(u);
      return;
    }
    for (const u of urls) URL.revokeObjectURL(u);
    urls = newUrls;
    els.grid.replaceChildren(...cells);
    els.gridPrev.replaceChildren(...cellsPrev);
    els.gridNext.replaceChildren(...cellsNext);
    fitSwipeHeight();

    // 月の1枚: 記録のある月だけ作れる(無い月は押せず、理由をひとこと出す)
    const canMonthCard = monthHasEntries(buildMonth(cur.year, cur.month, entries, today));
    els.monthCardBtn.disabled = !canMonthCard;
    els.monthCardHint.textContent = canMonthCard ? MONTH_CARD_HINT : MONTH_CARD_EMPTY_MESSAGE;

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
        c.textContent = tr('{0}回', r.count);
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
        c.textContent = tr('{0}日', h.count);
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
    const [entry, tags, habits, checks, plans] = await Promise.all([
      ctx.stores.entries.get(date),
      ctx.stores.tags.list(),
      ctx.stores.habits.list(),
      ctx.stores.habitLogs.forDate(date),
      ctx.stores.plans.forDate(date),
    ]);
    const tagName = new Map(tags.map((t) => [t.id, t.name]));
    const [y, m, d] = date.split('-').map(Number);
    els.detailTitle.textContent = formatDate(y, m, d);

    // 予定(v1.06): この日の予定の一覧。タップで編集、「＋予定」で追加。未来の日はこれだけが出る
    renderPlanList(els.detailPlans, plans, {
      onTap: async (plan) => {
        const r = await ctx.planDialog.open({ date, plan });
        if (r.saved || r.removed) {
          await renderGrid();
          await openDetail(date);
        }
      },
    });
    els.detailPlanAdd.onclick = async () => {
      const r = await ctx.planDialog.open({ date });
      if (r.saved) {
        await renderGrid();
        await openDetail(date);
      }
    };

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
        name.textContent = habitNameShown(habit);
        li.append(mark, icon, name);
        return li;
      }),
    );

    // この日の1枚カード(v1.1): ロックの内側(ふりかえり)なので過去日もカードにできる(不変条件3)
    els.detailCard.hidden = !canMakeCard(entry);
    els.detailCardNote.hidden = true;
    // 保存済みカード(v1.05)。削除したらこの詳細を描き直す
    await ctx.cardList?.render(els.detailCards, date, entry, { onChange: () => openDetail(date) });

    const hasAny = entry || Object.keys(checks).length > 0;
    els.detailEmpty.hidden = !!hasAny;
    els.detailEmpty.textContent = date > ctx.todayKey() ? tr('まだ先の日です。予定を入れておけます。') : tr('この日の記録はありません。');
    els.detail.hidden = false;
    els.detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // 月を送る(矢印ボタン・スワイプ共通)。カレンダーを横にすべらせてから描き直す
  async function move(dir) {
    if (sliding) return;
    sliding = true;
    try {
      await slideTrack(dir);
      cur = dir < 0 ? prevMonth(cur.year, cur.month) : nextMonth(cur.year, cur.month);
      // 月移動で編集・詳細は閉じる
      editing = false;
      editor.close();
      els.detail.hidden = true;
      openDate = null;
      // すべり終えた位置(隣の月)を見せたまま描き直し、描き終えたら同じ描画で真ん中へ戻す(ちらつかない)
      await renderGrid();
    } finally {
      setTrack(0, false);
      sliding = false;
    }
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
  // 月の1枚(表示中の月)。記録が無い月はボタンを押せない(renderGrid で切り替える)
  els.monthCardBtn.onclick = async () => {
    els.monthCardBtn.disabled = true; // 二度押しで 2 回開かない
    try {
      await ctx.monthCardDialog.open({ year: cur.year, month: cur.month });
    } finally {
      els.monthCardBtn.disabled = false; // 押せたのは記録のある月だけ。開いている日別詳細は閉じない
    }
  };
  els.next.onclick = () => move(1);
  for (const b of els.subtabs.querySelectorAll('.sub-tab')) {
    b.onclick = () => showSubview(b.dataset.subview);
  }
  els.detailEdit.onclick = startEdit;
  els.detailEditDone.onclick = endEdit;
  els.detailCard.onclick = async () => {
    if (!openDate) return;
    const r = await ctx.cardDialog.open(openDate);
    els.detailCardNote.hidden = r.opened;
    els.detailCardNote.textContent = r.opened ? '' : (r.reason ?? '');
  };
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
  // 3 か月分(前・今・次)を横に並べた帯を指に合わせて動かし、離したら隣の月へ送るか元に戻す
  // (2026-10-26 PD 要望「すぐに切り替わるじゃなく動かした感のある中間の動作」)。
  // #panel-calendar と .cal-swipe は touch-action: pan-y なので、縦のなぞりはブラウザのスクロールのまま(教訓 calendar-swipe-touch)
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let sliding = false;
  let drag = null; // { id, x, y, axis, dx, samples:[{x,t}] }
  let swipedAt = -Infinity;

  // offset: 0=今の月 / -1=前の月 / 1=次の月 を見せる位置。dx: 指のぶんのずれ(px)
  function setTrack(offset, animate, dx = 0) {
    els.track.style.transition = animate && !reduceMotion?.matches ? 'transform 0.25s ease-out' : 'none';
    els.track.style.transform = `translateX(calc(${(-1 - offset) * (100 / 3)}% + ${dx}px))`;
  }
  function slideTrack(offset) {
    return new Promise((resolve) => {
      if (reduceMotion?.matches) {
        setTrack(offset, false);
        resolve();
        return;
      }
      const done = () => {
        els.track.removeEventListener('transitionend', done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 400); // transitionend が来ないとき(位置が変わらない等)の保険
      els.track.addEventListener('transitionend', done);
      setTrack(offset, true);
    });
  }
  // 帯の高さは今の月に合わせる(5 週と 6 週の月で下に空きができないように)
  function fitSwipeHeight() {
    els.swipe.style.height = els.grid.offsetHeight ? `${els.grid.offsetHeight}px` : '';
  }
  if (window.ResizeObserver) new ResizeObserver(fitSwipeHeight).observe(els.grid);

  // なぞりを受け付ける場所: カレンダーのパネル全体(曜日の行・マスの下のすき間も。2026-10-26 PD 実機 FB
  // 「カレンダー全体で反応するようにして欲しい」)。開いた日の詳細と下のサブタブは除く
  const swipeTarget = (el) => subview === 'calendar' && !el?.closest?.('#day-detail, #cal-subtabs');
  els.panel.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    swipedAt = -Infinity; // 新しくタッチしたら、次の click は普通のタップとして通す
    if (sliding || e.button > 0 || !swipeTarget(e.target)) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null, dx: 0, samples: [{ x: e.clientX, t: e.timeStamp }] };
  });
  els.panel.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (drag.axis === null) {
      drag.axis = swipeAxis(dx, e.clientY - drag.y);
      if (drag.axis === 'y') { drag = null; return; } // 縦はスクロールに任せる
      if (drag.axis === null) return;
      try { els.panel.setPointerCapture(e.pointerId); } catch { /* 指がもう離れている */ }
    }
    drag.dx = dx;
    drag.samples.push({ x: e.clientX, t: e.timeStamp });
    if (drag.samples.length > 6) drag.samples.shift();
    setTrack(0, false, dx);
  });
  const endDrag = (e, cancelled) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.axis !== 'x') return;
    swipedAt = performance.now();
    // 離す直前(最大 6 回分)の速さ px/ms
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const velocity = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const dir = cancelled ? 0 : swipeSettle(d.dx, els.swipe.clientWidth, velocity);
    if (dir === 0) {
      // 元に戻すだけなので、戻っている途中でも次のなぞりを受け付ける(sliding にしない)
      slideTrack(0);
    } else {
      move(dir);
    }
  };
  els.panel.addEventListener('pointerup', (e) => endDrag(e, false));
  els.panel.addEventListener('pointercancel', (e) => endDrag(e, true));
  // なぞり終えたマスの click で日別詳細が開かないようにする(iOS では click が少し遅れて来ることがある。
  // 次にタッチするまでの 0.5 秒だけ)
  els.panel.addEventListener('click', (e) => {
    if (performance.now() - swipedAt < 500) e.stopPropagation();
  }, true);

  // 指定の年月を開く(月のまとめ通知からの遷移用)
  async function showMonth(year, month) {
    cur = { year, month };
    editing = false;
    editor.close();
    els.detail.hidden = true;
    openDate = null;
    showSubview('calendar');
    await renderGrid();
  }

  // 開いている日別詳細があれば描き直す(カードの保存・削除後)
  async function refreshDetail() {
    if (openDate && !editing && !els.detail.hidden) await openDetail(openDate);
  }

  return { refresh, openAt, showMonth, refreshDetail };
}
