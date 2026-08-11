// 過去日の編集UI(タグ・本文・写真)。ふりかえりの日別詳細に埋め込み、ロックの内側で使う。
// 「きょう」の編集(today.js)と同じ保存ロジック(entries.upsert)を対象日付に対して行う。
// ロックの境界(不変条件3)を崩さないため、この編集はふりかえりパネル内にのみ置く。

import { acceptImages, normalizePushIndex, removeImageAt, MAX_IMAGES_PER_DAY } from '../core/image-rules.js';
import { UI_ICONS } from '../icons.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function createDayEditor(ctx, { onChange } = {}) {
  const $ = (id) => document.getElementById(id);
  const els = {
    dateNote: $('edit-date-note'),
    tags: $('edit-tags'),
    text: $('edit-text'),
    imageAdd: $('edit-image-add'),
    imageInput: $('edit-image-input'),
    imageNote: $('edit-image-note'),
    images: $('edit-images'),
  };
  let date = null;
  let urls = [];
  let renderSeq = 0;

  function note(el, message) {
    el.hidden = !message;
    el.textContent = message ?? '';
  }

  function revoke() {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
  }

  async function refresh() {
    if (!date) return;
    renderSeq += 1;
    const seq = renderSeq;
    const [entry, tags] = await Promise.all([
      ctx.stores.entries.get(date),
      ctx.stores.tags.list({ includeHidden: false }), // 隠したタグは候補に出さない
    ]);
    if (seq !== renderSeq) return;

    const [y, m, d] = date.split('-').map(Number);
    const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
    els.dateNote.textContent = `${y}年${m}月${d}日(${wd})を編集中`;

    // タグスタンプ
    const on = new Set(entry?.tags ?? []);
    els.tags.replaceChildren(
      ...tags.map((tag) => {
        const b = document.createElement('button');
        b.className = `tag-stamp${on.has(tag.id) ? ' on' : ''}`;
        b.textContent = tag.name;
        b.onclick = async () => {
          const cur = (await ctx.stores.entries.get(date))?.tags ?? [];
          const next = cur.includes(tag.id) ? cur.filter((id) => id !== tag.id) : [...cur, tag.id];
          await ctx.stores.entries.upsert(date, { tags: next });
          ctx.notifySaved?.();
          onChange?.();
          refresh();
        };
        return b;
      }),
    );

    // 本文
    if (document.activeElement !== els.text) els.text.value = entry?.text ?? '';

    // 写真
    const imageIds = entry?.images ?? [];
    const pushIdx = normalizePushIndex(imageIds, entry?.pushImageIndex ?? null);
    const newUrls = [];
    const cells = await Promise.all(
      imageIds.map(async (id, idx) => {
        const rec = await ctx.pipeline.store.get(id);
        const cell = document.createElement('div');
        cell.className = 'image-cell';
        if (rec?.thumbBlob) {
          const url = URL.createObjectURL(rec.thumbBlob);
          newUrls.push(url);
          const img = document.createElement('img');
          img.src = url;
          img.alt = '';
          cell.append(img);
        }
        const push = document.createElement('button');
        push.className = `push-btn${idx === pushIdx ? ' on' : ''}`;
        push.title = '一押しにする';
        push.innerHTML = idx === pushIdx ? UI_ICONS.starFill : UI_ICONS.star;
        push.onclick = async () => {
          await ctx.stores.entries.upsert(date, { pushImageIndex: idx });
          ctx.notifySaved?.();
          onChange?.();
          refresh();
        };
        // 削除は「きょう」と同じセル内2段階タップ(全画面ポップアップを出さない)
        const del = document.createElement('button');
        del.className = 'del-btn';
        del.title = '削除';
        del.innerHTML = UI_ICONS.close;
        let confirming = false;
        let confirmTimer = null;
        const resetDel = () => {
          confirming = false;
          clearTimeout(confirmTimer);
          del.classList.remove('confirm');
          del.title = '削除';
          del.innerHTML = UI_ICONS.close;
        };
        del.onclick = async () => {
          if (!confirming) {
            confirming = true;
            del.classList.add('confirm');
            del.title = 'もう一度タップで削除';
            del.textContent = '削除';
            confirmTimer = setTimeout(resetDel, 3000);
            return;
          }
          resetDel();
          const cur = await ctx.stores.entries.get(date);
          const r = removeImageAt(cur.images, cur.pushImageIndex, idx);
          await ctx.stores.entries.upsert(date, { images: r.images, pushImageIndex: r.pushIndex });
          await ctx.pipeline.store.remove(id).catch(() => {});
          onChange?.();
          refresh();
        };
        cell.append(push, del);
        return cell;
      }),
    );
    if (seq !== renderSeq) {
      for (const u of newUrls) URL.revokeObjectURL(u);
      return;
    }
    revoke();
    urls = newUrls;
    els.images.replaceChildren(...cells);
    els.imageAdd.disabled = imageIds.length >= MAX_IMAGES_PER_DAY;
    note(els.imageNote, imageIds.length >= MAX_IMAGES_PER_DAY ? '画像は1日10枚までです。' : null);
  }

  els.text.onchange = async () => {
    if (!date) return;
    await ctx.stores.entries.upsert(date, { text: els.text.value });
    ctx.notifySaved?.();
    onChange?.();
  };

  els.imageAdd.onclick = () => els.imageInput.click();
  els.imageInput.onchange = async () => {
    const files = [...els.imageInput.files];
    els.imageInput.value = '';
    if (files.length === 0 || !date) return;
    const current = (await ctx.stores.entries.get(date))?.images ?? [];
    const verdict = acceptImages(current.length, files.length);
    if (verdict.reason) note(els.imageNote, verdict.reason);
    if (verdict.accepted === 0) return;
    ctx.showLoading('写真を保存中…');
    try {
      for (const file of files.slice(0, verdict.accepted)) {
        const { id } = await ctx.pipeline.saveImage(file, 'entry');
        const cur = await ctx.stores.entries.get(date);
        const images = [...(cur?.images ?? []), id];
        await ctx.stores.entries.upsert(date, {
          images,
          pushImageIndex: normalizePushIndex(images, cur?.pushImageIndex ?? null),
        });
      }
      ctx.notifySaved?.();
      onChange?.();
    } catch (err) {
      note(els.imageNote, err.message);
    } finally {
      ctx.hideLoading();
      refresh();
    }
  };

  return {
    async open(d) {
      date = d;
      await refresh();
    },
    close() {
      date = null;
      revoke();
      els.tags.replaceChildren();
      els.images.replaceChildren();
    },
  };
}
