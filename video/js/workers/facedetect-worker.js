// 顔検出 Web Worker(クラシックWorker)。MediaPipe FaceDetector をオフライン同梱
// アセットで初期化し、送られてくるフレーム(ImageBitmap)を検出して顔bboxを返す。
// 重い WASM 実行をメインスレッドから隔離する(不変条件5/10)。
//
// クラシックWorkerである理由: MediaPipe の ESM バンドルは内部で importScripts を
// 使って wasm ローダを読むため、モジュールWorker(type:'module')では動かない。
// クラシックWorkerなら importScripts が使え、動的 import() も iOS17+/Chrome で動く。
//
// メッセージ:
//   { type:'init' } → { type:'ready' } / { type:'error', message }
//   { type:'detect', id, bitmap, t } → { type:'result', id, t, faces:[{x,y,w,h,score}] }
//   { type:'close' }

let detector = null;
// ⚠ 末尾スラッシュを付けない。MediaPipe は wasmローダ等を `DIR + '/xxx.js'` で組み立てるため、
//   末尾スラッシュがあると `mediapipe//xxx.js` の二重スラッシュになり、Capacitor の WebView
//   ローカルサーバーが 404 を返す(dev server は正規化するので気づけない。
//   docs/lessons/2026-08-13-capacitor-double-slash.md)。
const DIR = new URL('../vendor/mediapipe', self.location.href).href;

async function init() {
  const { FaceDetector, FilesetResolver } = await import(DIR + '/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks(DIR);
  detector = await FaceDetector.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: DIR + '/blaze_face_short_range.tflite',
      delegate: 'CPU', // WebGL非依存で全環境(iOS Safari含む)で動く
    },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.5,
  });
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      await init();
      self.postMessage({ type: 'ready' });
    } else if (msg.type === 'detect') {
      if (!detector) throw new Error('detector未初期化');
      const ts = Math.max(1, Math.round(msg.t * 1000)); // VIDEOモードは単調増加ms
      const res = detector.detectForVideo(msg.bitmap, ts);
      const faces = (res.detections || []).map((d) => {
        const b = d.boundingBox;
        return {
          x: b.originX, y: b.originY, w: b.width, h: b.height,
          score: d.categories?.[0]?.score ?? 1,
        };
      });
      msg.bitmap.close?.();
      self.postMessage({ type: 'result', id: msg.id, t: msg.t, faces });
    } else if (msg.type === 'close') {
      detector?.close?.();
      detector = null;
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err?.message ?? String(err) });
  }
};
