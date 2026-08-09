// きょうタブ。当日の記録(タグ・本文・画像・日課チェック)をロックなしで登録・編集(R1)。

import { tagSlotInfo } from '../core/tag-slots.js';
import { acceptImages, normalizePushIndex, removeImageAt, MAX_IMAGES_PER_DAY } from '../core/image-rules.js';
import { UI_ICONS } from '../icons.js';
import { requestRewarded } from '../ads.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function initToday(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    date: $('today-date'),
    tags: $('today-tags'),
    slotNote: $('tag-slot-note'),
    tagInput: $('new-tag-input'),
    tagAdd: $('new-tag-add'),
    watchAd: $('watch-ad-btn'),
    text: $('today-text'),
    imageAdd: $('image-add-btn'),
    imageInput: $('image-input'),
    imageNote: $('image-note'),
    images: $('today-images'),
    habits: $('today-habits'),
    habitNote: $('today-habit-note'),
  };
  let urls = [];
  let renderSeq = 0; // 連続操作時に古い描画が新しい描画を上書きしないための世代トークン

  function note(el, message) {
    el.hidden = !message;
    el.textContent = message ?? '';
  }

  async function slotState() {
    const settings = await ctx.stores.settings.get();
    const count = await ctx.stores.tags.userTagCount();
    return tagSlotInfo(settings.tagSlots, ctx.variant, count);
  }

  async function refresh() {
    renderSeq += 1;
    const seq = renderSeq;
    const today = ctx.todayKey();
    const now = new Date();
    els.date.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日(${WEEKDAYS[now.getDay()]})`;

    const [entry, tags, habits, checks, slots] = await Promise.all([
      ctx.stores.entries.get(today),
      ctx.stores.tags.list(),
      ctx.stores.habits.list(),
      ctx.stores.habitLogs.forDate(today),
      slotState(),
    ]);
    if (seq !== renderSeq) return; // より新しい refresh が始まっていたら破棄

    // タグスタンプ
    const on = new Set(entry?.tags ?? []);
    els.tags.replaceChildren(
      ...tags.map((tag) => {
        const b = document.createElement('button');
        b.className = `tag-stamp${on.has(tag.id) ? ' on' : ''}`;
        b.dataset.tagId = tag.id;
        b.textContent = tag.name;
        b.onclick = async () => {
          const cur = (await ctx.stores.entries.get(today))?.tags ?? [];
          const next = cur.includes(tag.id) ? cur.filter((id) => id !== tag.id) : [...cur, tag.id];
          await ctx.stores.entries.upsert(today, { tags: next });
          refresh();
        };
        return b;
      }),
    );

    // タグ枠(無料版)
    note(els.slotNote, slots.canAdd ? null : slots.reason);
    els.watchAd.hidden = !(ctx.variant === 'free' && !slots.canAdd);
    els.tagAdd.disabled = !slots.canAdd;

    // 本文
    if (document.activeElement !== els.text) els.text.value = entry?.text ?? '';

    // 画像
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
          await ctx.stores.entries.upsert(today, { pushImageIndex: idx });
          refresh();
        };
        const del = document.createElement('button');
        del.className = 'del-btn';
        del.title = '削除';
        del.innerHTML = UI_ICONS.close;
        del.onclick = async () => {
          if (!(await ctx.confirm('この写真を削除しますか?'))) return;
          const cur = await ctx.stores.entries.get(today);
          const r = removeImageAt(cur.images, cur.pushImageIndex, idx);
          await ctx.stores.entries.upsert(today, { images: r.images, pushImageIndex: r.pushIndex });
          await ctx.pipeline.store.remove(id).catch(() => {});
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
    for (const u of urls) URL.revokeObjectURL(u);
    urls = newUrls;
    els.images.replaceChildren(...cells);
    els.imageAdd.disabled = imageIds.length >= MAX_IMAGES_PER_DAY;
    if (imageIds.length >= MAX_IMAGES_PER_DAY) note(els.imageNote, '画像は1日10枚までです。');
    else note(els.imageNote, null);

    // 日課チェック
    if (habits.length === 0) {
      els.habits.replaceChildren();
      els.habitNote.hidden = false;
      els.habitNote.style.color = 'var(--text-dim)';
      els.habitNote.textContent = '日課はまだありません。「日課」タブから登録しましょう。';
    } else {
      els.habitNote.hidden = true;
      els.habits.replaceChildren(
        ...habits.map((habit) => {
          const li = document.createElement('li');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = checks[habit.id] === true;
          cb.dataset.habitId = habit.id;
          cb.onchange = async () => {
            await ctx.stores.habitLogs.setChecked(today, habit.id, cb.checked);
            if (cb.checked) {
              const after = await ctx.stores.habitLogs.forDate(today);
              const allDone = habits.every((h) => after[h.id] === true);
              if (allDone) ctx.reactCharacter('全部達成!えらい!');
            }
            ctx.refreshHabits?.();
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

  // タグ追加(その場)
  els.tagAdd.onclick = async () => {
    let name = els.tagInput.value.trim();
    if (!name) return;
    if (!name.startsWith('#')) name = `#${name}`;
    const slots = await slotState();
    if (!slots.canAdd) {
      note(els.slotNote, slots.reason);
      return;
    }
    try {
      const tag = await ctx.stores.tags.add(name);
      const today = ctx.todayKey();
      const cur = (await ctx.stores.entries.get(today))?.tags ?? [];
      await ctx.stores.entries.upsert(today, { tags: [...cur, tag.id] });
      els.tagInput.value = '';
      refresh();
    } catch (err) {
      note(els.slotNote, err.message);
    }
  };
  els.tagInput.onkeydown = (e) => {
    if (e.key === 'Enter') els.tagAdd.click();
  };

  // リワード(Webはダミー視聴)→枠+1(恒久)
  els.watchAd.onclick = async () => {
    ctx.showLoading('広告(ダミー)を視聴中…');
    try {
      const r = await requestRewarded();
      if (r.ok) {
        const s = await ctx.stores.settings.get();
        await ctx.stores.settings.merge({ tagSlots: { ...s.tagSlots, earned: s.tagSlots.earned + 1 } });
        note(els.slotNote, null);
      } else {
        note(els.slotNote, r.reason);
      }
    } finally {
      ctx.hideLoading();
      refresh();
    }
  };

  els.text.onchange = async () => {
    await ctx.stores.entries.upsert(ctx.todayKey(), { text: els.text.value });
  };

  // 画像添付
  els.imageAdd.onclick = () => els.imageInput.click();
  els.imageInput.onchange = async () => {
    const files = [...els.imageInput.files];
    els.imageInput.value = '';
    if (files.length === 0) return;
    const today = ctx.todayKey();
    const current = (await ctx.stores.entries.get(today))?.images ?? [];
    const verdict = acceptImages(current.length, files.length);
    if (verdict.reason) note(els.imageNote, verdict.reason);
    if (verdict.accepted === 0) return;
    ctx.showLoading('写真を保存中…');
    try {
      for (const file of files.slice(0, verdict.accepted)) {
        // IDB put の完了後に entry を更新する(逆順禁止)。失敗時は当該画像のみ通知。
        const { id } = await ctx.pipeline.saveImage(file, 'entry');
        const cur = await ctx.stores.entries.get(today);
        const images = [...(cur?.images ?? []), id];
        await ctx.stores.entries.upsert(today, {
          images,
          pushImageIndex: normalizePushIndex(images, cur?.pushImageIndex ?? null),
        });
      }
    } catch (err) {
      note(els.imageNote, err.message);
    } finally {
      ctx.hideLoading();
      refresh();
    }
  };

  return { refresh };
}
