// きょうタブ。当日の記録(タグ・本文・画像・日課チェック)をロックなしで登録・編集(R1)。

import { tagSlotInfo, slotStatusText } from '../core/tag-slots.js';
import { acceptImages, normalizePushIndex, removeImageAt, MAX_IMAGES_PER_DAY } from '../core/image-rules.js';
import { frequentTagIds } from '../core/tag-stats.js';
import { UI_ICONS } from '../icons.js';
import { requestRewarded } from '../ads.js';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function initToday(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    date: $('today-date'),
    frequentWrap: $('today-frequent-wrap'),
    frequent: $('today-frequent'),
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
      ctx.stores.tags.list({ includeHidden: false }), // 隠したタグは入力候補に出さない
      ctx.stores.habits.list(),
      ctx.stores.habitLogs.forDate(today),
      slotState(),
    ]);
    if (seq !== renderSeq) return; // より新しい refresh が始まっていたら破棄

    // タグスタンプ
    const on = new Set(entry?.tags ?? []);
    const byId = new Map(tags.map((t) => [t.id, t]));
    const toggleTag = async (tagId) => {
      const cur = (await ctx.stores.entries.get(today))?.tags ?? [];
      const next = cur.includes(tagId) ? cur.filter((id) => id !== tagId) : [...cur, tagId];
      await ctx.stores.entries.upsert(today, { tags: next });
      ctx.notifySaved?.();
      refresh();
    };
    const makeStamp = (tag) => {
      const b = document.createElement('button');
      b.className = `tag-stamp${on.has(tag.id) ? ' on' : ''}`;
      b.dataset.tagId = tag.id;
      b.textContent = tag.name;
      b.onclick = () => toggleTag(tag.id);
      return b;
    };
    els.tags.replaceChildren(...tags.map(makeStamp));

    // よく使うタグ(直近30日の頻出。hidden除外・すぐ押せる)。候補一覧に載っているものだけ。
    const allEntries = await ctx.stores.entries.all();
    const hiddenIds = new Set(); // 候補一覧(tags)は既に hidden 除外済みなので byId に無いものを弾く
    const freqIds = frequentTagIds(allEntries, today, { days: 30, limit: 6, hiddenTagIds: hiddenIds })
      .filter((id) => byId.has(id));
    if (freqIds.length > 0) {
      els.frequentWrap.hidden = false;
      els.frequent.replaceChildren(...freqIds.map((id) => makeStamp(byId.get(id))));
    } else {
      els.frequentWrap.hidden = true;
      els.frequent.replaceChildren();
    }

    // タグ枠(無料版): 残数と導線を常時表示する(2026-08-11 PD FB)。
    // いっぱいの時だけ隠す旧挙動をやめ、残りがある時も「あと〇個」を見せる。
    note(els.slotNote, slotStatusText(slots));
    if (slots.reason === null && slots.remaining !== 0) els.slotNote.classList.remove('slot-full');
    else els.slotNote.classList.toggle('slot-full', !slots.canAdd);
    // free では枠に余裕があっても「広告を見て+1」を出す(いっぱいになる前から導線が見える)
    els.watchAd.hidden = ctx.variant !== 'free';
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
          ctx.notifySaved?.();
          refresh();
        };
        // 写真の削除は全画面ポップアップを出さず、セル内の2段階タップで確認する
        // (×→「削除」に変わる。塗りつぶしの確認は重いというPD FB 2026-08-10)
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
            confirmTimer = setTimeout(resetDel, 3000); // 触らなければ元に戻る
            return;
          }
          resetDel();
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
              if (allDone) ctx.reactAllDone?.();
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
      ctx.notifySaved?.();
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
    const isNative = window.Capacitor?.isNativePlatform?.();
    ctx.showLoading(isNative ? '広告を読み込んでいます…' : '広告(ダミー)を視聴中…');
    let failReason = null;
    try {
      const r = await requestRewarded();
      if (r.ok) {
        const s = await ctx.stores.settings.get();
        await ctx.stores.settings.merge({ tagSlots: { ...s.tagSlots, earned: s.tagSlots.earned + 1 } });
      } else {
        failReason = r.reason;
      }
    } finally {
      ctx.hideLoading();
      // refresh() が枠の状況メッセージ(枠がいっぱいです…)で slotNote を上書きするため、
      // 「最後まで視聴すると増えます」等の理由はrefreshの後に出す(2026-08-10 PD実機報告)
      await refresh();
      if (failReason) note(els.slotNote, failReason);
    }
  };

  els.text.onchange = async () => {
    await ctx.stores.entries.upsert(ctx.todayKey(), { text: els.text.value });
    ctx.notifySaved?.();
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
      ctx.notifySaved?.();
    } catch (err) {
      note(els.imageNote, err.message);
    } finally {
      ctx.hideLoading();
      refresh();
    }
  };

  return { refresh };
}
