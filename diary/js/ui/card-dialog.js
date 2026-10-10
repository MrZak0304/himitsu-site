// 「きょうの1枚カード」の作成ダイアログ(v1.1・PD FB 2026-10-05 第1〜3弾)。
// 2つのモードを持つ:
//   card : 写真の選択(なし/その日の各写真。切り抜きはサムネイル画面で決めた範囲に固定=PD FB 4)・
//          タグのシール貼り(貼る/はがす・ドラッグ・つまみで自由回転・90°ボタン・縦横)・ライブプレビュー→共有
//   thumb: 写真追加直後に開く「サムネイル」画面。切り抜き範囲だけを決めて保存し、
//          そのままカード編集へ続けられる(PD FB 3: 既定の切り抜きのままだと映えない写真が登録される)
// 選んだ切り出し範囲はその写真の「サムネイル」として保存する(一押し表示・カレンダーにも反映)。
// 本文は載せない。共有はユーザーの操作でのみ外へ出る(不変条件1)。

import { normalizePushIndex } from '../core/image-rules.js';
import {
  cardFileName, panCrop, clampCrop, pinchZoom, layoutCard, DEFAULT_CROP,
  autoStickers, clampSticker, hitSticker, placeNewSticker, STICKER_ROTATE_STEP,
  stickerHandlePoint, hitStickerHandle, dragStickerHandle, scaleStickerBy, STICKER_SCALE_STEP, imageStampSize,
} from '../core/card.js';
import { drawCard, drawCropPreview, loadBitmap, renderCard, cropThumb, currentThemeColors } from '../card-render.js';
import { deliverFile } from '../backup-io.js';
import { cardSlotInfo, cardSlotStatusText } from '../core/card-slots.js';
import { requestRewarded, preloadRewarded, isRewardedReady } from '../ads.js';
import { makeId } from '../store/kv.js';

export const CARD_EMPTY_MESSAGE = 'タグか写真を記録すると、カードにできます。';
export const THUMB_TITLE = 'サムネイル';
export const CARD_TITLE = 'きょうの1枚カード';
const WHEEL_ZOOM_RATIO = 1.1; // ホイール1ノッチぶん(PC 向け。スマホはピンチ)

// その日のカードを作れるか(タグか写真があるとき)
export function canMakeCard(entry) {
  return (entry?.tags?.length ?? 0) > 0 || (entry?.images?.length ?? 0) > 0;
}

