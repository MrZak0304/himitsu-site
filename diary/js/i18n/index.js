// 翻訳の仕組み(v1.06・不変条件 6)。日本語の原文をそのままキーにして tr() で引く(gettext 方式)。
// - 日本語は正本。辞書に無い文言は原文(日本語)のまま出す
// - 言語は起動時に一度だけ決める(切り替えたら再読み込み)。モジュールの定数(既定タグ・セリフなど)も
//   この言語で作られるよう、ほかのモジュールより先に評価される(import された側が先に評価される)
// - Node(テスト)では常に日本語。Node 22 には英語の navigator があるので、document の有無で見分ける
// ピュア(DOM に触るのは applyDom だけ)。

import en from './en.js';

export const SUPPORTED_LOCALES = Object.freeze(['ja', 'en']); // 韓国語・中国語(簡体字)は次の版で足す
export const LANGUAGE_CHOICES = Object.freeze([
  { id: 'auto', label: null }, // ラベルは tr('端末の言語に合わせる')
  { id: 'ja', label: '日本語' },
  { id: 'en', label: 'English' },
]);
const DICTS = { en };
const PREF_KEY = 'diary-lang'; // 'auto' | 'ja' | 'en'(設定ストアは非同期なので、起動前に読める localStorage に置く)

// 端末の言語の並びから対応言語を選ぶ。日本語が無く、英語も無い端末は英語(市場を広げる方針)
export function detectLocale(languages) {
  for (const raw of languages ?? []) {
    const l = String(raw).toLowerCase();
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('en')) return 'en';
  }
  return (languages ?? []).length > 0 ? 'en' : 'ja';
}

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function getLanguagePreference() {
  const v = storage()?.getItem?.(PREF_KEY);
  return v === 'ja' || v === 'en' ? v : 'auto';
}

export function setLanguagePreference(pref) {
  const s = storage();
  if (!s) return;
  if (pref === 'ja' || pref === 'en') s.setItem(PREF_KEY, pref);
  else s.removeItem(PREF_KEY);
}

// 設定の値(auto / ja / en)から実際に使う言語を決める。auto は端末の言語(Node では日本語)
export function resolveLocale(pref) {
  if (pref === 'ja' || pref === 'en') return pref;
  if (typeof document === 'undefined') return 'ja';
  const nav = globalThis.navigator;
  return detectLocale(nav?.languages?.length ? nav.languages : [nav?.language ?? 'ja']);
}

function initialLocale() {
  if (typeof document === 'undefined') return 'ja'; // Node(テスト)
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('lang'); // 公開デモの確認用 ?lang=en
    if (q === 'ja' || q === 'en') return q;
  } catch {
    /* noop */
  }
  return resolveLocale(getLanguagePreference());
}

let current = initialLocale();

export function locale() {
  return current;
}

// テスト用: 言語を差し替える(画面では使わない。切り替えは setLanguagePreference → 再読み込み)
export function _setLocaleForTest(l) {
  current = SUPPORTED_LOCALES.includes(l) ? l : 'ja';
}

export function dictionary(l = current) {
  return DICTS[l] ?? null;
}

// 差し込み: {0} {1} … を引数で置き換える。英語の複数形は {0|day|days}(引数が 1 なら左、それ以外は右)
export function format(template, args) {
  return template.replace(/\{(\d+)(?:\|([^|{}]*)\|([^|{}]*))?\}/g, (m, i, one, other) => {
    const v = args[Number(i)];
    if (one !== undefined) return Number(v) === 1 ? one : other;
    return v === undefined ? m : String(v);
  });
}

// 翻訳。src は日本語の原文(辞書のキー)。args は {0} {1} … に入る
export function tr(src, ...args) {
  const s = trIn(current, src);
  return args.length > 0 ? format(s, args) : s;
}

// 指定した言語での訳(言語を切り替える前に、切り替え先の文言を作るため。定番タグの名前など)
export function trIn(l, src) {
  const d = DICTS[l];
  return (d && Object.prototype.hasOwnProperty.call(d, src) ? d[src] : null) ?? src;
}

// 翻訳キーの目印(その場では訳さず、原文のまま持つ)。tools/i18n-keys.mjs は tr() と同じくキーとして集める
export function N_(src) {
  return src;
}

// --- 日付(日本語は従来どおりの書き方。ほかの言語は Intl) ---
const JA_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const INTL_LOCALE = { ja: 'ja-JP', en: 'en-US' };

function intl(opts) {
  return new Intl.DateTimeFormat(INTL_LOCALE[current] ?? 'en-US', opts);
}

// 曜日(短い): 日 / Sun
export function weekdayShort(dow) {
  if (current === 'ja') return JA_WEEKDAYS[dow];
  return intl({ weekday: 'short' }).format(new Date(2026, 0, 4 + dow)); // 2026-01-04 は日曜
}

// 2026年10月13日(火) / Tue, Oct 13, 2026
export function formatLongDate(y, m, d) {
  if (current === 'ja') return `${y}年${m}月${d}日(${JA_WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
  return intl({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(y, m - 1, d));
}

// 2026年10月13日 / Oct 13, 2026
export function formatDate(y, m, d) {
  if (current === 'ja') return `${y}年${m}月${d}日`;
  return intl({ month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(y, m - 1, d));
}

// 2026年10月 / October 2026
export function formatYearMonth(y, m) {
  if (current === 'ja') return `${y}年${m}月`;
  return intl({ month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
}

// 10月 / October
export function formatMonth(m) {
  if (current === 'ja') return `${m}月`;
  return intl({ month: 'long' }).format(new Date(2026, m - 1, 1));
}

// 10/15(木) / Thu 10/15
export function formatMonthDay(m, d, dow) {
  if (current === 'ja') return `${m}/${d}(${JA_WEEKDAYS[dow]})`;
  return `${weekdayShort(dow)} ${m}/${d}`;
}

// --- 画面(index.html)の固定文言を差し替える。日本語のときは何もしない ---
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
const JA_RE = /[぀-ヿ㐀-鿿]/;

export function applyDom(root) {
  if (current === 'ja' || !root) return;
  const doc = root.ownerDocument ?? root;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  for (const n of nodes) {
    const raw = n.nodeValue;
    const key = raw.trim();
    if (!key || !JA_RE.test(key)) continue;
    const parent = n.parentNode?.nodeName;
    if (parent === 'SCRIPT' || parent === 'STYLE') continue;
    const out = tr(key);
    if (out !== key) n.nodeValue = raw.replace(key, out);
  }
  for (const el of root.querySelectorAll('*')) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && JA_RE.test(v)) {
        const out = tr(v);
        if (out !== v) el.setAttribute(a, out);
      }
    }
    // 曜日の見出しなど、1 文字で意味が決まらない文言は data-wd(0=日曜)で入れる
    if (el.dataset?.wd !== undefined) el.textContent = weekdayShort(Number(el.dataset.wd));
  }
  if (doc.title && JA_RE.test(doc.title)) doc.title = tr(doc.title);
  doc.documentElement?.setAttribute('lang', current);
}
