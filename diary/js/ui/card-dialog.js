// 「きょうの1枚カード」の作成ダイアログ(v1.1・PD FB 2026-10-05)。
// 写真の選択(なし/その日の各写真)・表示範囲(ドラッグで移動・スライダーで拡大)・ライブプレビュー→共有。
// 本文は載せない。共有はユーザーの操作でのみ外へ出る(不変条件1)。

import { normalizePushIndex } from '../core/image-rules.js';
import { cardFileName, panCrop, clampCrop, CROP_MAX_ZOOM } from '../core/card.js';
import { drawCard, loadBitmap, renderCard, currentThemeColors } from '../card-render.js';
import { deliverFile } from '../backup-io.js';

export const CARD_EMPTY_MESSAGE = 'タグか写真を記録すると、カードにできます。';

// その日のカードを作れるか(タグか写真があるとき)
export function canMakeCard(entry) {
  return (entry?.tags?.length ?? 0) > 0 || (entry?.images?.length ?? 0) > 0;
}

export function createCardDialog(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    root: $('card-dialog'),
    preview: $('card-preview'),
    photos: $('card-photos'),
    zoomRow: $('card-zoom-row'),
    zoom: $('card-zoom'),
    hint: $('card-hint-text'),
    note: $('card-dialog-note'),
    share: $('card-share'),
    cancel: $('card-cancel'),
  };
  let state = null; // { dateKey, tagNames, photos:[{id, rec}], sel:-1|index, bitmap, crop, theme }
  let thumbUrls = [];
  let raf = 0;

  function note(message) {
    els.note.hidden = !message;
    els.note.textContent = message ?? '';
  }

  function scheduleDraw() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!state) return;
      drawCard(els.preview, { dateKey: state.dateKey, tagNames: state.tagNames, bitmap: state.bitmap, crop: state.crop, theme: state.theme });
    });
  }

  async function selectPhoto(idx) {
    if (!state) return;
    state.bitmap?.close?.();
    state.bitmap = null;
    state.sel = idx;
    state.crop = { cx: 0.5, cy: 0.5, zoom: 1 };
    els.zoom.value = '1';
    for (const b of els.photos.querySelectorAll('.card-photo')) b.classList.toggle('on', Number(b.dataset.idx) === idx);
    const hasPhoto = idx >= 0;
    els.zoomRow.hidden = !hasPhoto;
    els.hint.textContent = hasPhoto ? '写真をドラッグして見せたい部分を選べます。' : 'タグだけのカードになります。';
    if (hasPhoto) {
      const rec = state.photos[idx].rec;
      if (rec?.blob) state.bitmap = await loadBitmap(rec.blob);
    }
    scheduleDraw();
  }

  async function open(dateKey) {
    const entry = await ctx.stores.entries.get(dateKey);
    if (!canMakeCard(entry)) return { opened: false, reason: CARD_EMPTY_MESSAGE };
    const tags = await ctx.stores.tags.list({ includeHidden: true });
    const nameOf = new Map(tags.map((t) => [t.id, t.name]));
    const images = entry.images ?? [];
    const photos = [];
    for (const id of images) {
      const rec = await ctx.pipeline.store.get(id);
      if (rec?.blob) photos.push({ id, rec });
    }
    state = {
      dateKey,
      tagNames: (entry.tags ?? []).map((id) => nameOf.get(id)).filter(Boolean),
      photos,
      sel: -1,
      bitmap: null,
      crop: { cx: 0.5, cy: 0.5, zoom: 1 },
      theme: currentThemeColors(),
    };
    // 写真の選択肢: 「写真なし」+ その日の写真(既定=一押し。写真が無ければ「なし」)
    for (const u of thumbUrls) URL.revokeObjectURL(u);
    thumbUrls = [];
    const noneBtn = document.createElement('button');
    noneBtn.className = 'card-photo none';
    noneBtn.dataset.idx = '-1';
    noneBtn.textContent = '写真なし';
    noneBtn.onclick = () => selectPhoto(-1);
    const thumbs = photos.map((p, i) => {
      const b = document.createElement('button');
      b.className = 'card-photo';
      b.dataset.idx = String(i);
      if (p.rec.thumbBlob) {
        const url = URL.createObjectURL(p.rec.thumbBlob);
        thumbUrls.push(url);
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        b.append(img);
      }
      b.onclick = () => selectPhoto(i);
      return b;
    });
    els.photos.replaceChildren(noneBtn, ...thumbs);
    note(null);
    els.root.hidden = false;
    const pushIdx = photos.length > 0 ? normalizePushIndex(images, entry.pushImageIndex ?? null) : -1;
    await selectPhoto(photos.length > 0 ? Math.min(pushIdx, photos.length - 1) : -1);
    return { opened: true };
  }

  function close() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    state?.bitmap?.close?.();
    state = null;
    for (const u of thumbUrls) URL.revokeObjectURL(u);
    thumbUrls = [];
    els.photos.replaceChildren();
    els.root.hidden = true;
  }

  // ドラッグで注視点を移動(Pointer Events。HTML5 DnD は使わない: 教訓 drag-test)
  let drag = null;
  els.preview.addEventListener('pointerdown', (e) => {
    if (!state?.bitmap) return;
    drag = { x: e.clientX, y: e.clientY };
    els.preview.setPointerCapture?.(e.pointerId);
  });
  els.preview.addEventListener('pointermove', (e) => {
    if (!drag || !state?.bitmap) return;
    const rect = els.preview.getBoundingClientRect();
    state.crop = panCrop(state.crop, e.clientX - drag.x, e.clientY - drag.y, rect.width, state.bitmap.width, state.bitmap.height);
    drag = { x: e.clientX, y: e.clientY };
    scheduleDraw();
  });
  const endDrag = () => {
    drag = null;
  };
  els.preview.addEventListener('pointerup', endDrag);
  els.preview.addEventListener('pointercancel', endDrag);
  els.zoom.min = '1';
  els.zoom.max = String(CROP_MAX_ZOOM);
  els.zoom.step = '0.05';
  els.zoom.oninput = () => {
    if (!state?.bitmap) return;
    state.crop = clampCrop({ ...state.crop, zoom: Number(els.zoom.value) }, state.bitmap.width, state.bitmap.height);
    scheduleDraw();
  };

  els.cancel.onclick = close;
  els.share.onclick = async () => {
    if (!state) return;
    const { dateKey, tagNames, crop, theme } = state;
    const photoBlob = state.sel >= 0 ? state.photos[state.sel].rec.blob : null;
    ctx.showLoading('カードを作っています…');
    let result;
    try {
      const png = await renderCard({ dateKey, tagNames, photoBlob, crop, theme });
      result = await deliverFile(png, cardFileName(dateKey));
    } catch (err) {
      result = { saved: false, reason: err?.message ?? 'カードを作れませんでした。' };
    } finally {
      ctx.hideLoading();
    }
    if (result.reason) {
      note(result.reason);
      return;
    }
    close();
    if (result.saved) ctx.notifySaved?.();
  };

  return { open, close };
}
