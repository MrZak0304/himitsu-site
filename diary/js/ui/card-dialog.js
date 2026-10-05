// 「きょうの1枚カード」の作成ダイアログ(v1.1・PD FB 2026-10-05 第1弾/第2弾)。
// 写真の選択(なし/その日の各写真)・表示範囲(ドラッグで移動・ピンチ/スライダーで拡大)・
// タグのシール貼り(貼る/はがす・ドラッグ・回転・縦横)・ライブプレビュー→共有。
// 共有時に選んだ切り出し範囲はその写真の「サムネイル」として保存する(一押し表示にも反映)。
// 本文は載せない。共有はユーザーの操作でのみ外へ出る(不変条件1)。

import { normalizePushIndex } from '../core/image-rules.js';
import {
  cardFileName, panCrop, clampCrop, pinchZoom, CROP_MAX_ZOOM, layoutCard,
  autoStickers, clampSticker, hitSticker, placeNewSticker, STICKER_ROTATE_STEP,
} from '../core/card.js';
import { drawCard, loadBitmap, renderCard, cropThumb, currentThemeColors } from '../card-render.js';
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
    tags: $('card-tags'),
    tools: $('card-sticker-tools'),
    rotL: $('card-rot-l'),
    rotR: $('card-rot-r'),
    orient: $('card-orient'),
    peel: $('card-peel'),
    note: $('card-dialog-note'),
    share: $('card-share'),
    cancel: $('card-cancel'),
  };
  // state: { dateKey, tagNames, photos:[{id, rec}], sel, bitmap, crop, theme, stickers, selected }
  let state = null;
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
      drawCard(els.preview, {
        dateKey: state.dateKey, tagNames: state.tagNames, bitmap: state.bitmap, crop: state.crop, theme: state.theme,
        stickers: state.stickers, highlightIndex: state.selected,
      });
    });
  }

  // --- タグのパレット(貼る/はがす)と選択中シールのツールバー ---
  function renderPalette() {
    const placed = new Set(state.stickers.map((s) => s.text));
    els.tags.replaceChildren(
      ...state.tagNames.map((name) => {
        const b = document.createElement('button');
        b.className = `tag-stamp${placed.has(name) ? ' on' : ''}`;
        b.textContent = name;
        b.dataset.tag = name;
        b.onclick = () => {
          const idx = state.stickers.findIndex((s) => s.text === name);
          if (idx >= 0) {
            state.stickers.splice(idx, 1);
            state.selected = -1;
          } else {
            state.stickers.push(placeNewSticker(name, state.stickers));
            state.selected = state.stickers.length - 1;
          }
          renderPalette();
          renderTools();
          scheduleDraw();
        };
        return b;
      }),
    );
  }

  function renderTools() {
    const s = state.selected >= 0 ? state.stickers[state.selected] : null;
    els.tools.hidden = !s;
    if (s) els.orient.textContent = s.orient === 'v' ? '横書きにする' : '縦書きにする';
  }

  function select(i) {
    state.selected = i;
    renderTools();
    scheduleDraw();
  }

  function initialCropFor(idx) {
    if (idx < 0) return { cx: 0.5, cy: 0.5, zoom: 1 };
    const saved = state.imageCrops?.[state.photos[idx].id];
    return saved ? { ...saved } : { cx: 0.5, cy: 0.5, zoom: 1 };
  }

  async function selectPhoto(idx) {
    if (!state) return;
    state.bitmap?.close?.();
    state.bitmap = null;
    state.sel = idx;
    state.crop = initialCropFor(idx);
    els.zoom.value = String(state.crop.zoom);
    for (const b of els.photos.querySelectorAll('.card-photo')) b.classList.toggle('on', Number(b.dataset.idx) === idx);
    const hasPhoto = idx >= 0;
    els.zoomRow.hidden = !hasPhoto;
    els.hint.textContent = hasPhoto
      ? '写真はドラッグで移動・2本指で拡大。タグはシールのように動かせます(タップで選んで回転・縦横)。'
      : 'タグだけのカードです。タグはシールのように動かせます(タップで選んで回転・縦横)。';
    if (hasPhoto) {
      const rec = state.photos[idx].rec;
      if (rec?.blob) {
        state.bitmap = await loadBitmap(rec.blob);
        state.crop = clampCrop(state.crop, state.bitmap.width, state.bitmap.height);
      }
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
    const tagNames = (entry.tags ?? []).map((id) => nameOf.get(id)).filter(Boolean);
    const theme = currentThemeColors();
    state = {
      dateKey,
      tagNames,
      photos,
      imageCrops: entry.imageCrops ?? {},
      sel: -1,
      bitmap: null,
      crop: { cx: 0.5, cy: 0.5, zoom: 1 },
      theme,
      // 既定=自動配置をシール化(今のデザイン)。ここから自由に動かせる
      stickers: autoStickers(layoutCard({ dateKey, tagNames, hasPhoto: photos.length > 0, theme })),
      selected: -1,
    };
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
    renderPalette();
    renderTools();
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
    els.tags.replaceChildren();
    els.tools.hidden = true;
    els.root.hidden = true;
  }

  // --- ポインタ操作(Pointer Events。HTML5 DnD は使わない: 教訓 drag-test) ---
  // 1本指: シールの上ならシールを動かす、そうでなければ写真を動かす。2本指: ピンチで写真を拡大
  const pointers = new Map(); // pointerId → {x, y}
  let gesture = null; // {kind:'sticker'|'photo'|'pinch', ...}

  function cardPoint(e) {
    const rect = els.preview.getBoundingClientRect();
    const size = els.preview.width;
    return { x: ((e.clientX - rect.left) / rect.width) * size, y: ((e.clientY - rect.top) / rect.height) * size, scale: size / rect.width };
  }

  els.preview.addEventListener('pointerdown', (e) => {
    if (!state) return;
    try {
      els.preview.setPointerCapture?.(e.pointerId);
    } catch {
      // 合成イベントなど未知の pointerId では例外になるが、操作自体には不要
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && state.bitmap) {
      const [a, b] = [...pointers.values()];
      gesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: state.crop.zoom };
      return;
    }
    if (pointers.size > 1) return;
    const p = cardPoint(e);
    const hit = hitSticker(state.stickers, p.x, p.y, els.preview.width);
    if (hit >= 0) {
      gesture = { kind: 'sticker', idx: hit, lastX: e.clientX, lastY: e.clientY, scale: p.scale };
      select(hit);
    } else {
      gesture = state.bitmap ? { kind: 'photo', lastX: e.clientX, lastY: e.clientY } : null;
      if (state.selected !== -1) select(-1);
    }
  });
  els.preview.addEventListener('pointermove', (e) => {
    if (!state || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.kind === 'pinch') {
      if (pointers.size < 2 || !state.bitmap) return;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      state.crop = pinchZoom({ ...state.crop, zoom: gesture.zoom }, d / Math.max(1, gesture.dist), state.bitmap.width, state.bitmap.height);
      els.zoom.value = String(state.crop.zoom);
      scheduleDraw();
      return;
    }
    const dx = e.clientX - gesture.lastX;
    const dy = e.clientY - gesture.lastY;
    gesture.lastX = e.clientX;
    gesture.lastY = e.clientY;
    if (gesture.kind === 'sticker') {
      const st = state.stickers[gesture.idx];
      const size = els.preview.width;
      state.stickers[gesture.idx] = clampSticker({ ...st, x: st.x + (dx * gesture.scale) / size, y: st.y + (dy * gesture.scale) / size });
      scheduleDraw();
    } else if (gesture.kind === 'photo' && state.bitmap) {
      const rect = els.preview.getBoundingClientRect();
      state.crop = panCrop(state.crop, dx, dy, rect.width, state.bitmap.width, state.bitmap.height);
      scheduleDraw();
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) gesture = null;
    else if (gesture?.kind === 'pinch' && pointers.size === 1) gesture = null; // 片指を離したら操作終了
  };
  els.preview.addEventListener('pointerup', endPointer);
  els.preview.addEventListener('pointercancel', endPointer);

  els.zoom.min = '1';
  els.zoom.max = String(CROP_MAX_ZOOM);
  els.zoom.step = '0.05';
  els.zoom.oninput = () => {
    if (!state?.bitmap) return;
    state.crop = clampCrop({ ...state.crop, zoom: Number(els.zoom.value) }, state.bitmap.width, state.bitmap.height);
    scheduleDraw();
  };

  // 選択中シールのツール: 回転(±15度)・縦横・はがす
  function updateSelected(fn) {
    if (!state || state.selected < 0) return;
    state.stickers[state.selected] = clampSticker(fn(state.stickers[state.selected]));
    renderTools();
    scheduleDraw();
  }
  els.rotL.onclick = () => updateSelected((s) => ({ ...s, rotate: (s.rotate ?? 0) - STICKER_ROTATE_STEP }));
  els.rotR.onclick = () => updateSelected((s) => ({ ...s, rotate: (s.rotate ?? 0) + STICKER_ROTATE_STEP }));
  els.orient.onclick = () => updateSelected((s) => ({ ...s, orient: s.orient === 'v' ? 'h' : 'v' }));
  els.peel.onclick = () => {
    if (!state || state.selected < 0) return;
    state.stickers.splice(state.selected, 1);
    state.selected = -1;
    renderPalette();
    renderTools();
    scheduleDraw();
  };

  els.cancel.onclick = close;
  els.share.onclick = async () => {
    if (!state) return;
    const { dateKey, tagNames, crop, theme, stickers } = state;
    const photo = state.sel >= 0 ? state.photos[state.sel] : null;
    ctx.showLoading('カードを作っています…');
    let result;
    try {
      const png = await renderCard({ dateKey, tagNames, photoBlob: photo?.rec.blob ?? null, crop, theme, stickers });
      // 選んだ切り出し範囲をその写真のサムネイルとして保存(一押し表示・次回の既定に使う)
      if (photo) {
        const thumbBlob = await cropThumb(photo.rec.blob, crop).catch(() => null);
        if (thumbBlob) await ctx.pipeline.store.put({ ...photo.rec, thumbBlob }).catch(() => {});
        const cur = await ctx.stores.entries.get(dateKey);
        await ctx.stores.entries.upsert(dateKey, { imageCrops: { ...(cur?.imageCrops ?? {}), [photo.id]: crop } });
        ctx.refreshToday?.();
      }
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

  return {
    open,
    close,
    // スモーク用(Web のみ appState 経由で参照)。シールの位置(カード座標px)を返す
    debugStickers: () => (state ? state.stickers.map((s) => ({ ...s, px: s.x * els.preview.width, py: s.y * els.preview.width })) : []),
    debugCrop: () => (state ? { ...state.crop } : null),
  };
}
