// 解除キーの生成と AES-GCM 暗号化のラッパ。WebCrypto 標準APIのみ使用(不変条件8)。
// Node(テスト)とブラウザの両方で動く。

const subtle = globalThis.crypto.subtle;

// 紛らわしい文字(I/L/O/U)を除いた32文字。Crockford Base32 系。
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
const KEY_CHARS = 16; // 32^16 = 80bit 相当

/** 解除キーを新規生成する(例: "K3QD-8FHN-2TWX-PA7M") */
export function generateKeyString() {
  const bytes = new Uint8Array(KEY_CHARS);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < KEY_CHARS; i++) {
    s += ALPHABET[bytes[i] % 32];
    if (i % 4 === 3 && i !== KEY_CHARS - 1) s += '-';
  }
  return s;
}

/** 入力キーの正規化: 大文字化・区切り除去・紛らわしい文字の読み替え */
export function normalizeKeyString(input) {
  return String(input)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

/** キーが形式として妥当か(正規化後16文字・全て使用可能文字) */
export function isValidKeyString(input) {
  const s = normalizeKeyString(input);
  return s.length === KEY_CHARS && [...s].every((c) => ALPHABET.includes(c));
}

async function deriveAesKey(keyString) {
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizeKeyString(keyString)),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('EZMV-v1-salt'),
      info: new TextEncoder().encode('EZMV-aes-gcm'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** bytes を暗号化して {iv, data} を返す */
export async function encryptBytes(keyString, bytes) {
  const key = await deriveAesKey(keyString);
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv, data: new Uint8Array(ct) };
}

/** 復号する。キー違い・破損は例外(OperationError)になる */
export async function decryptBytes(keyString, iv, data) {
  const key = await deriveAesKey(keyString);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new Uint8Array(pt);
}

/** Uint8Array → base64(Node/ブラウザ両対応) */
export function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** base64 → Uint8Array */
export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
