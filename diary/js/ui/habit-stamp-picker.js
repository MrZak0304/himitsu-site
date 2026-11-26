// 日課のスタンプの見た目を選ぶ部品(2026-10-26 PD 回答: 日課タブで日課ごとに決める)。
// プレビュー+「形」+「色」(色は買い切り版だけ。広告つき版には行を出さない=案1)。
// 日課の行の「編集」と「日課を追加」の欄で使う。選んだ見た目でカードに貼る(カード画面では変えない)。

import { STAMP_SHAPES, STAMP_COLORS, DEFAULT_BUILTIN_STAMP } from '../core/stamp.js';
import { canPickHabitStampColor, habitStampColor, habitStampText, DEFAULT_HABIT_STAMP } from '../core/habit-stats.js';
import { drawStampPreview, currentThemeColors } from '../card-render.js';
import { tr } from '../i18n/index.js';

const COLOR_IDS = STAMP_COLORS.map((c) => c.id);

// stamp: { shape, color } | null。getName / getCount: プレビューの文言用(日課名・連続日数)。
// onChange({ shape, color }) は選ぶたびに呼ぶ。戻り値の update() でプレビューを描き直せる(日課名の入力中など)
export function createHabitStampPicker({ stamp, variant, getName, getCount = () => 1, onChange }) {
  let cur = { ...DEFAULT_HABIT_STAMP, ...(stamp ?? {}) };
  delete cur.mode;
  const canColor = canPickHabitStampColor(variant);

  const root = document.createElement('div');
  root.className = 'habit-stamp-picker';
  const canvas = document.createElement('canvas');
  canvas.className = 'stamp-preview habit-stamp-preview';
  canvas.setAttribute('aria-label', tr('スタンプのプレビュー'));

  const shapeRow = document.createElement('div');
  shapeRow.className = 'choice-row card-stamp-mode';
  const shapeLabel = document.createElement('span');
  shapeLabel.className = 'choice-label';
  shapeLabel.textContent = tr('形');
  shapeRow.append(
    shapeLabel,
    ...STAMP_SHAPES.map((sh) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mini-btn';
      b.dataset.shape = sh.id;
      b.textContent = sh.name;
      b.onclick = () => choose({ shape: sh.id });
      return b;
    }),
  );

  const colorRow = document.createElement('div');
  colorRow.className = 'choice-row card-stamp-mode card-habit-color';
  colorRow.hidden = !canColor;
  const colorLabel = document.createElement('span');
  colorLabel.className = 'choice-label';
  colorLabel.textContent = tr('色');
  colorRow.append(
    colorLabel,
    ...STAMP_COLORS.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `swatch ${c.id === 'theme' ? 'theme' : c.id === 'transparent' ? 'transparent' : ''}`;
      if (c.hex) b.style.background = c.hex;
      b.dataset.color = c.id;
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.onclick = () => choose({ color: c.id });
      return b;
    }),
  );

  const hint = document.createElement('p');
  hint.className = 'note-inline';
  hint.textContent = tr('カードに貼るときのスタンプの見た目です。');

  root.append(canvas, shapeRow, colorRow, hint);

  function choose(patch) {
    cur = { ...cur, ...patch };
    update();
    onChange?.({ ...cur });
  }

  function update() {
    for (const b of shapeRow.querySelectorAll('[data-shape]')) {
      b.classList.toggle('on', b.dataset.shape === cur.shape);
      b.setAttribute('aria-pressed', b.dataset.shape === cur.shape ? 'true' : 'false');
    }
    const color = habitStampColor(cur.color, variant, COLOR_IDS);
    for (const b of colorRow.querySelectorAll('[data-color]')) {
      b.classList.toggle('is-selected', b.dataset.color === color);
      b.setAttribute('aria-pressed', b.dataset.color === color ? 'true' : 'false');
    }
    const panel = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#ffffff';
    drawStampPreview(canvas, {
      text: habitStampText(getName() || tr('運動'), getCount(), 'streak'),
      stamp: { ...DEFAULT_BUILTIN_STAMP, shape: cur.shape, color },
      theme: currentThemeColors(),
      panel,
    });
  }

  update();
  return { el: root, update, get value() { return { ...cur }; } };
}
