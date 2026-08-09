// 内蔵アイコン集。すべてインラインSVG(画像ファイル・外部フォント不使用: CLAUDE.md 不変条件7)。
// HTML側は <span data-icon="run"></span> のプレースホルダを置き、app.js が起動時に差し込む。

const S = 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';

function svg(body) {
  return `<svg viewBox="0 0 48 48" aria-hidden="true" ${S}>${body}</svg>`;
}

// 下部タブ用
export const NAV_ICONS = {
  today: svg('<circle cx="24" cy="24" r="16"/><path d="M24 14v10l7 5"/>'),
  habits: svg('<rect x="10" y="8" width="28" height="34" rx="4"/><path d="M17 22l5 5 9-10"/><path d="M17 16h6"/>'),
  calendar: svg('<rect x="8" y="10" width="32" height="30" rx="4"/><path d="M8 20h32M16 6v8M32 6v8"/><circle cx="24" cy="30" r="3" fill="currentColor" stroke="none"/>'),
  settings: svg('<circle cx="24" cy="24" r="7"/><path d="M24 6v6M24 36v6M6 24h6M36 24h6M11 11l4 4M33 33l4 4M37 11l-4 4M15 33l-4 4"/>'),
};

// 日課アイコン用(運動・勉強・読書・ゲーム等)
export const HABIT_ICONS = {
  run: svg('<circle cx="30" cy="10" r="4"/><path d="M18 20l8-4 6 8 8 2M26 24l-6 8-8 6M26 24l4 10 2 8"/>'),
  study: svg('<path d="M8 14l16-6 16 6-16 6z"/><path d="M14 18v10c0 3 5 6 10 6s10-3 10-6V18"/><path d="M40 16v10"/>'),
  book: svg('<path d="M24 12c-4-3-10-4-16-3v28c6-1 12 0 16 3 4-3 10-4 16-3V9c-6-1-12 0-16 3z"/><path d="M24 12v28"/>'),
  game: svg('<rect x="6" y="16" width="36" height="18" rx="9"/><path d="M15 22v8M11 26h8"/><circle cx="32" cy="23" r="2" fill="currentColor" stroke="none"/><circle cx="37" cy="27" r="2" fill="currentColor" stroke="none"/>'),
  water: svg('<path d="M24 6c8 10 12 16 12 23a12 12 0 0 1-24 0c0-7 4-13 12-23z"/><path d="M18 30a6 6 0 0 0 6 6"/>'),
  medicine: svg('<rect x="8" y="20" width="32" height="14" rx="7" transform="rotate(-30 24 27)"/><path d="M18 20l10 16"/>'),
  stretch: svg('<circle cx="24" cy="9" r="4"/><path d="M24 13v12M24 25l-9 12M24 25l9 12M10 18l14 2 14-4"/>'),
  sleep: svg('<path d="M38 30a16 16 0 1 1-14-24 13 13 0 0 0 14 24z"/><path d="M30 8h8l-8 8h8"/>'),
  clean: svg('<path d="M28 6l-8 20M14 30l16-6 6 12-4 2-3-5 1 6-5 2-2-6-1 7-5 1z"/>'),
  cook: svg('<path d="M16 6v14M22 6v14M19 6v14M19 20v22"/><path d="M32 6c-4 0-6 6-6 12s2 8 6 8v16"/>'),
  walk: svg('<circle cx="26" cy="9" r="4"/><path d="M26 13l-2 12 6 6 2 10M24 25l-8 4-2 8M24 17l-8 4M28 19l8 2"/>'),
  star: svg('<path d="M24 6l5.5 11.5L42 19l-9 9 2 13-11-6-11 6 2-13-9-9 12.5-1.5z"/>'),
};

export const HABIT_ICON_LABELS = {
  run: '運動',
  study: '勉強',
  book: '読書',
  game: 'ゲーム',
  water: '水分補給',
  medicine: '薬',
  stretch: 'ストレッチ',
  sleep: '睡眠',
  clean: '掃除',
  cook: '料理',
  walk: '散歩',
  star: 'その他',
};

// UI部品用
export const UI_ICONS = {
  star: svg('<path d="M24 8l4.5 9.5L39 19l-7.5 7.5L33 37l-9-5-9 5 1.5-10.5L9 19l10.5-1.5z"/>'),
  starFill: `<svg viewBox="0 0 48 48" aria-hidden="true" fill="currentColor"><path d="M24 8l4.5 9.5L39 19l-7.5 7.5L33 37l-9-5-9 5 1.5-10.5L9 19l10.5-1.5z"/></svg>`,
  lock: svg('<rect x="12" y="20" width="24" height="20" rx="4"/><path d="M17 20v-5a7 7 0 0 1 14 0v5"/><circle cx="24" cy="30" r="3" fill="currentColor" stroke="none"/>'),
  left: svg('<path d="M28 12L16 24l12 12"/>'),
  right: svg('<path d="M20 12l12 12-12 12"/>'),
  plus: svg('<path d="M24 12v24M12 24h24"/>'),
  close: svg('<path d="M14 14l20 20M34 14L14 34"/>'),
  up: svg('<path d="M12 28l12-12 12 12"/>'),
  down: svg('<path d="M12 20l12 12 12-12"/>'),
};

// data-icon / data-nav-icon / data-ui-icon プレースホルダへ一括差し込み
export function injectIcons(root = document) {
  for (const el of root.querySelectorAll('[data-nav-icon]')) {
    el.innerHTML = NAV_ICONS[el.dataset.navIcon] ?? '';
  }
  for (const el of root.querySelectorAll('[data-ui-icon]')) {
    el.innerHTML = UI_ICONS[el.dataset.uiIcon] ?? '';
  }
}
