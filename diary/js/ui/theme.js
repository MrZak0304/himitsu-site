// テーマ適用。配色は css/style.css の [data-theme] 変数セット、カスタムのみ
// core/themes.js の導出結果を style.setProperty で当てる(色形式は core 側で検証済み)。

import { resolveTheme, deriveCustomTheme, CUSTOM_THEME_ID } from '../core/themes.js';

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
