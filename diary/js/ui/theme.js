// テーマ適用。配色は css/style.css の [data-theme] 変数セット、カスタムのみ
// core/themes.js の導出結果を style.setProperty で当てる(色形式は core 側で検証済み)。

import { resolveTheme, deriveCustomTheme, CUSTOM_THEME_ID, canUseCustomTheme } from '../core/themes.js';

const VARS = ['--bg', '--panel', '--panel-edge', '--text', '--text-dim', '--accent', '--accent-contrast', '--danger', '--ok'];

export function applyTheme(settings, variant) {
  const root = document.documentElement;
  let id = resolveTheme(settings.theme, variant);
  for (const v of VARS) root.style.removeProperty(v);
  if (id === CUSTOM_THEME_ID) {
    try {
      const t = deriveCustomTheme(settings.customTheme ?? {});
      for (const [k, val] of Object.entries(t.vars)) root.style.setProperty(k, val);
    } catch {
      id = resolveTheme(null, variant); // 不正なカスタム設定は既定テーマへ
    }
  }
  root.dataset.theme = id;
  return id;
}

// 背景画像の適用(有料版のカスタムテーマのみ)。画像は非同期に読み込み、
// 可読性のため上に半透明の膜(--bg-overlay)を重ねる。原寸ではなくリサイズ済みの
// サムネ/本体を使う(不変条件5は保存時に担保)。
let bgUrl = null;
export async function applyBackgroundImage(settings, variant, imageStore) {
  const root = document.documentElement;
  const clear = () => {
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = null;
    root.classList.remove('has-bg-image');
    document.body.style.removeProperty('background-image');
    root.style.removeProperty('--bg-overlay');
  };
  const ct = settings.customTheme;
  const isCustom = resolveTheme(settings.theme, variant) === CUSTOM_THEME_ID;
  if (!isCustom || !canUseCustomTheme(variant) || !ct?.bgImage || !imageStore) {
    clear();
    return;
  }
  try {
    const rec = await imageStore.get(ct.bgImage);
    const blob = rec?.blob ?? rec?.thumbBlob;
    if (!blob) {
      clear();
      return;
    }
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = URL.createObjectURL(blob);
    document.body.style.backgroundImage = `url(${bgUrl})`;
    root.style.setProperty('--bg-overlay', String(ct.overlay ?? 0.45));
    root.classList.add('has-bg-image');
  } catch {
    clear();
  }
}
