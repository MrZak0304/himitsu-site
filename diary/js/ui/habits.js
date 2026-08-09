// 日課タブ(R5〜R7)+キャラクターレイヤ。
// キャラクターの選択肢は初期5種+ユーザーが保存したキャラクターの一覧(2026-08-09 PD FB)。

import { streak } from '../core/streaks.js';
import { hasEntryContent } from '../core/calendar.js';
import { HABIT_ICONS, HABIT_ICON_LABELS, UI_ICONS } from '../icons.js';
import { CHARACTERS } from '../characters.js';

export function initHabits(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    diaryStreak: $('diary-streak-days'),
    list: $('habit-list'),
    nameInput: $('habit-name-input'),
    iconTabs: document.querySelectorAll('.icon-tab'),
    paneBuiltin: $('icon-pane-builtin'),
    paneEmoji: $('icon-pane-emoji'),
    paneImage: $('icon-pane-image'),
    emojiInput: $('habit-emoji-input'),
    imageBtn: $('habit-image-btn'),
    imageInput: $('habit-image-input'),
    imageChosen: $('habit-image-chosen'),
    note: $('habit-note'),
    addBtn: $('habit-add-btn'),
    layer: $('character-layer'),
    figure: $('character-figure'),
    balloon: $('character-balloon'),
  };
  let iconTab = 'builtin';
  let builtinChoice = 'run';
  let imageFile = null;
  let charUrl = null;
  let reactTimer = null;
  let balloonTimer = null;
  let renderSeq = 0; // 古い描画が新しい描画を上書きしないための世代トークン

  function note(message) {
    els.note.hidden = !message;
    els.note.textContent = message ?? '';
  }

  // --- 追加フォームのアイコン選択 ---
  function renderBuiltinGrid() {
    const grid = document.createElement('div');
    grid.className = 'icon-grid';
    for (const [key, svg] of Object.entries(HABIT_ICONS)) {
      const b = document.createElement('button');
      b.className = `icon-choice${key === builtinChoice ? ' on' : ''}`;
      b.innerHTML = svg;
      b.title = HABIT_ICON_LABELS[key] ?? key;
      b.onclick = () => {
        builtinChoice = key;
        renderBuiltinGrid();
      };
      grid.append(b);
    }
    els.paneBuiltin.replaceChildren(grid);
  }
  renderBuiltinGrid();

  for (const tab of els.iconTabs) {
    tab.onclick = () => {
      iconTab = tab.dataset.iconTab;
      for (const t of els.iconTabs) t.classList.toggle('active', t === tab);
      els.paneBuiltin.hidden = iconTab !== 'builtin';
      els.paneEmoji.hidden = iconTab !== 'emoji';
      els.paneImage.hidden = iconTab !== 'image';
    };
  }

  els.imageBtn.onclick = () => els.imageInput.click();
  els.imageInput.onchange = () => {
    imageFile = els.imageInput.files[0] ?? null;
    els.imageChosen.textContent = imageFile ? imageFile.name : '';
  };

  els.addBtn.onclick = async () => {
    const name = els.nameInput.value.trim();
    if (!name) {
      note('日課の名前を入力してください。');
      return;
    }
    let icon;
    try {
      if (iconTab === 'builtin') {
        icon = { type: 'builtin', value: builtinChoice };
      } else if (iconTab === 'emoji') {
        const emoji = els.emojiInput.value.trim();
        if (!emoji) {
          note('絵文字を1つ入力してください。');
          return;
        }
        icon = { type: 'emoji', value: emoji };
      } else {
        if (!imageFile) {
          note('アイコンにする画像を選んでください。');
          return;
        }
        ctx.showLoading('画像を保存中…');
        const { id } = await ctx.pipeline.saveImage(imageFile, 'icon');
        ctx.hideLoading();
        icon = { type: 'image', value: id };
      }
      await ctx.stores.habits.add(name, icon);
      els.nameInput.value = '';
      els.emojiInput.value = '';
      els.imageChosen.textContent = '';
      imageFile = null;
      note(null);
      refresh();
      ctx.refreshToday?.();
    } catch (err) {
      ctx.hideLoading();
      note(err.message);
    }
  };

  // --- 一覧 ---
  async function refresh() {
    renderSeq += 1;
    const seq = renderSeq;
    const today = ctx.todayKey();
    const [habits, entries] = await Promise.all([ctx.stores.habits.list(), ctx.stores.entries.all()]);
    if (seq !== renderSeq) return;

    const diaryDates = new Set(Object.keys(entries).filter((d) => hasEntryContent(entries[d])));
    els.diaryStreak.textContent = streak(diaryDates, today);

    const rows = await Promise.all(
      habits.map(async (habit, i) => {
        const li = document.createElement('li');
        const icon = document.createElement('span');
        icon.className = 'habit-icon';
        ctx.renderHabitIcon(icon, habit.icon);
        const name = document.createElement('span');
        name.className = 'habit-name';
        name.textContent = habit.name;
        const days = streak(await ctx.stores.habitLogs.checkedDates(habit.id), today);
        const st = document.createElement('span');
        st.className = 'habit-streak';
        st.textContent = `連続${days}日`;

        const rename = document.createElement('button');
        rename.className = 'mini-btn';
        rename.textContent = '改名';
        rename.onclick = () => {
          const input = document.createElement('input');
          input.type = 'text';
          input.value = habit.name;
          input.maxLength = 20;
          const save = async () => {
            const v = input.value.trim();
            if (v) await ctx.stores.habits.update(habit.id, { name: v });
            refresh();
            ctx.refreshToday?.();
          };
          input.onkeydown = (e) => {
            if (e.key === 'Enter') input.blur();
          };
          input.onblur = save;
          name.replaceWith(input);
          input.focus();
        };

        const up = document.createElement('button');
        up.className = 'mini-btn';
        up.innerHTML = UI_ICONS.up;
        up.title = '上へ';
        up.disabled = i === 0;
        const down = document.createElement('button');
        down.className = 'mini-btn';
        down.innerHTML = UI_ICONS.down;
        down.title = '下へ';
        down.disabled = i === habits.length - 1;
        up.onclick = async () => {
          const ids = habits.map((h) => h.id);
          [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
          await reorderHabits(ids);
        };
        down.onclick = async () => {
          const ids = habits.map((h) => h.id);
          [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]];
          await reorderHabits(ids);
        };

        // 削除は2段階クリック(誤タップ対策)
        const del = document.createElement('button');
        del.className = 'mini-btn';
        del.textContent = '削除';
        let armed = false;
        del.onclick = async () => {
          if (!armed) {
            armed = true;
            del.textContent = 'もう一度押すと削除';
            del.classList.add('danger');
            setTimeout(() => {
              armed = false;
              del.textContent = '削除';
              del.classList.remove('danger');
            }, 3000);
            return;
          }
          await ctx.stores.habits.remove(habit.id);
          refresh();
          ctx.refreshToday?.();
        };

        li.append(icon, name, st, rename, up, down, del);
        return li;
      }),
    );
    if (seq !== renderSeq) return;
    els.list.replaceChildren(...rows);
    renderCharacter();
  }

  async function reorderHabits(ids) {
    const list = await ctx.stores.habits.list();
    const byId = new Map(list.map((h) => [h.id, h]));
    await ctx.stores.habits.replaceAll(ids.map((id, order) => ({ ...byId.get(id), order })));
    refresh();
    ctx.refreshToday?.();
  }

  // --- キャラクターレイヤ(きょう・日課タブに表示) ---
  async function renderCharacter() {
    const settings = await ctx.stores.settings.get();
    els.layer.classList.toggle('pos-left', settings.character.position === 'left');
    if (charUrl) {
      URL.revokeObjectURL(charUrl);
      charUrl = null;
    }
    if (settings.character.type === 'custom') {
      const rec = await ctx.pipeline.store.get(settings.character.value);
      if (rec?.blob) {
        charUrl = URL.createObjectURL(rec.blob);
        els.figure.innerHTML = `<img src="${charUrl}" alt="">`;
        return;
      }
    }
    const c = CHARACTERS[settings.character.value] ?? CHARACTERS.cat;
    els.figure.innerHTML = c.svg('neutral');
  }

  // 選択中のユーザー保存キャラ(表情差分の参照用)
  async function currentCustomChar() {
    const s = await ctx.stores.settings.get();
    if (s.character.type !== 'custom') return null;
    return s.customCharacters.find((c) => c.id === s.character.value) ?? null;
  }

  // リアクション中だけ表情差分へ切り替え、少ししてニュートラルへ戻す。
  // 内蔵キャラはSVGの表情差分、ユーザー保存キャラは登録済みの表情画像を使う。
  let exprTimer = null;
  async function swapExpression(key) {
    const s = await ctx.stores.settings.get();
    if (s.character.type === 'custom') {
      const char = s.customCharacters.find((c) => c.id === s.character.value);
      const imgId = char?.expressions?.[key];
      if (!imgId) return; // 差分未登録ならニュートラルのままジャンプのみ
      const rec = await ctx.pipeline.store.get(imgId);
      if (!rec?.blob) return;
      if (charUrl) URL.revokeObjectURL(charUrl);
      charUrl = URL.createObjectURL(rec.blob);
      els.figure.innerHTML = `<img src="${charUrl}" alt="">`;
    } else {
      const c = CHARACTERS[s.character.value] ?? CHARACTERS.cat;
      els.figure.innerHTML = c.svg(key);
    }
    clearTimeout(exprTimer);
    exprTimer = setTimeout(() => renderCharacter(), 2200);
  }

  // タップでリアクション(2026-08-09 PD FB)。表情に合ったセリフを出す
  const TAP_MESSAGES = {
    joy: ['やっほー!', 'えへへ', 'きょうも書いてえらい!'],
    anger: ['むぅ!', 'ぷんぷん!'],
    sorrow: ['しょんぼり…', 'よしよしして…'],
    fun: ['るんるん♪', 'たのしい〜!', 'いっしょにがんばろう!'],
  };
  els.figure.onclick = async () => {
    const s = await ctx.stores.settings.get();
    let keys = ['joy', 'anger', 'sorrow', 'fun'];
    if (s.character.type === 'custom') {
      const char = s.customCharacters.find((c) => c.id === s.character.value);
      const registered = Object.keys(char?.expressions ?? {});
      if (registered.length > 0) keys = registered;
      else keys = ['joy'];
    }
    const key = keys[Math.floor(Math.random() * keys.length)];
    const messages = TAP_MESSAGES[key] ?? TAP_MESSAGES.joy;
    reactCharacter(messages[Math.floor(Math.random() * messages.length)], key);
  };

  function reactCharacter(message, expressionKey = 'joy') {
    swapExpression(expressionKey);
    els.figure.classList.remove('react');
    // 再アニメーションのためリフローを挟む(transform/opacityのみのアニメ)
    void els.figure.offsetWidth;
    els.figure.classList.add('react');
    clearTimeout(reactTimer);
    reactTimer = setTimeout(() => els.figure.classList.remove('react'), 2000);
    if (message) {
      els.balloon.textContent = message;
      els.balloon.hidden = false;
      clearTimeout(balloonTimer);
      balloonTimer = setTimeout(() => {
        els.balloon.hidden = true;
      }, 2600);
    }
  }

  return { refresh, renderCharacter, reactCharacter };
}
