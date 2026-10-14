// タグを押す場所(きょう・日付の編集)の並べ方(v1.06・2026-10-14 PD FB「フォルダにタグをまとめる」)。
// - フォルダごとに見出しでまとめ、タップで開閉する。最初は閉じておく(PD 決定)。開いた状態は画面を開いている間だけ覚える
// - フォルダに入っていないタグ(未分類)は「未分類」の見出しを出さず、そのまま並べる(PD 決定)
// - タグが 1 つも無いフォルダは出さない。閉じたフォルダにも、その日に押したタグの数を出す(押したことが見えるように)

import { tr } from '../i18n/index.js';
import { UI_ICONS } from '../icons.js';

// foldersEl: フォルダの見出しを並べる場所 / looseEl: 未分類のタグを並べる場所(.tag-stamps)
// makeStamp(tag) はタグのボタンを返す。isOn(tag) はその日に押してあるか。openFolders は開いているフォルダの id の Set
export function renderTagPalette({ foldersEl, looseEl, tags, folders, makeStamp, isOn, openFolders }) {
  const known = new Set(folders.map((f) => f.id));
  const inFolder = new Map(folders.map((f) => [f.id, []]));
  const loose = [];
  for (const tag of tags) {
    if (tag.folderId && known.has(tag.folderId)) inFolder.get(tag.folderId).push(tag);
    else loose.push(tag); // フォルダが消えた参照も未分類として扱う
  }
  foldersEl.replaceChildren(
    ...folders
      .filter((f) => inFolder.get(f.id).length > 0)
      .map((f) => {
        const list = inFolder.get(f.id);
        const open = openFolders.has(f.id);
        const box = document.createElement('div');
        box.className = `tag-folder${open ? ' open' : ''}`;
        box.dataset.folderId = f.id;
        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'tag-folder-head';
        head.setAttribute('aria-expanded', String(open));
        const chev = document.createElement('span');
        chev.className = 'chev';
        chev.innerHTML = UI_ICONS.down;
        const name = document.createElement('span');
        name.className = 'folder-name';
        name.textContent = f.name;
        const count = document.createElement('span');
        count.className = 'folder-count';
        count.textContent = String(list.length);
        head.append(chev, name, count);
        const onCount = list.filter(isOn).length;
        if (onCount > 0) {
          const on = document.createElement('span');
          on.className = 'folder-on';
          on.textContent = tr('{0}個 押してあります', onCount);
          head.append(on);
        }
        const body = document.createElement('div');
        body.className = 'tag-stamps';
        body.hidden = !open;
        body.append(...list.map(makeStamp));
        head.onclick = () => {
          const next = !openFolders.has(f.id);
          if (next) openFolders.add(f.id);
          else openFolders.delete(f.id);
          box.classList.toggle('open', next);
          head.setAttribute('aria-expanded', String(next));
          body.hidden = !next;
        };
        box.append(head, body);
        return box;
      }),
  );
  foldersEl.hidden = foldersEl.childElementCount === 0;
  looseEl.replaceChildren(...loose.map(makeStamp));
}
