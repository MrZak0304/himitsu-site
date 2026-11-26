// 「月の1枚」のダイアログ。ふりかえりの月カレンダーを 1 枚の画像にして共有する。
// 開くのはふりかえり(ロックの内側)のボタンからだけ(不変条件3)。日記内には保存しない。

import { buildMonth } from '../core/calendar.js';
import { monthlyTagRanking } from '../core/tag-stats.js';
import { monthHasEntries, monthHasPhotos, monthCardFileName, MONTH_CARD_TOP_TAGS } from '../core/month-card.js';
import { drawMonthCard, renderMonthCard } from '../month-card-render.js';
import { loadBitmap, currentThemeColors } from '../card-render.js';
import { deliverFile } from '../backup-io.js';
import { tr } from '../i18n/index.js';

export const MONTH_CARD_TITLE = tr('月の1枚');
export const MONTH_CARD_EMPTY_MESSAGE = tr('この月の記録があると、1枚にできます。');

export function createMonthCardDialog(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    root: $('month-card-dialog'),
    preview: $('month-card-preview'),
    photosRow: $('month-card-photos-row'),
    photos: $('month-card-photos'),
    note: $('month-card-note'),
    share: $('month-card-share'),
    cancel: $('month-card-cancel'),
  };
  // state: { year, month, weeks, tagName, topTags, theme, bitmaps, showPhotos }
  let state = null;
  let openSeq = 0;

  function note(message) {
    els.note.hidden = !message;
    els.note.textContent = message ?? '';
  }

  function params() {
    const { year, month, weeks, tagName, topTags, theme, bitmaps, showPhotos } = state;
    return { year, month, weeks, tagName, topTags, theme, bitmaps, showPhotos };
  }

  function draw() {
    if (state) drawMonthCard(els.preview, params());
  }

  function close() {
    openSeq += 1;
    if (state) for (const b of state.bitmaps.values()) b.close?.();
    state = null;
    els.root.hidden = true;
    note(null);
  }

  // 月に記録が無ければ開かず false を返す(呼び出し側がひとこと出す)
  async function open({ year, month }) {
    openSeq += 1;
    const seq = openSeq;
    const [entries, tags] = await Promise.all([ctx.stores.entries.all(), ctx.stores.tags.list()]);
    const weeks = buildMonth(year, month, entries, null);
    if (!monthHasEntries(weeks)) return false;
    const tagName = new Map(tags.map((t) => [t.id, t.name]));
    const hiddenIds = new Set(tags.filter((t) => t.hidden).map((t) => t.id));
    const topTags = monthlyTagRanking(entries, year, month, { hiddenTagIds: hiddenIds, limit: MONTH_CARD_TOP_TAGS })
      .map((r) => tagName.get(r.id) ?? '')
      .filter((t) => t !== '');
    // サムネイルだけを読む(原寸の写真は読まない)。読めない画像は写真なしのマスにする
    const bitmaps = new Map();
    const ids = weeks.flat().filter((c) => c?.imageId).map((c) => c.imageId);
    await Promise.all(
      ids.map(async (id) => {
        try {
          const rec = await ctx.pipeline.store.get(id);
          if (rec?.thumbBlob) bitmaps.set(id, await loadBitmap(rec.thumbBlob));
        } catch {
          // 写真なしのマスとして描く
        }
      }),
    );
    if (seq !== openSeq) {
      for (const b of bitmaps.values()) b.close?.();
      return true;
    }
    if (state) for (const b of state.bitmaps.values()) b.close?.();
    state = { year, month, weeks, tagName, topTags, theme: currentThemeColors(), bitmaps, showPhotos: true };
    els.photos.checked = true;
    els.photosRow.hidden = !monthHasPhotos(weeks);
    note(null);
    els.root.hidden = false;
    draw();
    return true;
  }

  els.photos.onchange = () => {
    if (!state) return;
    state.showPhotos = els.photos.checked;
    draw();
  };

  els.cancel.onclick = close;

  els.share.onclick = async () => {
    if (!state) return;
    const { year, month } = state;
    ctx.showLoading(tr('月の1枚を作っています…'));
    let result;
    try {
      const png = await renderMonthCard(params());
      result = await deliverFile(png, monthCardFileName(year, month), { title: MONTH_CARD_TITLE });
    } catch (err) {
      result = { saved: false, reason: err?.message ?? tr('月の1枚を作れませんでした。') };
    } finally {
      ctx.hideLoading();
    }
    if (result.reason) {
      note(result.reason);
      return;
    }
    close();
    if (result.saved) ctx.notifySaved?.({ diary: false });
  };

  return {
    open,
    close,
    isOpen: () => !!state,
    // スモーク用(Web のみ appState 経由で参照)
    debugState: () => (state ? { year: state.year, month: state.month, showPhotos: state.showPhotos, photos: state.bitmaps.size, topTags: [...state.topTags] } : null),
  };
}
