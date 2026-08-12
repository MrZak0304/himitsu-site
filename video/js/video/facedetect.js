// 顔検出のメイン側ドライバ。動画を一定間隔でサンプリングし、各フレームを
// Worker へ渡して顔bboxを集め、autotrack でトラック化する(ブラウザ依存)。

import { loadVideo, seekTo } from './pipeline.js';
import { facesToTracks, faceBoxToEllipse } from '../core/autotrack.js';

/** Worker が使えるか(WASM顔検出の前提) */
export function faceDetectAvailable() {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

/**
 * 動画ファイルから顔を検出し、領域トラック配列を返す。
 * @param {File|Blob} file
 * @param {(p:number)=>void} onProgress 0..1
 * @param {number} sampleFps サンプリング頻度(既定5fps)
 * @returns {Promise<{tracks:Array, width:number, height:number}>}
 */
export async function detectFaceTracks(file, onProgress, sampleFps = 5) {
  if (!faceDetectAvailable()) {
    throw new Error('この環境では顔の自動検出を使えません。手動で領域を追加してください。');
  }
  // クラシックWorker(type指定なし)。MediaPipe の importScripts 依存のため必須(worker側コメント参照)
  const worker = new Worker(new URL('../workers/facedetect-worker.js', import.meta.url));
  const src = await loadVideo(file);
  try {
    await callWorker(worker, { type: 'init' }, 30000).catch(() => {
      throw new Error('顔検出の準備に失敗しました。手動で領域を追加してください。');
    });

    const { video, duration, width, height } = src;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    const step = 1 / sampleFps;
    const detections = [];
    let id = 0;

    for (let t = 0; t <= duration + 1e-6; t += step) {
      const tt = Math.min(t, Math.max(0, duration - 0.001));
      await seekTo(video, tt);
      ctx.drawImage(video, 0, 0, width, height);
      const bitmap = await createImageBitmap(canvas);
      const res = await callWorker(worker, { type: 'detect', id: id++, bitmap, t: tt }, 20000, [bitmap]);
      const faces = res.faces.map((b) => faceBoxToEllipse(b));
      detections.push({ t: tt, faces });
      onProgress?.(Math.min(1, t / duration));
    }

    const tracks = facesToTracks(detections);
    return { tracks, width, height };
  } finally {
    worker.postMessage({ type: 'close' });
    worker.terminate();
    src.dispose();
  }
}

/** Worker に1メッセージ送って対応する応答を待つ(id で対応付け) */
function callWorker(worker, msg, timeoutMs, transfer = []) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeoutMs);
    const onMsg = (e) => {
      const d = e.data;
      if (msg.type === 'init' && d.type === 'ready') { cleanup(); resolve(d); }
      else if (msg.type === 'detect' && d.type === 'result' && d.id === msg.id) { cleanup(); resolve(d); }
      else if (d.type === 'error' && (d.id === undefined || d.id === msg.id)) { cleanup(); reject(new Error(d.message)); }
    };
    const cleanup = () => { clearTimeout(timer); worker.removeEventListener('message', onMsg); };
    worker.addEventListener('message', onMsg);
    worker.postMessage(msg, transfer);
  });
}
