// キャラクター5種(男の子・女の子・猫・犬・文鳥)の初稿。すべてインラインSVG。
// §9-3: この初稿はPD確認用。差し替えはこのファイルのSVGを更新するだけでよい。

function wrap(body) {
  return `<svg viewBox="0 0 96 96" aria-hidden="true">${body}</svg>`;
}

export const CHARACTERS = {
  boy: {
    name: '男の子',
    svg: wrap(`
      <circle cx="48" cy="52" r="30" fill="#ffe0c2"/>
      <path d="M18 48c2-20 14-30 30-30s28 10 30 30c-6-10-14-14-30-14s-24 4-30 14z" fill="#5b4632"/>
      <circle cx="38" cy="52" r="3.5" fill="#3a2f26"/>
      <circle cx="58" cy="52" r="3.5" fill="#3a2f26"/>
      <path d="M42 64c4 3 8 3 12 0" stroke="#3a2f26" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="30" cy="60" r="4" fill="#ffb391" opacity=".7"/>
      <circle cx="66" cy="60" r="4" fill="#ffb391" opacity=".7"/>
    `),
  },
  girl: {
    name: '女の子',
    svg: wrap(`
      <path d="M16 62c0-26 12-40 32-40s32 14 32 40c0 6-6 10-10 8 2-14-2-24-22-24s-24 10-22 24c-4 2-10-2-10-8z" fill="#7a4a3a"/>
      <circle cx="48" cy="54" r="26" fill="#ffe4cc"/>
      <circle cx="39" cy="54" r="3.5" fill="#3a2f26"/>
      <circle cx="57" cy="54" r="3.5" fill="#3a2f26"/>
      <path d="M43 65c3 2.5 7 2.5 10 0" stroke="#3a2f26" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="31" cy="61" r="4" fill="#ff9d9d" opacity=".7"/>
      <circle cx="65" cy="61" r="4" fill="#ff9d9d" opacity=".7"/>
      <circle cx="22" cy="42" r="5" fill="#ff8fab"/>
    `),
  },
  cat: {
    name: 'ねこ',
    svg: wrap(`
      <path d="M22 34L18 14l16 8zM74 34l4-20-16 8z" fill="#8f8f96"/>
      <path d="M24 32L21 20l10 5zM72 32l3-12-10 5z" fill="#f3b8c4"/>
      <ellipse cx="48" cy="56" rx="30" ry="27" fill="#a9a9b0"/>
      <circle cx="37" cy="52" r="3.5" fill="#2f2b33"/>
      <circle cx="59" cy="52" r="3.5" fill="#2f2b33"/>
      <path d="M48 60l-3-3h6z" fill="#f3b8c4"/>
      <path d="M48 60c0 4-4 6-7 4M48 60c0 4 4 6 7 4" stroke="#2f2b33" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path d="M14 52h12M14 60l12-2M82 52H70M82 60l-12-2" stroke="#7c7c85" stroke-width="2" stroke-linecap="round"/>
    `),
  },
  dog: {
    name: 'いぬ',
    svg: wrap(`
      <path d="M20 30c-8 2-8 20 2 22zM76 30c8 2 8 20-2 22z" fill="#a5713f"/>
      <ellipse cx="48" cy="55" rx="29" ry="27" fill="#d8a866"/>
      <ellipse cx="48" cy="64" rx="14" ry="11" fill="#f2dbb8"/>
      <circle cx="37" cy="50" r="3.5" fill="#3a2c1c"/>
      <circle cx="59" cy="50" r="3.5" fill="#3a2c1c"/>
      <ellipse cx="48" cy="60" rx="4" ry="3" fill="#3a2c1c"/>
      <path d="M48 63c0 4-4 6-7 4M48 63c0 4 4 6 7 4" stroke="#3a2c1c" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <path d="M42 34c2-3 10-3 12 0" stroke="#b98a4e" stroke-width="3" fill="none" stroke-linecap="round"/>
    `),
  },
  bird: {
    name: '文鳥',
    svg: wrap(`
      <ellipse cx="48" cy="58" rx="26" ry="24" fill="#e8e6e3"/>
      <path d="M28 46c2-14 8-22 20-22s18 8 20 22c-4-8-10-12-20-12s-16 4-20 12z" fill="#4a4a52"/>
      <circle cx="38" cy="50" r="3.5" fill="#2f2b33"/>
      <circle cx="58" cy="50" r="3.5" fill="#2f2b33"/>
      <path d="M44 56l4-4 4 4-4 5z" fill="#e2606c"/>
      <path d="M30 66c4 4 10 6 18 6s14-2 18-6" stroke="#cfccc8" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="30" cy="58" r="4" fill="#f3b8c4" opacity=".8"/>
      <circle cx="66" cy="58" r="4" fill="#f3b8c4" opacity=".8"/>
    `),
  },
};

export const CHARACTER_IDS = Object.keys(CHARACTERS);
