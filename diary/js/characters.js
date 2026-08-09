// キャラクター5種(男の子・女の子・猫・犬・文鳥)。すべてインラインSVG。
// 各キャラは表情差分つき: svg(expr) — expr: 'neutral' | 'joy' | 'anger' | 'sorrow' | 'fun'
// (2026-08-10 PD FB「わかりやすい表情の変化」対応。§9-3/§9-6 の初稿)

function wrap(body) {
  return `<svg viewBox="0 0 96 96" aria-hidden="true">${body}</svg>`;
}

// --- 顔パーツ(表情差分)ジェネレータ ---

function eyesFor(expr, x1, x2, y, c) {
  // 喜・楽はにっこり閉じ目
  if (expr === 'joy' || expr === 'fun') {
    return `<path d="M${x1 - 4} ${y + 1} Q${x1} ${y - 5} ${x1 + 4} ${y + 1} M${x2 - 4} ${y + 1} Q${x2} ${y - 5} ${x2 + 4} ${y + 1}" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }
  let extra = '';
  if (expr === 'anger') {
    // つり眉
    extra = `<path d="M${x1 - 5} ${y - 10} L${x1 + 4} ${y - 6} M${x2 + 5} ${y - 10} L${x2 - 4} ${y - 6}" stroke="${c}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
  } else if (expr === 'sorrow') {
    // 涙
    extra = `<path d="M${x1 - 8} ${y + 5} q-3 6 0 8 q4 2 4 -3 q0 -3 -4 -5z" fill="#7ec3e8"/>`;
  }
  return `<circle cx="${x1}" cy="${y}" r="3.5" fill="${c}"/><circle cx="${x2}" cy="${y}" r="3.5" fill="${c}"/>${extra}`;
}

function mouthFor(expr, mx, my, c) {
  switch (expr) {
    case 'joy': // 大きく開けた口
      return `<path d="M${mx - 7} ${my - 2} Q${mx} ${my + 10} ${mx + 7} ${my - 2} z" fill="${c}"/><path d="M${mx - 3} ${my + 3} Q${mx} ${my + 6} ${mx + 3} ${my + 3} z" fill="#e2606c"/>`;
    case 'fun': // 大きなにっこり
      return `<path d="M${mx - 8} ${my - 1} Q${mx} ${my + 8} ${mx + 8} ${my - 1}" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    case 'anger': // への字
      return `<path d="M${mx - 6} ${my + 4} Q${mx} ${my - 3} ${mx + 6} ${my + 4}" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
    case 'sorrow': // しょんぼり
      return `<path d="M${mx - 5} ${my + 3} Q${mx} ${my - 1} ${mx + 5} ${my + 3}" stroke="${c}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    default: // ニュートラルの小さな笑み
      return `<path d="M${mx - 6} ${my} q6 4 12 0" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }
}

// def: {body, face: {x1, x2, ey, mx, my, c}, noMouth?}
function charSvg(def, expr) {
  const f = def.face;
  return wrap(
    def.body + eyesFor(expr, f.x1, f.x2, f.ey, f.c) + (def.noMouth ? '' : mouthFor(expr, f.mx, f.my, f.c)),
  );
}

const DEFS = {
  boy: {
    name: '男の子',
    face: { x1: 38, x2: 58, ey: 52, mx: 48, my: 63, c: '#3a2f26' },
    body: `
      <circle cx="48" cy="52" r="30" fill="#ffe0c2"/>
      <path d="M18 48c2-20 14-30 30-30s28 10 30 30c-6-10-14-14-30-14s-24 4-30 14z" fill="#5b4632"/>
      <circle cx="30" cy="60" r="4" fill="#ffb391" opacity=".7"/>
      <circle cx="66" cy="60" r="4" fill="#ffb391" opacity=".7"/>
    `,
  },
  girl: {
    name: '女の子',
    face: { x1: 39, x2: 57, ey: 54, mx: 48, my: 64, c: '#3a2f26' },
    body: `
      <path d="M16 62c0-26 12-40 32-40s32 14 32 40c0 6-6 10-10 8 2-14-2-24-22-24s-24 10-22 24c-4 2-10-2-10-8z" fill="#7a4a3a"/>
      <circle cx="48" cy="54" r="26" fill="#ffe4cc"/>
      <circle cx="31" cy="61" r="4" fill="#ff9d9d" opacity=".7"/>
      <circle cx="65" cy="61" r="4" fill="#ff9d9d" opacity=".7"/>
      <circle cx="22" cy="42" r="5" fill="#ff8fab"/>
    `,
  },
  cat: {
    name: 'ねこ',
    face: { x1: 37, x2: 59, ey: 52, mx: 48, my: 64, c: '#2f2b33' },
    body: `
      <path d="M22 34L18 14l16 8zM74 34l4-20-16 8z" fill="#8f8f96"/>
      <path d="M24 32L21 20l10 5zM72 32l3-12-10 5z" fill="#f3b8c4"/>
      <ellipse cx="48" cy="56" rx="30" ry="27" fill="#a9a9b0"/>
      <path d="M48 60l-3-3h6z" fill="#f3b8c4"/>
      <path d="M14 52h12M14 60l12-2M82 52H70M82 60l-12-2" stroke="#7c7c85" stroke-width="2" stroke-linecap="round"/>
    `,
  },
  dog: {
    name: 'いぬ',
    face: { x1: 37, x2: 59, ey: 50, mx: 48, my: 66, c: '#3a2c1c' },
    body: `
      <path d="M20 30c-8 2-8 20 2 22zM76 30c8 2 8 20-2 22z" fill="#a5713f"/>
      <ellipse cx="48" cy="55" rx="29" ry="27" fill="#d8a866"/>
      <ellipse cx="48" cy="64" rx="14" ry="11" fill="#f2dbb8"/>
      <ellipse cx="48" cy="59" rx="4" ry="3" fill="#3a2c1c"/>
      <path d="M42 34c2-3 10-3 12 0" stroke="#b98a4e" stroke-width="3" fill="none" stroke-linecap="round"/>
    `,
  },
  bird: {
    name: '文鳥',
    noMouth: true,
    face: { x1: 38, x2: 58, ey: 50, mx: 48, my: 60, c: '#2f2b33' },
    body: `
      <ellipse cx="48" cy="58" rx="26" ry="24" fill="#e8e6e3"/>
      <path d="M28 46c2-14 8-22 20-22s18 8 20 22c-4-8-10-12-20-12s-16 4-20 12z" fill="#4a4a52"/>
      <path d="M44 56l4-4 4 4-4 5z" fill="#e2606c"/>
      <path d="M30 66c4 4 10 6 18 6s14-2 18-6" stroke="#cfccc8" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="30" cy="58" r="4" fill="#f3b8c4" opacity=".8"/>
      <circle cx="66" cy="58" r="4" fill="#f3b8c4" opacity=".8"/>
    `,
  },
};

export const CHARACTERS = Object.fromEntries(
  Object.entries(DEFS).map(([id, def]) => [
    id,
    { name: def.name, svg: (expr = 'neutral') => charSvg(def, expr) },
  ]),
);

export const CHARACTER_IDS = Object.keys(CHARACTERS);

// 表情差分ラベル(内蔵キャラはSVGで内蔵、ユーザー保存キャラは画像で任意登録)
export const EXPRESSION_LABELS = { joy: '喜', anger: '怒', sorrow: '哀', fun: '楽' };
export const EXPRESSION_KEYS = Object.keys(EXPRESSION_LABELS);
