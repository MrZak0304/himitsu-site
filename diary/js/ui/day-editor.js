// 過去日の編集UI(タグ・本文・写真)。ふりかえりの日別詳細に埋め込み、ロックの内側で使う。
// 「きょう」の編集(today.js)と同じ保存ロジック(entries.upsert)を対象日付に対して行う。
// ロックの境界(不変条件3)を崩さないため、この編集はふりかえりパネル内にのみ置く。

import { acceptImages, normalizePushIndex, removeImageAt, MAX_IMAGES_PER_DAY } from '../core/image-rules.js';
import { UI_ICONS } from '../icons.js';
import { tr, formatLongDate } from '../i18n/index.js';
import { renderTagPalette } from './tag-palette.js';


export function createDayEditor(ctx, { onChange } = {}) {
  const $ = (id) => document.getElementById(id);
  const els = {
    dateNote: $('edit-date-note'),
    tags: $('edit-tags'),
    tagFolders: $('edit-tag-folders'),
    text: $('edit-text'),
    imageAdd: $('edit-image-add'),
    imageInput: $('edit-image-input'),
    imageNote: $('edit-image-note'),
    images: $('edit-images'),
    habits: $('edit-habits'),
    habitNote: $('edit-habit-note'),
  };
  let date = null;
  let urls = [];
  let renderSeq = 0;
  const openFolders = new Set(); // 開いているタグのフォルダ(最初は閉じる)

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
    const [entry, tags, folders, habits, checks] = await Promise.all([
      ctx.stores.entries.get(date),
      ctx.stores.tags.list({ includeHidden: false }), // 隠したタグは候補に出さない
      ctx.stores.tagFolders.list(),
      ctx.stores.habits.list(),
      ctx.stores.habitLogs.forDate(date),
    ]);
    if (seq !== renderSeq) return;

    const [y, m, d] = date.split('-').map(Number);
    els.dateNote.textContent = tr('{0}を編集中', formatLongDate(y, m, d));

    // タグスタンプ
    const on = new Set(entry?.tags ?? []);
    const makeStamp = (tag) => {
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
    };
    // きょうと同じく、フォルダごとにまとめる(v1.06 PD FB)
    renderTagPalette({ foldersEl: els.tagFolders, looseEl: els.tags, tags, folders, makeStamp, isOn: (t) => on.has(t.id), openFolders });

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
        push.title = tr('一押しにする');
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
        del.title = tr('削除');
        del.innerHTML = UI_ICONS.close;
        let confirming = false;
        let confirmTimer = null;
        const resetDel = () => {
          confirming = false;
          clearTimeout(confirmTimer);
          del.classList.remove('confirm');
          del.title = tr('削除');
          del.innerHTML = UI_ICONS.close;
        };
        del.onclick = async () => {
          if (!confirming) {
            confirming = true;
            del.classList.add('confirm');
            del.title = tr('もう一度タップで削除');
            del.textContent = tr('削除');
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
    note(els.imageNote, imageIds.length >= MAX_IMAGES_PER_DAY ? tr('画像は1日10枚までです。') : null);

    // 日課チェック(過去日も編集可。2026-08-14 PD FB)。当日の連続達成キャラ演出はしない。
    if (habits.length === 0) {
      els.habits.replaceChildren();
      note(els.habitNote, tr('日課はまだありません。「日課」タブから登録できます。'));
    } else {
      note(els.habitNote, null);
      els.habits.replaceChildren(
        ...habits.map((habit) => {
          const li = document.createElement('li');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = checks[habit.id] === true;
          cb.onchange = async () => {
            await ctx.stores.habitLogs.setChecked(date, habit.id, cb.checked);
            ctx.notifySaved?.();
            onChange?.();
          };
          const icon = document.createElement('span');
          icon.className = 'habit-icon';
          ctx.renderHabitIcon(icon, habit.icon);
          const name = document.createElement('span');
          name.className = 'habit-name';
          name.textContent = habit.name;
          li.append(cb, icon, name);
          return li;
        }),
      );
    }
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
    ctx.showLoading(tr('写真を保存中…'));
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
      els.habits.replaceChildren();
    },
  };
}
