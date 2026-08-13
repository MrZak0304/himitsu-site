// 設定ストア。読み出し時に欠けた項目を既定値で埋め、数値を範囲検証する。
// パスコード・合言葉はハッシュのみ保持(平文フィールドを持たない)。

import { createKvStore } from './kv.js';

const KEY = 'diary-settings-v1';

// キャラクターのセリフ既定値(設定から編集可。空にすると既定に戻る)
export const DEFAULT_LINES = {
  joy: ['やっほー!', 'えへへ', 'きょうも書いてえらい!'],
  anger: ['むぅ!', 'ぷんぷん!'],
  sorrow: ['しょんぼり…', 'よしよしして…'],
  fun: ['るんるん♪', 'たのしい〜!', 'いっしょにがんばろう!'],
  allDone: ['全部達成!えらい!', 'ぜんぶできた!すごい!'],
  saved: ['記録できたよ!', 'きょうのこと、残したよ!'],
};

export const DEFAULT_SETTINGS = {
  lock: {
    enabled: false,
    prompted: false, // 初回ふりかえり時の「ロックしますか?」確認を済ませたか
    passcodeHash: null,
    salt: null,
    secretQuestion: '',
    secretAnswerHash: null,
    answerSalt: null,
  },
  reminder: { enabled: false, time: '21:00' },
  theme: 'shiro',
  character: { type: 'builtin', value: 'cat', position: 'right' },
  customCharacters: [],
  characterLines: DEFAULT_LINES,
  customTheme: null,
  tagSlots: { base: 10, earned: 0 },
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// ユーザー保存キャラの表情差分キー(ニュートラルは id の画像そのもの)
export const EXPRESSION_KEYS = ['joy', 'anger', 'sorrow', 'fun'];

function normalizeLines(raw) {
  const out = {};
  for (const k of Object.keys(DEFAULT_LINES)) {
    const src = Array.isArray(raw?.[k]) ? raw[k].filter((v) => typeof v === 'string' && v.trim() !== '') : [];
    out[k] = src.length > 0 ? src : [...DEFAULT_LINES[k]];
  }
  return out;
}

// 旧形式(画像IDの文字列)は {id, expressions:{}} へ移行して読む
function normalizeCustomCharacter(raw) {
  if (typeof raw === 'string') return { id: raw, expressions: {} };
  if (typeof raw !== 'object' || raw === null || typeof raw.id !== 'string') return null;
  const src = typeof raw.expressions === 'object' && raw.expressions !== null ? raw.expressions : {};
  const expressions = {};
  for (const k of EXPRESSION_KEYS) {
    if (typeof src[k] === 'string') expressions[k] = src[k];
  }
  return { id: raw.id, expressions };
}

function normalizeSettings(raw) {
  if (typeof raw !== 'object' || raw === null) raw = {};
  const d = structuredClone(DEFAULT_SETTINGS);
  const lock = typeof raw.lock === 'object' && raw.lock !== null ? raw.lock : {};
  const reminder = typeof raw.reminder === 'object' && raw.reminder !== null ? raw.reminder : {};
  const character = typeof raw.character === 'object' && raw.character !== null ? raw.character : {};
  const tagSlots = typeof raw.tagSlots === 'object' && raw.tagSlots !== null ? raw.tagSlots : {};
  return {
    lock: {
      enabled: lock.enabled === true,
      prompted: lock.prompted === true,
      passcodeHash: typeof lock.passcodeHash === 'string' ? lock.passcodeHash : null,
      salt: typeof lock.salt === 'string' ? lock.salt : null,
      secretQuestion: typeof lock.secretQuestion === 'string' ? lock.secretQuestion : '',
      secretAnswerHash: typeof lock.secretAnswerHash === 'string' ? lock.secretAnswerHash : null,
      answerSalt: typeof lock.answerSalt === 'string' ? lock.answerSalt : null,
    },
    reminder: {
      enabled: reminder.enabled === true,
      time: /^\d{2}:\d{2}$/.test(reminder.time) ? reminder.time : d.reminder.time,
    },
    theme: typeof raw.theme === 'string' ? raw.theme : d.theme,
    character: {
      type: character.type === 'custom' ? 'custom' : 'builtin',
      value: typeof character.value === 'string' ? character.value : d.character.value,
      position: character.position === 'left' ? 'left' : 'right',
    },
    customCharacters: Array.isArray(raw.customCharacters)
      ? raw.customCharacters.map(normalizeCustomCharacter).filter(Boolean)
      : [],
    characterLines: normalizeLines(raw.characterLines),
    customTheme:
      typeof raw.customTheme === 'object' && raw.customTheme !== null
        && HEX_RE.test(raw.customTheme.bg) && HEX_RE.test(raw.customTheme.accent)
        ? {
            bg: raw.customTheme.bg,
            accent: raw.customTheme.accent,
            // 背景画像(画像ストアのID)。有料版のみUIから設定。未設定は null
            bgImage: typeof raw.customTheme.bgImage === 'string' ? raw.customTheme.bgImage : null,
            // 膜の濃さ 0〜1(可読性用スクリム)。範囲外は 0.45 に丸める
            overlay:
              Number.isFinite(raw.customTheme.overlay)
                ? Math.max(0, Math.min(1, raw.customTheme.overlay))
                : 0.45,
            // パネルの不透明度 0.2〜1(小さいほど背景がよく透ける)。範囲外は 0.88 に丸める。
            // 下限 0.2 まで下げられ、背景画像をしっかり見せられる(2026-08-11 PD FB)。
            panelAlpha:
              Number.isFinite(raw.customTheme.panelAlpha)
                ? Math.max(0.2, Math.min(1, raw.customTheme.panelAlpha))
                : 0.88,
          }
        : null,
    tagSlots: {
      base: Number.isInteger(tagSlots.base) && tagSlots.base >= 0 ? tagSlots.base : d.tagSlots.base,
      earned: Number.isInteger(tagSlots.earned) && tagSlots.earned >= 0 ? tagSlots.earned : 0,
    },
  };
}

export function createSettingsStore(storage) {
  const kv = createKvStore({ key: KEY, fallback: DEFAULT_SETTINGS, normalize: normalizeSettings, storage });

  return {
    async get() {
      return kv.load();
    },
    // トップレベルのセクション単位で差し替え(深いマージはしない)
    async merge(partial) {
      const next = normalizeSettings({ ...kv.load(), ...partial });
      kv.save(next);
      return next;
    },
    async replaceAll(settings) {
      kv.save(normalizeSettings(settings));
    },
  };
}