export function createCardDialog(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    root: $('card-dialog'),
    title: $('card-title'),
    preview: $('card-preview'),
    photos: $('card-photos'),
    photosHint: $('card-photos-hint'),
    hint: $('card-hint-text'),
    reset: $('card-reset'),
    tagsHint: $('card-tags-hint'),
    tags: $('card-tags'),
    tools: $('card-sticker-tools'),
    rotL: $('card-rot-l'),
    rotR: $('card-rot-r'),
    orient: $('card-orient'),
    scaleUp: $('card-scale-up'),
    scaleDown: $('card-scale-down'),
    peel: $('card-peel'),
    note: $('card-dialog-note'),
    slotNote: $('card-slot-note'),
    create: $('card-create'),
    slotAd: $('card-slot-ad'),
    share: $('card-share'),
    save: $('card-save'),
    cont: $('card-continue'),
    cancel: $('card-cancel'),
  };
  // state: { mode:'card'|'thumb', dateKey, tagNames, photos:[{id, rec}], imageCrops, sel, bitmap, crop, theme,
  //          stickers, selected, queue:[imageId](thumb モードで続けて開く写真),
  //          cardId(作り直し中の保存済みカード。新規なら null) }
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
      if (state.mode === 'thumb') {
        drawCropPreview(els.preview, { bitmap: state.bitmap, crop: state.crop });
        return;
      }
      drawCard(els.preview, {
        dateKey: state.dateKey, tagNames: state.tagNames, bitmap: state.bitmap, crop: state.crop, theme: state.theme,
        stickers: state.stickers, highlightIndex: state.selected, stampBitmaps: state.stampBitmaps,
      });
    });
  }

  // モードごとの表示切り替え
  function applyMode() {
    const thumb = state.mode === 'thumb';
    els.title.textContent = thumb ? THUMB_TITLE : CARD_TITLE;
    els.tagsHint.hidden = thumb;
    els.tags.hidden = thumb;
    els.photosHint.hidden = thumb;
    els.photos.hidden = thumb;
    els.share.hidden = thumb;
    els.create.hidden = thumb;
    els.slotAd.hidden = true;
    els.slotNote.hidden = true;
    els.save.hidden = !thumb;
    els.cont.hidden = !thumb || !canMakeCard({ tags: state.tagNames, images: state.photos.map((p) => p.id) });
    if (thumb) els.tools.hidden = true;
  }

  // --- タグのパレット(貼る/はがす)と選択中シールのツールバー ---
  // パレット: 貼ってあるタグは .on、編集中(選択中)のシールのタグは .selected で強調(PD FB 7: どれを触っているか分かるように)
  function renderPalette() {
    const placed = new Set(state.stickers.map((s) => s.text));
    const selectedText = state.selected >= 0 ? state.stickers[state.selected]?.text : null;
    els.tags.replaceChildren(
      ...state.tagNames.map((name) => {
        const b = document.createElement('button');
        b.className = `tag-stamp${placed.has(name) ? ' on' : ''}${name === selectedText ? ' selected' : ''}`;
        b.textContent = name;
        if (name === selectedText) b.setAttribute('aria-current', 'true');
        b.dataset.tag = name;
        b.onclick = () => {
          const idx = state.stickers.findIndex((s) => s.text === name);
          if (idx >= 0) {
            state.stickers.splice(idx, 1);
            state.selected = -1;
          } else {
            state.stickers.push(decorate(placeNewSticker(name, state.stickers)));
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
    const s = state.mode === 'card' && state.selected >= 0 ? state.stickers[state.selected] : null;
    els.tools.hidden = !s;
    if (s) els.orient.textContent = s.orient === 'v' ? 'ヨコ書き' : 'タテ書き';
  }

  function select(i) {
    state.selected = i;
    renderPalette();
    renderTools();
    scheduleDraw();
  }

  function initialCropFor(idx) {
    if (idx < 0) return { ...DEFAULT_CROP };
    const saved = state.imageCrops?.[state.photos[idx].id];
    return saved ? { ...saved } : { ...DEFAULT_CROP };
  }

  function autoStickersFor() {
    return autoStickers(layoutCard({ dateKey: state.dateKey, tagNames: state.tagNames, hasPhoto: state.photos.length > 0, theme: state.theme })).map(decorate);
  }

  // タグのスタンプ設定(v1.05)をシールに付ける。画像スタンプは等倍サイズ(w/h)も持つ
  function decorate(st) {
    const stamp = state?.stampByName?.get(st.text) ?? null;
    const out = { ...st, stamp };
    delete out.w;
    delete out.h;
    if (stamp?.type === 'image') {
      const bmp = state.stampBitmaps.get(stamp.imageId);
      if (bmp) {
        const sz = imageStampSize(bmp.width, bmp.height);
        out.w = sz.w;
        out.h = sz.h;
      } else {
        out.stamp = null; // 画像が無ければ既定のハンコで描く
      }
    }
    return out;
  }

  // その日のタグのスタンプ設定と、画像スタンプの bitmap を読む
  async function loadStamps(tagNames) {
    const tags = await ctx.stores.tags.list({ includeHidden: true });
    const names = new Set(tagNames);
    const stampByName = new Map();
    const stampBitmaps = new Map();
    for (const t of tags) {
      if (!names.has(t.name) || !t.stamp) continue;
      stampByName.set(t.name, t.stamp);
      if (t.stamp.type === 'image' && !stampBitmaps.has(t.stamp.imageId)) {
        const rec = await ctx.pipeline.store.get(t.stamp.imageId).catch(() => null);
        if (rec?.blob) stampBitmaps.set(t.stamp.imageId, await loadBitmap(rec.blob));
      }
    }
    return { stampByName, stampBitmaps };
  }

  async function selectPhoto(idx) {
    if (!state) return;
    state.bitmap?.close?.();
    state.bitmap = null;
    state.sel = idx;
    state.crop = initialCropFor(idx);
    for (const b of els.photos.querySelectorAll('.card-photo')) b.classList.toggle('on', Number(b.dataset.idx) === idx);
    const hasPhoto = idx >= 0;
    if (state.mode === 'thumb') {
      els.hint.textContent = 'この範囲が写真のサムネイルになります。ドラッグで移動・2本指で拡大(PC はホイール)。';
    } else {
      els.hint.textContent = hasPhoto
        ? '写真はサムネイルで決めた範囲のまま固定です。タグはシールのように動かせます(タップで選ぶ→ドラッグで移動・丸いつまみで回転と大きさ・2本指で拡大縮小)。'
        : 'タグだけのカードです。タグはシールのように動かせます(タップで選ぶ→ドラッグで移動・丸いつまみで回転と大きさ・2本指で拡大縮小)。';
    }
    if (hasPhoto) {
      const rec = state.photos[idx].rec;
      if (rec?.blob) {
        state.bitmap = await loadBitmap(rec.blob);
        state.crop = clampCrop(state.crop, state.bitmap.width, state.bitmap.height);
      }
    }
    scheduleDraw();
  }

  // その日の写真を読み込む(blob のあるものだけ)
  async function loadPhotos(entry) {
    const photos = [];
    for (const id of entry?.images ?? []) {
      const rec = await ctx.pipeline.store.get(id);
      if (rec?.blob) photos.push({ id, rec });
    }
    return photos;
  }

  async function tagNamesOf(entry) {
    const tags = await ctx.stores.tags.list({ includeHidden: true });
    const nameOf = new Map(tags.map((t) => [t.id, t.name]));
    return (entry?.tags ?? []).map((id) => nameOf.get(id)).filter(Boolean);
  }

  function renderPhotoPicker() {
    for (const u of thumbUrls) URL.revokeObjectURL(u);
    thumbUrls = [];
    const noneBtn = document.createElement('button');
    noneBtn.className = 'card-photo none';
    noneBtn.dataset.idx = '-1';
    noneBtn.textContent = '写真なし';
    noneBtn.onclick = () => selectPhoto(-1);
    const thumbs = state.photos.map((p, i) => {
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
  }

  // カード作成モードで開く。photoId を渡すとその写真を選んだ状態で始める。
  // cardId を渡すと保存済みカードの作り直し(保存したシール配置と写真から再開。保存で上書き)
  async function open(dateKey, { photoId = null, cardId = null } = {}) {
    const entry = await ctx.stores.entries.get(dateKey);
    if (!canMakeCard(entry)) return { opened: false, reason: CARD_EMPTY_MESSAGE };
    const tagNames = await tagNamesOf(entry);
    const photos = await loadPhotos(entry);
    const theme = currentThemeColors();
    const card = cardId ? (entry.cards ?? []).find((c) => c.id === cardId) ?? null : null;
    const { stampByName, stampBitmaps } = await loadStamps(tagNames);
    state = {
      mode: 'card',
      dateKey,
      tagNames,
      photos,
      imageCrops: entry.imageCrops ?? {},
      sel: -1,
      bitmap: null,
      crop: { ...DEFAULT_CROP },
      theme,
      stickers: [],
      selected: -1,
      queue: [],
      cardId: card?.id ?? null,
      stampByName,
      stampBitmaps,
    };
    // 既定=自動配置をシール化(今のデザイン)。作り直しなら保存したシール配置(今あるタグのぶんだけ)から
    const tagSet = new Set(tagNames);
    const saved = card ? card.stickers.filter((st) => tagSet.has(st.text)).map((st) => decorate(clampSticker({ ...st }))) : null;
    state.stickers = saved && saved.length > 0 ? saved : autoStickersFor();
    renderPhotoPicker();
    renderPalette();
    renderTools();
    applyMode();
    note(null);
    els.create.textContent = card ? '作り直して保存' : '作成して日記に保存';
    els.root.hidden = false;
    let idx = photos.findIndex((p) => p.id === (card ? card.photoId : photoId));
    if (idx < 0 && !(card && card.photoId === null)) {
      const pushIdx = photos.length > 0 ? normalizePushIndex(entry.images ?? [], entry.pushImageIndex ?? null) : -1;
      idx = photos.length > 0 ? Math.min(pushIdx, photos.length - 1) : -1;
    }
    await selectPhoto(idx);
    await refreshSlot(entry);
    return { opened: true };
  }

  // --- 日記内への保存(v1.05): 1日1枚+広告つき版はリワードで追加、買い切り版は無制限 ---
  async function refreshSlot(entry) {
    if (!state || state.mode !== 'card') return;
    const info = cardSlotInfo(entry ?? (await ctx.stores.entries.get(state.dateKey)), ctx.variant);
    const editing = !!state.cardId;
    const blocked = !editing && !info.canAdd;
    els.create.disabled = blocked;
    const status = cardSlotStatusText(info);
    els.slotNote.hidden = editing || !status;
    els.slotNote.textContent = editing || !status ? '' : status;
    els.slotAd.hidden = !blocked;
    if (blocked) {
      // 広告が用意できたときだけ押せる(タグ枠のリワードと同じ作法)
      els.slotAd.disabled = !isRewardedReady();
      const ok = await preloadRewarded();
      if (state && state.mode === 'card') els.slotAd.disabled = !ok;
    }
  }

  // カードを PNG にして画像ストアへ(kind:'card')。サムネイルは中央の正方形=カード全体
  async function renderAndStore() {
    const { dateKey, tagNames, crop, theme, stickers } = state;
    const photo = state.sel >= 0 ? state.photos[state.sel] : null;
    const png = await renderCard({ dateKey, tagNames, photoBlob: photo?.rec.blob ?? null, crop, theme, stickers, stampBitmaps: state.stampBitmaps });
    const thumbBlob = await cropThumb(png, { ...DEFAULT_CROP }).catch(() => png);
    const id = makeId('img');
    await ctx.pipeline.store.put({ id, blob: png, thumbBlob, width: els.preview.width, height: els.preview.height, kind: 'card' });
    return { imageId: id, photoId: photo?.id ?? null };
  }

  els.create.onclick = async () => {
    if (!state || state.mode !== 'card') return;
    const { dateKey, cardId } = state;
    const stickers = state.stickers.map(({ stamp, ...st }) => st); // スタンプの見た目はタグ設定を正とする(保存しない)
    const entry = await ctx.stores.entries.get(dateKey);
    if (!cardId) {
      const info = cardSlotInfo(entry, ctx.variant);
      if (!info.canAdd) {
        note(info.reason);
        await refreshSlot(entry);
        return;
      }
    }
    ctx.showLoading('カードを保存しています…');
    try {
      const { imageId, photoId } = await renderAndStore();
      if (cardId) {
        const prev = entry?.cards.find((c) => c.id === cardId);
        await ctx.stores.entries.updateCard(dateKey, cardId, { imageId, photoId, stickers });
        if (prev?.imageId && prev.imageId !== imageId) await ctx.pipeline.store.remove(prev.imageId).catch(() => {});
      } else {
        await ctx.stores.entries.addCard(dateKey, { imageId, photoId, stickers });
      }
    } catch (err) {
      note(err?.message ?? 'カードを保存できませんでした。');
      return;
    } finally {
      ctx.hideLoading();
    }
    close();
    ctx.notifySaved?.();
    ctx.refreshToday?.();
    ctx.refreshDetail?.();
  };

  // リワード(Web はダミー視聴)→その日のカード枠+1
  els.slotAd.onclick = async () => {
    if (!state) return;
    const { dateKey } = state;
    const isNative = window.Capacitor?.isNativePlatform?.();
    ctx.showLoading(isNative ? '広告を読み込んでいます…' : '広告(ダミー)を視聴中…');
    let failReason = null;
    try {
      const r = await requestRewarded();
      if (r.ok) await ctx.stores.entries.earnCardSlot(dateKey);
      else failReason = r.reason;
    } finally {
      ctx.hideLoading();
    }
    if (!state) return;
    await refreshSlot();
    note(failReason);
  };

  // サムネイルモードで開く(写真追加直後・写真のタップ)。imageIds が複数なら保存のたびに次の写真へ
  async function openThumb(dateKey, imageIds) {
    const ids = (imageIds ?? []).filter(Boolean);
    if (ids.length === 0) return { opened: false };
    const entry = await ctx.stores.entries.get(dateKey);
    const photos = await loadPhotos(entry);
    const idx = photos.findIndex((p) => p.id === ids[0]);
    if (idx < 0) return ids.length > 1 ? openThumb(dateKey, ids.slice(1)) : { opened: false };
    state = {
      mode: 'thumb',
      stampByName: new Map(),
      stampBitmaps: new Map(),
      dateKey,
      tagNames: await tagNamesOf(entry),
      photos,
      imageCrops: entry.imageCrops ?? {},
      sel: -1,
      bitmap: null,
      crop: { ...DEFAULT_CROP },
      theme: currentThemeColors(),
      stickers: [],
      selected: -1,
      queue: ids.slice(1),
    };
    renderPhotoPicker();
    els.tags.replaceChildren();
    renderTools();
    applyMode();
    note(null);
    els.root.hidden = false;
    await selectPhoto(idx);
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
  // thumb: 1本指で写真を動かす・2本指のピンチで拡大。
  // card : 写真は固定(PD FB 4)。シールの上ならシールを動かす、選択中シールのつまみなら回転+大きさ、
  //        2本指は選択中シールの拡大・縮小(PD FB 5)
  const pointers = new Map(); // pointerId → {x, y}
  let gesture = null; // {kind:'sticker'|'rotate'|'photo'|'pinch'|'pinchSticker', ...}
  const photoMovable = () => state?.mode === 'thumb' && !!state.bitmap;

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
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (photoMovable()) gesture = { kind: 'pinch', dist, zoom: state.crop.zoom };
      else if (state.mode === 'card' && state.selected >= 0) gesture = { kind: 'pinchSticker', idx: state.selected, dist, scale: state.stickers[state.selected].scale ?? 1 };
      else gesture = null;
      return;
    }
    if (pointers.size > 1) return;
    const p = cardPoint(e);
    const size = els.preview.width;
    if (state.mode === 'card') {
      if (state.selected >= 0 && hitStickerHandle(state.stickers[state.selected], p.x, p.y, size)) {
        gesture = { kind: 'rotate', idx: state.selected };
        return;
      }
      const hit = hitSticker(state.stickers, p.x, p.y, size);
      if (hit >= 0) {
        gesture = { kind: 'sticker', idx: hit, lastX: e.clientX, lastY: e.clientY, scale: p.scale };
        select(hit);
      } else {
        gesture = null;
        if (state.selected !== -1) select(-1);
      }
      return;
    }
    gesture = photoMovable() ? { kind: 'photo', lastX: e.clientX, lastY: e.clientY } : null;
  });
  els.preview.addEventListener('pointermove', (e) => {
    if (!state || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.kind === 'rotate') {
      const p = cardPoint(e);
      const st = state.stickers[gesture.idx];
      if (st) state.stickers[gesture.idx] = dragStickerHandle(st, p.x, p.y, els.preview.width);
      scheduleDraw();
      return;
    }
    if (gesture.kind === 'pinchSticker') {
      if (pointers.size < 2) return;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const st = state.stickers[gesture.idx];
      if (st) state.stickers[gesture.idx] = clampSticker({ ...st, scale: gesture.scale * (d / Math.max(1, gesture.dist)) });
      scheduleDraw();
      return;
    }
    if (gesture.kind === 'pinch') {
      if (pointers.size < 2 || !photoMovable()) return;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      state.crop = pinchZoom({ ...state.crop, zoom: gesture.zoom }, d / Math.max(1, gesture.dist), state.bitmap.width, state.bitmap.height);
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
    } else if (gesture.kind === 'photo' && photoMovable()) {
      const rect = els.preview.getBoundingClientRect();
      state.crop = panCrop(state.crop, dx, dy, rect.width, state.bitmap.width, state.bitmap.height);
      scheduleDraw();
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) gesture = null;
    else if ((gesture?.kind === 'pinch' || gesture?.kind === 'pinchSticker') && pointers.size === 1) gesture = null; // 片指を離したら操作終了
  };
  els.preview.addEventListener('pointerup', endPointer);
  els.preview.addEventListener('pointercancel', endPointer);
  // PC: ホイールで拡大・縮小(スマホはピンチ。スライダーは PD FB 3 で廃止)。サムネイル画面だけ
  els.preview.addEventListener(
    'wheel',
    (e) => {
      if (!photoMovable()) return;
      e.preventDefault();
      const ratio = e.deltaY < 0 ? WHEEL_ZOOM_RATIO : 1 / WHEEL_ZOOM_RATIO;
      state.crop = pinchZoom(state.crop, ratio, state.bitmap.width, state.bitmap.height);
      scheduleDraw();
    },
    { passive: false },
  );

  // リセット: サムネイル画面=切り抜きを既定に戻す / カード画面=シールを自動配置に戻す(写真はそのまま)
  els.reset.onclick = () => {
    if (!state) return;
    if (state.mode === 'card') {
      state.stickers = autoStickersFor();
      state.selected = -1;
      renderPalette();
      renderTools();
    } else {
      state.crop = state.bitmap ? clampCrop({ ...DEFAULT_CROP }, state.bitmap.width, state.bitmap.height) : { ...DEFAULT_CROP };
    }
    scheduleDraw();
  };

  // 選択中シールのツール: 回転(±90度)・縦横・はがす
  function updateSelected(fn) {
    if (!state || state.selected < 0) return;
    state.stickers[state.selected] = clampSticker(fn(state.stickers[state.selected]));
    renderTools();
    scheduleDraw();
  }
  els.rotL.onclick = () => updateSelected((s) => ({ ...s, rotate: (s.rotate ?? 0) - STICKER_ROTATE_STEP }));
  els.rotR.onclick = () => updateSelected((s) => ({ ...s, rotate: (s.rotate ?? 0) + STICKER_ROTATE_STEP }));
  els.orient.onclick = () => updateSelected((s) => ({ ...s, orient: s.orient === 'v' ? 'h' : 'v' }));
  els.scaleUp.onclick = () => updateSelected((s) => scaleStickerBy(s, STICKER_SCALE_STEP));
  els.scaleDown.onclick = () => updateSelected((s) => scaleStickerBy(s, 1 / STICKER_SCALE_STEP));
  els.peel.onclick = () => {
    if (!state || state.selected < 0) return;
    state.stickers.splice(state.selected, 1);
    state.selected = -1;
    renderPalette();
    renderTools();
    scheduleDraw();
  };

  // 選んだ切り出し範囲をその写真のサムネイルとして保存(一押し表示・次回の既定に使う)
  async function saveCrop(photo, crop) {
    const thumbBlob = await cropThumb(photo.rec.blob, crop).catch(() => null);
    if (thumbBlob) await ctx.pipeline.store.put({ ...photo.rec, thumbBlob }).catch(() => {});
    const cur = await ctx.stores.entries.get(state.dateKey);
    await ctx.stores.entries.upsert(state.dateKey, { imageCrops: { ...(cur?.imageCrops ?? {}), [photo.id]: crop } });
    ctx.refreshToday?.();
  }

  els.cancel.onclick = close;

  // サムネイル: 保存して閉じる(続きの写真があれば次へ)
  els.save.onclick = async () => {
    if (!state || state.sel < 0) return;
    const { dateKey, queue, crop } = state;
    const photo = state.photos[state.sel];
    ctx.showLoading('サムネイルを保存中…');
    try {
      await saveCrop(photo, crop);
    } catch (err) {
      note(err?.message ?? 'サムネイルを保存できませんでした。');
      return;
    } finally {
      ctx.hideLoading();
    }
    ctx.notifySaved?.();
    if (queue.length > 0) await openThumb(dateKey, queue);
    else close();
  };

  // サムネイル: 保存して、その写真を選んだカード編集へ続ける
  els.cont.onclick = async () => {
    if (!state || state.sel < 0) return;
    const { dateKey, crop } = state;
    const photo = state.photos[state.sel];
    ctx.showLoading('サムネイルを保存中…');
    try {
      await saveCrop(photo, crop);
    } catch (err) {
      note(err?.message ?? 'サムネイルを保存できませんでした。');
      return;
    } finally {
      ctx.hideLoading();
    }
    const r = await open(dateKey, { photoId: photo.id });
    if (!r.opened) close();
  };

  els.share.onclick = async () => {
    if (!state) return;
    const { dateKey, tagNames, crop, theme, stickers } = state;
    const photo = state.sel >= 0 ? state.photos[state.sel] : null;
    ctx.showLoading('カードを作っています…');
    let result;
    try {
      // 写真の範囲はサムネイル画面で決めたものを使う(カード画面では変えない=PD FB 4)
      const png = await renderCard({ dateKey, tagNames, photoBlob: photo?.rec.blob ?? null, crop, theme, stickers, stampBitmaps: state.stampBitmaps });
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
    openThumb,
    close,
    // スモーク用(Web のみ appState 経由で参照)。シールの位置(カード座標px)を返す
    debugStickers: () => (state ? state.stickers.map((s) => ({ ...s, px: s.x * els.preview.width, py: s.y * els.preview.width })) : []),
    debugCrop: () => (state ? { ...state.crop } : null),
    debugMode: () => state?.mode ?? null,
    debugCardId: () => state?.cardId ?? null,
    // 選択中シールの回転つまみの位置(カード座標px)
    debugHandle: () => (state && state.selected >= 0 ? stickerHandlePoint(state.stickers[state.selected], els.preview.width) : null),
  };
}
