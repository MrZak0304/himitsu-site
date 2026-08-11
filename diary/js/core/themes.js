// テーマ定義と利用可否(ピュア)。実際の配色は css/style.css の [data-theme] 変数セット。
// テーマ追加 = ここに1行+CSSに変数セット1ブロック(不変条件7)。
// 無料5種 / 有料15種 + カスタム(有料のみ)。web はPD確認用に全テーマ利用可。

export const DEFAULT_THEME = 'shiro'; // 既定は白基調(2026-08-09 PD FB)
export const CUSTOM_THEME_ID = 'custom';

export const THEMES = [
  // 無料5種
  { id: 'shiro', name: 'しろ', tier: 'free', dark: false },
  { id: 'yoru', name: 'よる', tier: 'free', dark: true },
  { id: 'sakura', name: 'さくら', tier: 'free', dark: false },
  { id: 'mori', name: 'もり', tier: 'free', dark: false },
  { id: 'umi', name: 'うみ', tier: 'free', dark: true },
  // 有料15種
  { id: 'yuyake', name: 'ゆうやけ', tier: 'paid', dark: false },
  { id: 'lavender', name: 'ラベンダー', tier: 'paid', dark: false },
  { id: 'matcha', name: 'まっちゃ', tier: 'paid', dark: false },
  { id: 'choco', name: 'チョコ', tier: 'paid', dark: true },
  { id: 'lemon', name: 'レモン', tier: 'paid', dark: false },
  { id: 'sumi', name: 'すみ', tier: 'paid', dark: true },
  { id: 'aozora', name: 'あおぞら', tier: 'paid', dark: false },
  { id: 'momiji', name: 'もみじ', tier: 'paid', dark: false },
  { id: 'mint', name: 'ミント', tier: 'paid', dark: false },
  { id: 'sango', name: 'さんご', tier: 'paid', dark: false },
  { id: 'kohi', name: 'コーヒー', tier: 'paid', dark: true },
  { id: 'hoshizora', name: 'ほしぞら', tier: 'paid', dark: true },
  { id: 'ichigo', name: 'いちご', tier: 'paid', dark: false },
  { id: 'wakaba', name: 'わかば', tier: 'paid', dark: false },
  { id: 'tsuki', name: 'つき', tier: 'paid', dark: true },
];

export const CUSTOM_COLOR_MESSAGE = '色は #RRGGBB 形式で指定してください。';

export function availableThemes(variant) {
  if (variant === 'free') return THEMES.filter((t) => t.tier === 'free');
  return THEMES;
}

// カスタムテーマは有料版の機能(webはPD確認用に利用可)
export function canUseCustomTheme(variant) {
  return variant !== 'free';
}

// 未知のテーマ・その変体で使えないテーマは既定へフォールバック
export function resolveTheme(id, variant) {
  if (id === CUSTOM_THEME_ID) return canUseCustomTheme(variant) ? id : DEFAULT_THEME;
  return availableThemes(variant).some((t) => t.id === id) ? id : DEFAULT_THEME;
}

// --- カスタムテーマ: 基準色(背景+アクセント)から変数セットを導出 ---

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidHexColor(s) {
  return typeof s === 'string' && HEX_RE.test(s);
}

function parse(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function toHex({ r, g, b }) {
  const h = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function mix(a, b, t) {
  return toHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}

function luminance({ r, g, b }) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// WCAGの相対輝度(コントラスト比の計算用。上の luminance() は明暗の二択判定に使う簡易式)
function relLuminance({ r, g, b }) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

// 2色のコントラスト比(1〜21)。4.5以上あれば本文サイズの文字が読める(WCAG AA)
export function contrastRatio(hexA, hexB) {
  const a = relLuminance(parse(hexA));
  const b = relLuminance(parse(hexB));
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

export const READABLE_TARGET = 4.5;

// 前景として使う色が背景に埋もれないよう、白か黒へ寄せて必要なコントラストを確保する。
// カスタムテーマは配色をユーザーが自由に選べるため、「背景と同系色のアクセント」を選ばれると
// 枠線ボタンや通知文が読めなくなる(2026-08-11 PD実機報告: 緑背景でボタンが消えた)。
export function ensureReadable(hex, bgHex, target = READABLE_TARGET) {
  if (!isValidHexColor(hex) || !isValidHexColor(bgHex)) return hex;
  if (contrastRatio(hex, bgHex) >= target) return hex;
  const base = parse(hex);
  // 白方向・黒方向の両方を試す。中間の明るさの背景(例: 鮮やかな緑)はどちらへ寄せても
  // 4.5に届かないことがあるため、届かない場合は「よりマシな方」を選ぶ
  let best = hex;
  let bestRatio = contrastRatio(hex, bgHex);
  for (const towards of [{ r: 255, g: 255, b: 255 }, { r: 20, g: 18, b: 24 }]) {
    for (let t = 0.1; t <= 1.0001; t += 0.1) {
      const candidate = mix(base, towards, Math.min(t, 1));
      const ratio = contrastRatio(candidate, bgHex);
      if (ratio >= target) return candidate;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        best = candidate;
      }
    }
  }
  return best;
}

// 入力は色形式のみ許可(検証必須)。CSS変数は url() を解釈しないプロパティでのみ使うこと。
export function deriveCustomTheme({ bg, accent }) {
  if (!isValidHexColor(bg) || !isValidHexColor(accent)) {
    const e = new Error(CUSTOM_COLOR_MESSAGE);
    e.code = 'invalid-color';
    throw e;
  }
  const bgC = parse(bg);
  const dark = luminance(bgC) < 0.5;
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 20, g: 18, b: 24 };
  const text = dark ? '#f2f1ee' : '#26232b';
  const textC = parse(text);
  // アクセント・通知色は「塗り」だけでなく「文字色・枠線」にも使うため、背景に対する
  // 可読性を必ず確保する(ユーザーが背景と同系色を選んでもボタンが消えないように)
  const accentSafe = ensureReadable(accent, bg);
  const okSafe = ensureReadable(dark ? '#6fd39a' : '#1f8a4c', bg);
  const dangerSafe = ensureReadable(dark ? '#ff7a70' : '#c62f2f', bg);
  return {
    dark,
    accentAdjusted: accentSafe !== accent, // UIで「見やすさのため調整した」と伝えるため
    vars: {
      '--bg': bg,
      '--panel': mix(bgC, dark ? white : black, 0.07),
      '--panel-edge': mix(bgC, dark ? white : black, 0.18),
      '--text': text,
      '--text-dim': mix(textC, bgC, 0.42),
      '--accent': accentSafe,
      // 塗りボタンの文字色は実際のコントラストで白/黒を選ぶ(明るさのしきい値だと
      // 中間の明るさのアクセントで読みにくい組み合わせが残る)
      '--accent-contrast':
        contrastRatio('#ffffff', accentSafe) >= contrastRatio('#26232b', accentSafe) ? '#ffffff' : '#26232b',
      '--danger': dangerSafe,
      '--ok': okSafe,
    },
  };
}
