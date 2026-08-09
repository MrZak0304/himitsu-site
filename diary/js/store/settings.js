// 設定ストア。読み出し時に欠けた項目を既定値で埋め、数値を範囲検証する。
// パスコード・合言葉はハッシュのみ保持(平文フィールドを持たない)。

import { createKvStore } from './kv.js';

const KEY = 'diary-settings-v1';

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
  customTheme: null,
  tagSlots: { base: 10, earned: 0 },
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

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
      ? raw.customCharacters.filter((v) => typeof v === 'string')
      : [],
    customTheme:
      typeof raw.customTheme === 'object' && raw.customTheme !== null
        && HEX_RE.test(raw.customTheme.bg) && HEX_RE.test(raw.customTheme.accent)
        ? { bg: raw.customTheme.bg, accent: raw.customTheme.accent }
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
