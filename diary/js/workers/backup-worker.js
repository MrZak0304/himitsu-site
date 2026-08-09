// バックアップの生成/展開 Worker(module worker)。
// base64エンコード・デコード込みの重い処理をメインスレッドで行わない(不変条件10)。
// 形式のロジックは core/backup.js を共用する(Workerは変換と組み立てのみ)。

import { buildBackup, parseBackup, MESSAGES } from '../core/backup.js';

const CHUNK = 0x8000;

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime || 'application/octet-stream' });
}

self.onmessage = async (e) => {
  const { op, data, text } = e.data;
  try {
    if (op === 'build') {
      const images = [];
      for (const rec of data.imageRecords) {
        images.push({
          id: rec.id,
          mime: rec.blob?.type ?? 'image/jpeg',
          data: rec.blob ? await blobToBase64(rec.blob) : '',
          thumbMime: rec.thumbBlob?.type ?? 'image/jpeg',
          thumb: rec.thumbBlob ? await blobToBase64(rec.thumbBlob) : '',
          width: rec.width,
          height: rec.height,
          kind: rec.kind ?? 'entry',
        });
      }
      const backup = buildBackup({ ...data.collections, images });
      self.postMessage({ ok: true, json: JSON.stringify(backup) });
    } else if (op === 'parse') {
      const parsed = parseBackup(text);
      const imageRecords = parsed.images.map((img) => ({
        id: img.id,
        blob: base64ToBlob(img.data, img.mime),
        thumbBlob: img.thumb ? base64ToBlob(img.thumb, img.thumbMime) : null,
        width: img.width,
        height: img.height,
        kind: img.kind ?? 'entry',
      }));
      self.postMessage({ ok: true, parsed: { ...parsed, images: undefined }, imageRecords });
    }
  } catch (err) {
    self.postMessage({ ok: false, message: err?.message ?? MESSAGES.broken });
  }
};
