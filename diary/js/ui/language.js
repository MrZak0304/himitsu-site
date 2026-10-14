// 言語の選択(v1.06・2026-10-14 PD FB「設定に独立した言語の項目」「初回起動に言語の確認」)。
// 設定の「言語 / Language」と初回案内の言語の画面で同じ部品を使う。
// 切り替えると読み込み直す(モジュールの定数の文言も作り直すため)。名前を変えていない定番タグは切り替え先の言語に付け替える。

import { tr, trIn, locale, resolveLocale, LANGUAGE_CHOICES, setLanguagePreference } from '../i18n/index.js';
import { DEFAULT_TAG_SOURCES } from '../store/tags.js';

// 選択肢のボタンを並べる。ids は出す選択肢('auto' / 'ja' / 'en')、current は選択中の id
export function renderLanguageChoices(container, { ids, current, onPick }) {
  container.replaceChildren(
    ...LANGUAGE_CHOICES.filter((c) => ids.includes(c.id)).map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `lang-choice${c.id === current ? ' on' : ''}`;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(c.id === current));
      b.dataset.lang = c.id;
      b.textContent = c.label ?? tr('端末の言語に合わせる'); // 日本語 / English は各言語の名前のまま
      b.onclick = () => onPick(c.id);
      return b;
    }),
  );
}

// 言語の設定を変える。表示の言語が変わるなら、定番タグを付け替えてから読み込み直す(戻り値 true)
export async function changeLanguage(ctx, pref) {
  const from = locale();
  const to = resolveLocale(pref);
  setLanguagePreference(pref);
  if (to === from) return false;
  await ctx.stores.tags.localizeBuiltins(
    DEFAULT_TAG_SOURCES.map((s) => trIn(from, s)),
    DEFAULT_TAG_SOURCES.map((s) => trIn(to, s)),
  );
  // 公開デモの ?lang= は設定より優先されるので、外してから読み込み直す
  const url = new URL(window.location.href);
  url.searchParams.delete('lang');
  if (url.toString() === window.location.href) window.location.reload();
  else window.location.replace(url.toString());
  return true;
}
