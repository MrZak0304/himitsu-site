// 日課タブ(R5〜R7)+キャラクターレイヤ。
// キャラクターの選択肢は初期5種+ユーザーが保存したキャラクターの一覧(2026-08-09 PD FB)。

import { streak } from '../core/streaks.js';
import { hasEntryContent } from '../core/calendar.js';
import { HABIT_ICONS, HABIT_ICON_LABELS, UI_ICONS } from '../icons.js';
import { CHARACTERS } from '../characters.js';
import { tr } from '../i18n/index.js';
import { createHabitStampPicker } from './habit-stamp-picker.js';
import { defaultHabitName, habitNameShown } from '../core/habit-stats.js';

export function initHabits(ctx) {
  const $ = (id) => document.getElementById(id);
  const els = {
    diaryStreak: $('diary-streak-days'),
    diaryStreakUnit: $('diary-streak-unit'),
    list: $('habit-list'),
    nameInput: $('habit-name-input'),
    nameIcon: $('habit-name-icon'),
    iconTabs: document.querySelectorAll('.icon-tab'),
    paneBuiltin: $('icon-pane-builtin'),
    imageInput: $('habit-image-input'),
    note: $('habit-note'),
    addBtn: $('habit-add-btn'),
    addStamp: $('habit-add-stamp'),
    layer: $('character-layer'),
    figure: $('character-figure'),
    balloon: $('character-balloon'),
  };
  // 選んでいるアイコン(2026-10-28 開発リードの家族の FB): アイコン/絵文字/画像のどれか 1 つ。名前の欄の左に出す
  let iconTab = 'builtin';
  let builtinChoice = 'run';
  let emojiChoice = '';
  let imageFile = null;
  let imageUrl = null;
  let charUrl = null;
  let reactTimer = null;
  let balloonTimer = null;
  let renderSeq = 0; // 古い描画が新しい描画を上書きしないための世代トークン
  let editOpenId = null; // 「編集」を開いている日課(一覧を描き直しても開いたままにする)

  // 「日課を追加」の欄のスタンプの見た目(2026-10-26 PD 回答)。触ったときだけ日課に保存する
  // (触らなければ設定なし=カードで前回選んだ形・色から始まる)
  let addStamp = null;
  const addPicker = createHabitStampPicker({
    stamp: null,
    variant: ctx.variant,
    getName: () => els.nameInput.value.trim() || defaultHabitName(currentIcon(), HABIT_ICON_LABELS, tr('日課')),
    onChange: (st) => {
      addStamp = st;
    },
  });
  els.addStamp.replaceChildren(addPicker.el);
  els.nameInput.addEventListener('input', () => addPicker.update());

  function note(message) {
    els.note.hidden = !message;
    els.note.textContent = message ?? '';
  }

  // --- 追加フォームのアイコン選択 ---
  // アイコン・絵文字(🎉▾)・画像のどれを選んでも、名前の欄の左に入る。名前は書いても書かなくても追加できる
  // (書かなければ defaultHabitName。2026-10-28 開発リードの家族の FB)
  function currentIcon() {
    if (iconTab === 'emoji') return { type: 'emoji', value: emojiChoice };
    if (iconTab === 'image') return { type: 'image', value: '' };
    return { type: 'builtin', value: builtinChoice };
  }

  function showChosenIcon() {
    for (const t of els.iconTabs) t.classList.toggle('active', t.dataset.iconTab === iconTab);
    els.paneBuiltin.hidden = iconTab !== 'builtin';
    if (iconTab === 'image') {
      const img = document.createElement('img');
      img.alt = '';
      img.src = imageUrl;
      els.nameIcon.replaceChildren(img);
    } else {
      ctx.renderHabitIcon(els.nameIcon, currentIcon());
    }
    addPicker.update();
  }

  function renderBuiltinGrid() {
    const grid = document.createElement('div');
    grid.className = 'icon-grid';
    for (const [key, svg] of Object.entries(HABIT_ICONS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `icon-choice${key === builtinChoice ? ' on' : ''}`;
      b.dataset.icon = key;
      b.innerHTML = svg;
      b.title = HABIT_ICON_LABELS[key] ?? key;
      b.setAttribute('aria-label', HABIT_ICON_LABELS[key] ?? key);
      b.onclick = () => {
        builtinChoice = key;
        iconTab = 'builtin';
        renderBuiltinGrid();
        showChosenIcon();
      };
      grid.append(b);
    }
    els.paneBuiltin.replaceChildren(grid);
  }
  renderBuiltinGrid();

  for (const tab of els.iconTabs) {
    tab.onclick = async () => {
      const kind = tab.dataset.iconTab;
      if (kind === 'builtin') {
        iconTab = 'builtin';
        showChosenIcon();
      } else if (kind === 'emoji') {
        // 「🎉▾」: タグ・できごとと同じ絵文字のポップアップから選ぶ
        const emoji = await ctx.emojiPicker.pick();
        if (!emoji) return;
        emojiChoice = emoji;
        iconTab = 'emoji';
        showChosenIcon();
      } else {
        els.imageInput.click();
      }
    };
  }

  els.imageInput.onchange = () => {
    const file = els.imageInput.files[0] ?? null;
    els.imageInput.value = '';
    if (!file) return;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageFile = file;
    imageUrl = URL.createObjectURL(file);
    iconTab = 'image';
    showChosenIcon();
  };

  function resetAddForm() {
    els.nameInput.value = '';
    addStamp = null;
    emojiChoice = '';
    imageFile = null;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = null;
    iconTab = 'builtin';
    showChosenIcon();
  }
  showChosenIcon();

  els.addBtn.onclick = async () => {
    let icon;
    try {
      if (iconTab === 'image') {
        ctx.showLoading(tr('画像を保存中…'));
        const { id } = await ctx.pipeline.saveImage(imageFile, 'icon');
        ctx.hideLoading();
        icon = { type: 'image', value: id };
      } else {
        icon = currentIcon();
      }
      const name = els.nameInput.value.trim() || defaultHabitName(icon, HABIT_ICON_LABELS, tr('日課'));
      await ctx.stores.habits.add(name, icon, addStamp);
      resetAddForm();
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
    const days = streak(diaryDates, today);
    els.diaryStreak.textContent = days;
    // 単位は「{0}日」の訳から数字を除いたもの(英語・スペイン語は 1 のとき単数: 1 day / 1 día)。どの言語も数字が先頭に来る
    els.diaryStreakUnit.textContent = tr('{0}日', days).slice(String(days).length);

    const rows = await Promise.all(
      habits.map(async (habit, i) => {
        const li = document.createElement('li');
        const icon = document.createElement('span');
        icon.className = 'habit-icon';
        ctx.renderHabitIcon(icon, habit.icon);
        const name = document.createElement('span');
        name.className = 'habit-name';
        name.textContent = habitNameShown(habit);
        const days = streak(await ctx.stores.habitLogs.checkedDates(habit.id), today);
        const st = document.createElement('span');
        st.className = 'habit-streak';
        st.textContent = tr('連続{0}日', days);

        // 「編集」: 名前とスタンプの見た目をまとめて直す(2026-10-26 PD 実機確認: 行の「スタンプ」は冗長なので
        // 「改名」を「編集」にまとめる)。押すと行の下に開き、「保存」で反映する
        const edit = document.createElement('button');
        edit.className = `mini-btn${editOpenId === habit.id ? ' on' : ''}`;
        edit.textContent = tr('編集');
        edit.setAttribute('aria-expanded', editOpenId === habit.id ? 'true' : 'false');
        edit.onclick = () => {
          editOpenId = editOpenId === habit.id ? null : habit.id;
          refresh();
        };

        const up = document.createElement('button');
        up.className = 'mini-btn';
        up.innerHTML = UI_ICONS.up;
        up.title = tr('上へ');
        up.disabled = i === 0;
        const down = document.createElement('button');
        down.className = 'mini-btn';
        down.innerHTML = UI_ICONS.down;
        down.title = tr('下へ');
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
        del.textContent = tr('削除');
        let armed = false;
        del.onclick = async () => {
          if (!armed) {
            armed = true;
            del.textContent = tr('もう一度押すと削除');
            del.classList.add('danger');
            setTimeout(() => {
              armed = false;
              del.textContent = tr('削除');
              del.classList.remove('danger');
            }, 3000);
            return;
          }
          await ctx.stores.habits.remove(habit.id);
          refresh();
          ctx.refreshToday?.();
        };

        const actions = document.createElement('span');
        actions.className = 'habit-actions'; // ボタンはまとめて折り返す(文言の長い言語で 1 行に収まらないとき)
        actions.append(edit, up, down, del);
        li.append(icon, name, st, actions);
        if (editOpenId !== habit.id) return [li];
        return [li, buildEditor(habit, days)];
      }),
    );
    if (seq !== renderSeq) return;
    els.list.replaceChildren(...rows.flat());
    renderCharacter();
  }

  // 日課の「編集」: 名前+スタンプの見た目(形・色。色は買い切り版だけ)。「保存」で反映、「やめる」で閉じる
  function buildEditor(habit, days) {
    const editor = document.createElement('li');
    editor.className = 'habit-stamp-editor';
    editor.dataset.habitId = habit.id;
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'habit-edit-name';
    nameInput.value = habit.name;
    nameInput.maxLength = 20;
    nameInput.placeholder = tr('日課の名前(例: 運動)');
    const stampHint = document.createElement('p');
    stampHint.className = 'section-hint';
    stampHint.textContent = tr('スタンプ');
    let stamp = habit.stamp ?? null;
    const picker = createHabitStampPicker({
      stamp,
      variant: ctx.variant,
      getName: () => nameInput.value.trim() || habit.name,
      getCount: () => Math.max(days, 1),
      onChange: (st) => {
        stamp = st;
      },
    });
    nameInput.addEventListener('input', () => picker.update());
    const editNote = document.createElement('p');
    editNote.className = 'note';
    editNote.hidden = true;
    const save = document.createElement('button');
    save.className = 'btn';
    save.type = 'button';
    save.textContent = tr('保存');
    save.onclick = async () => {
      const v = nameInput.value.trim();
      if (!v) {
        editNote.hidden = false;
        editNote.textContent = tr('日課の名前を入力してください。');
        return;
      }
      const patch = { name: v };
      if (stamp) patch.stamp = stamp;
      await ctx.stores.habits.update(habit.id, patch);
      editOpenId = null;
      refresh();
      ctx.refreshToday?.();
    };
    const cancel = document.createElement('button');
    cancel.className = 'btn sub';
    cancel.type = 'button';
    cancel.textContent = tr('やめる');
    cancel.onclick = () => {
      editOpenId = null;
      refresh();
    };
    const buttons = document.createElement('div');
    buttons.className = 'habit-edit-actions';
    buttons.append(save, cancel);
    editor.append(nameInput, stampHint, picker.el, editNote, buttons);
    return editor;
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
    // キャラクターOFF時はレイヤごと非表示(タブ切替の表示指定より優先=CSSの !important)
    els.layer.classList.toggle('char-off', settings.character.enabled === false);
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

  // タップでリアクション(2026-08-09 PD FB)。表情に合ったセリフを出す。
  // セリフは設定(settings.characterLines)から編集できる(2026-08-10 PD FB)
  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  els.figure.onclick = async () => {
    const s = await ctx.stores.settings.get();
    let keys = ['joy', 'anger', 'sorrow', 'fun'];
    if (s.character.type === 'custom') {
      const char = s.customCharacters.find((c) => c.id === s.character.value);
      const registered = Object.keys(char?.expressions ?? {});
      if (registered.length > 0) keys = registered;
      else keys = ['joy'];
    }
    const key = pick(keys);
    reactCharacter(pick(s.characterLines[key] ?? s.characterLines.joy), key);
  };

  // 日課の全達成リアクション(セリフは設定から編集可)
  async function reactAllDone() {
    const s = await ctx.stores.settings.get();
    reactCharacter(pick(s.characterLines.allDone), 'joy');
  }

  // 吹き出しだけ出す(ジャンプなし。保存確認などの控えめな一言用)
  function sayLine(message) {
    els.balloon.textContent = message;
    els.balloon.hidden = false;
    clearTimeout(balloonTimer);
    balloonTimer = setTimeout(() => {
      els.balloon.hidden = true;
    }, 2600);
  }

  function reactCharacter(message, expressionKey = 'joy') {
    swapExpression(expressionKey);
    els.figure.classList.remove('react');
    // 再アニメーションのためリフローを挟む(transform/opacityのみのアニメ)
    void els.figure.offsetWidth;
    els.figure.classList.add('react');
    clearTimeout(reactTimer);
    reactTimer = setTimeout(() => els.figure.classList.remove('react'), 2000);
    if (message) sayLine(message);
  }

  return { refresh, renderCharacter, reactCharacter, reactAllDone, sayLine };
}
