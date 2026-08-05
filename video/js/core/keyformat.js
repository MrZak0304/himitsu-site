// 復元データ(ペイロード)の形式 v1。バージョン管理必須(不変条件3)。
//
// バイナリレイアウト:
//   magic "EZMV" (4B) | version (1B) | headerLen (u32 BE) | headerJSON | ciphertext
//   headerJSON = { v: 1, iv: base64 }   … 暗号化パラメータのみ平文
//   ciphertext = AES-GCM( u32 BE metaLen | metaJSON | 復元動画mp4のバイト列 )
//   metaJSON   = { v, fps, frames, width, height, filter, tracks, restoreW, restoreH }

import { encryptBytes, decryptBytes, bytesToBase64, base64ToBytes } from './crypto.js';

export const PAYLOAD_VERSION = 1;
const MAGIC = new Uint8Array([0x45, 0x5a, 0x4d, 0x56]); // "EZMV"

/** meta と復元動画バイト列を暗号化してペイロードを組み立てる */
export async function buildRestorePayload(keyString, meta, mp4Bytes) {
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  const plain = new Uint8Array(4 + metaBytes.length + mp4Bytes.length);
  new DataView(plain.buffer).setUint32(0, metaBytes.length, false);
  plain.set(metaBytes, 4);
  plain.set(mp4Bytes, 4 + metaBytes.length);

  const { iv, data } = await encryptBytes(keyString, plain);
  const headerBytes = new TextEncoder().encode(
    JSON.stringify({ v: PAYLOAD_VERSION, iv: bytesToBase64(iv) }),
  );

  const out = new Uint8Array(4 + 1 + 4 + headerBytes.length + data.length);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = PAYLOAD_VERSION;
  view.setUint32(5, headerBytes.length, false);
  out.set(headerBytes, 9);
  out.set(data, 9 + headerBytes.length);
  return out;
}

/** バイト列が復元ペイロードの形式か(magic 判定のみ) */
export function looksLikePayload(bytes) {
  if (!bytes || bytes.length < 9) return false;
  return MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * ペイロードを復号して { meta, mp4Bytes } を返す。
 * キー違い・破損は Error(利用者向け日本語メッセージ)を投げる。
 */
export async function parseRestorePayload(keyString, bytes) {
  if (!looksLikePayload(bytes)) {
    throw new Error('復元データの形式が正しくありません。ファイルを確認してください。');
  }
  const version = bytes[4];
  if (version !== PAYLOAD_VERSION) {
    throw new Error(`この復元データ(v${version})は新しい形式です。アプリを更新してください。`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = view.getUint32(5, false);
  const headerEnd = 9 + headerLen;
  if (headerEnd > bytes.length) {
    throw new Error('復元データが壊れています。');
  }
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(9, headerEnd)));
  } catch {
    throw new Error('復元データが壊れています。');
  }

  let plain;
  try {
    plain = await decryptBytes(keyString, base64ToBytes(header.iv), bytes.subarray(headerEnd));
  } catch {
    throw new Error('解除キーが違うか、復元データが壊れています。');
  }

  const metaLen = new DataView(plain.buffer, plain.byteOffset).getUint32(0, false);
  const meta = JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + metaLen)));
  const mp4Bytes = plain.subarray(4 + metaLen);
  return { meta, mp4Bytes };
}
