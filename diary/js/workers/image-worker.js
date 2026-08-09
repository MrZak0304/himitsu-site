// 画像のリサイズ+サムネイル生成 Worker。
// メガバイト級の画像処理をメインスレッドで行わない(不変条件10)。
// 原寸は保存しない: 本体は長辺1600px・サムネイルは320pxに縮小(不変条件5)。

const MAX_LONG_EDGE = 1600;
const THUMB_LONG_EDGE = 320;

async function encode(bitmap, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return { blob, width: w, height: h };
}

self.onmessage = async (e) => {
  const { id, file } = e.data;
  try {
    // imageOrientation でEXIF回転を反映(未対応環境ではブラウザ既定に任せる)
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
    const main = await encode(bitmap, MAX_LONG_EDGE);
    const thumb = await encode(bitmap, THUMB_LONG_EDGE);
    bitmap.close();
    self.postMessage({ id, ok: true, blob: main.blob, thumbBlob: thumb.blob, width: main.width, height: main.height });
  } catch {
    self.postMessage({ id, ok: false, message: '画像を読み込めませんでした。別の画像でお試しください。' });
  }
};
