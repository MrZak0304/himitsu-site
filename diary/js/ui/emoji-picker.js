// 絵文字のポップアップ(2026-10-27 PD 了承: 「🎉▾」を押すと、さがす欄と絵文字の一覧が出る)。
// きょうの「#あたらしいタグ」と「きょうのできごと」、ふりかえりの編集の「できごと」、予定のタイトル(2026-10-30)で使う。
// 一覧と検索は searchEmojis(6 言語のキーワード)。
// 開いたときに検索欄へフォーカスしない(キーボードで一覧が隠れないように。探したいときだけ「さがす」を押す)。

import { searchEmojis, insertAtCaret } from '../core/plans.js';
import { tr } from '../i18n/index.js';

// 絵文字の一覧を描く。戻り値: 出した数
export function renderEmojiPalette(container, query, { selected = '', onPick }) {
  const list = searchEmojis(query);
  container.replaceChildren(
    ...list.map((e) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `emoji-btn${selected === e ? ' on' : ''}`;
      b.dataset.emoji = e;
      b.textContent = e;
      b.setAttribute('aria-label', tr('絵文字 {0}', e));
      b.onclick = () => onPick(e);
      return b;
    }),
  );
  return list.length;
}

export function createEmojiPicker() {
  const $ = (id) => document.getElementById(id);
  const els = {
    root: $('emoji-dialog'),
    search: $('emoji-search'),
    list: $('emoji-list'),
    none: $('emoji-none'),
    close: $('emoji-close'),
  };
  let resolve = null;

  function render() {
    els.none.hidden = renderEmojiPalette(els.list, els.search.value, { onPick: (e) => finish(e) }) > 0;
  }

  function finish(emoji) {
    const r = resolve;
    resolve = null;
    els.root.hidden = true;
    r?.(emoji);
  }

  // pick() → Promise<string|null>(やめたら null)
  function pick() {
    if (resolve) finish(null);
    return new Promise((res) => {
      resolve = res;
      els.search.value = '';
      render();
      els.list.scrollTop = 0;
      els.root.hidden = false;
    });
  }

  els.search.oninput = render;
  els.close.onclick = () => finish(null);
  // 外側(暗いところ)を押しても閉じる
  els.root.onclick = (e) => {
    if (e.target === els.root) finish(null);
  };

  // 「🎉▾」ボタンと入力欄をつなぐ。選んだ絵文字をカーソルの位置に入れる。
  // onInsert: 入れたあとに呼ぶ(できごとの保存など)。入力欄の文字数の上限を超えるときは入れない
  function attach(button, input, { onInsert } = {}) {
    button.onclick = async () => {
      // ボタンを押すと入力欄のフォーカスが外れるので、その前のカーソル位置を使う
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const emoji = await pick();
      if (!emoji) return;
      const r = insertAtCaret(input.value, start, end, emoji, input.maxLength);
      if (!r) return;
      input.value = r.value;
      try {
        input.setSelectionRange(r.caret, r.caret); // 続けて入れるときは、入れた絵文字のうしろへ
      } catch {
        // setSelectionRange が使えない入力欄では何もしない
      }
      onInsert?.();
    };
  }

  return { pick, attach, close: () => finish(null) };
}
