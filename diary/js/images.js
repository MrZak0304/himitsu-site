// 画像パイプラインの窓口モジュール。UI側はWorker化を意識しない(プランKTD3)。
// Worker・OffscreenCanvas が使えない環境では黙って劣化させず日本語エラーで明示する
// (himitsu-video の教訓: 加工できないものを静かに通さない)。添付不可でもアプリ本体は続行。

import { createImageStore } from './store/images.js';
import { makeId } from './store/kv.js';

export const UNSUPPORTED_MESSAGE = 'この環境は画像の取り込みに対応していません(最新のブラウザでお試しください)。';

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./workers/image-worker.js', import.meta.url));
    worker.onmessage = (e) => {
      const done = pending.get(e.data.id);
      if (done) {
        pending.delete(e.data.id);
        done(e.data);
      }
    };
  }
  return worker;
}

export function createImagePipeline(imageStore = createImageStore()) {
  // kind ごとの取り込み方。スタンプ画像(v1.05)は透明を保つため PNG・長辺1000px(カード上で最大 2.5 倍まで拡大するため)
  const OPTIONS_BY_KIND = { stamp: { format: 'image/png', maxEdge: 1000 } };

  async function process(file, opts = {}) {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      throw new Error(UNSUPPORTED_MESSAGE);
    }
    seq += 1;
    const id = seq;
    const result = await new Promise((resolve) => {
      pending.set(id, resolve);
      getWorker().postMessage({ id, file, ...opts });
    });
    if (!result.ok) throw new Error(result.message);
    return result;
  }

  return {
    store: imageStore,
    // リサイズ→IndexedDB put の完了後にIDを返す。呼び出し元はその後に entry を更新する(逆順禁止)。
    async saveImage(file, kind = 'entry') {
      const r = await process(file, OPTIONS_BY_KIND[kind]);
      const id = makeId('img');
      await imageStore.put({ id, blob: r.blob, thumbBlob: r.thumbBlob, width: r.width, height: r.height, kind });
      return { id, width: r.width, height: r.height };
    },
  };
}
