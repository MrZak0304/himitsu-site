// ロック用のハッシュ・照合(WebCrypto SHA-256+ソルト)。
// パスコード・秘密の合言葉の答えは平文保存しない(CLAUDE.md 不変条件4)。
// ロックは閲覧ガードでありデータ暗号化ではない(SPEC §2.4)。文言で「暗号化」と書かないこと。

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function makeSalt(size = 16) {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function hashValue(value, salt) {
  const data = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

export async function verifyValue(value, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  return (await hashValue(value, salt)) === expectedHash;
}

// 合言葉の答えは寛容に受ける: 前後空白・全角空白・大文字小文字・全角英数の differences を吸収
export function normalizeAnswer(answer) {
  return String(answer ?? '')
    .normalize('NFKC')
    .replace(/[\s　]+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function hashAnswer(answer, salt) {
  return hashValue(normalizeAnswer(answer), salt);
}

export async function verifyAnswer(answer, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  return (await hashAnswer(answer, salt)) === expectedHash;
}
