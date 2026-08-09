// バックアップ形式 v1 の build / parse(ピュア)。
// 形式は v フィールドでバージョン管理し、旧形式の取り込み互換を壊さない(不変条件2)。
// 生成は新形式のみ・解釈は全形式(現時点で v1 のみ)。
// images[] には記録の添付画像に加え、日課アイコン用・ユーザー保存キャラ用の画像も含める。

export const BACKUP_VERSION = 1;
// v1 の想定上限(画像総量の目安)。超過時は書き出しを日本語エラーで中断する。
// 大容量対応はフェーズ3で v2 形式(分割・zip等)を検討。
export const MAX_IMAGE_BYTES = 200 * 1024 * 1024;

export const MESSAGES = {
  tooLarge: 'バックアップが大きすぎるため書き出せません(画像の合計が上限を超えています)。不要な画像を減らしてからお試しください。',
  broken: 'バックアップファイルを読み込めませんでした。ファイルが壊れている可能性があります。',
  unknownVersion: 'このバックアップは新しいバージョンの形式のため読み込めません。アプリを最新版に更新してください。',
  invalid: 'バックアップファイルの内容が正しくありません。取り込みを中止しました(既存のデータは変更されていません)。',
};

function err(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// data: {entries(object), tags(array), habits(array), habitLogs(object), settings(object), images(array)}
// images: [{id, mime, data(base64), thumbMime, thumb(base64), width, height, kind}]
export function buildBackup(data, { exportedAt = Date.now() } = {}) {
  let imageBytes = 0;
  for (const img of data.images ?? []) {
    imageBytes += (img.data?.length ?? 0) + (img.thumb?.length ?? 0);
  }
  if (imageBytes > MAX_IMAGE_BYTES) throw err(MESSAGES.tooLarge, 'too-large');
  return {
    v: BACKUP_VERSION,
    exportedAt,
    entries: data.entries ?? {},
    tags: data.tags ?? [],
    habits: data.habits ?? [],
    habitLogs: data.habitLogs ?? {},
    settings: data.settings ?? {},
    images: data.images ?? [],
  };
}

// フィールド単位のスキーマ検証。失敗したら既存データに触れる前に日本語エラーで中断する。
export function parseBackup(json) {
  let raw;
  try {
    raw = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw err(MESSAGES.broken, 'broken');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw err(MESSAGES.broken, 'broken');
  if (!Number.isInteger(raw.v)) throw err(MESSAGES.broken, 'broken');
  if (raw.v > BACKUP_VERSION) throw err(MESSAGES.unknownVersion, 'unknown-version');

  // v1 スキーマ: 必須キー・型・配列健全性
  const objectFields = ['entries', 'habitLogs', 'settings'];
  const arrayFields = ['tags', 'habits', 'images'];
  for (const f of objectFields) {
    if (typeof raw[f] !== 'object' || raw[f] === null || Array.isArray(raw[f])) throw err(MESSAGES.invalid, 'invalid');
  }
  for (const f of arrayFields) {
    if (!Array.isArray(raw[f])) throw err(MESSAGES.invalid, 'invalid');
  }
  for (const img of raw.images) {
    if (typeof img !== 'object' || img === null) throw err(MESSAGES.invalid, 'invalid');
    if (typeof img.id !== 'string' || typeof img.data !== 'string') throw err(MESSAGES.invalid, 'invalid');
  }
  return {
    v: raw.v,
    exportedAt: raw.exportedAt ?? null,
    entries: raw.entries,
    tags: raw.tags,
    habits: raw.habits,
    habitLogs: raw.habitLogs,
    settings: raw.settings,
    images: raw.images,
  };
}
