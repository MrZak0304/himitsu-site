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
  // 背景画像だけを外す(パネル透過はカスタムテーマなら画像が無くても効くので別管理)
  const clearImage = () => {
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = null;
    root.classList.remove('has-bg-image');
    document.body.style.removeProperty('background-image');
    root.style.removeProperty('--bg-overlay');
  };
  const ct = settings.customTheme;
  const isCustom = resolveTheme(settings.theme, variant) === CUSTOM_THEME_ID && canUseCustomTheme(variant);

  // パネルの透け具合はカスタムテーマなら画像の有無に関わらず適用(2026-08-11 PD FB:
  // 背景色だけのカスタムテーマでも透過を効かせたい)。
  if (isCustom && ct) {
    root.style.setProperty('--panel-alpha', String(ct.panelAlpha ?? 0.88));
    root.classList.add('has-panel-alpha');
  } else {
    root.style.removeProperty('--panel-alpha');
    root.classList.remove('has-panel-alpha');
  }

  // 背景画像は bgImage があるときだけ
  if (!isCustom || !ct?.bgImage || !imageStore) {
    clearImage();
    return;
  }
  try {
    const rec = await imageStore.get(ct.bgImage);
    const blob = rec?.blob ?? rec?.thumbBlob;
    if (!blob) {
      clearImage();
      return;
    }
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = URL.createObjectURL(blob);
    document.body.style.backgroundImage = `url(${bgUrl})`;
    root.style.setProperty('--bg-overlay', String(ct.overlay ?? 0.45));
    root.classList.add('has-bg-image');
  } catch {
    clearImage();
  }
}
