// 動画処理パイプライン(ブラウザ依存)。
// 作成: 元動画 → フィルター焼き込みMP4 + 暗号化復元ペイロード
// 復元: 共有MP4 + ペイロード + キー → 復元MP4
// デコードは <video> のシーク逐次描画(依存ゼロ)、エンコードは WebCodecs。
// 重い処理だが、フレーム毎に await でイベントループへ返すため UI は固まらない。

import { interpolateTrack, unionBounds } from '../core/regions.js';
import { buildRestorePayload, parseRestorePayload } from '../core/keyformat.js';
import { applyBeeps, normalizeBeepRanges } from '../core/beep.js';
import { applyFilters, composeRestore } from './filters.js';
import { createMuxer, avcCodecString, embedPayload, extractPayload } from './mux.js';
import { extractAudioTrack } from './demux.js';
import { spliceBeepFrames, buildBeepOnlyTrack } from '../core/beepsplice.js';
import { base64ToBytes } from '../core/crypto.js';
import { BEEP_BANK } from '../assets/beep-bank.js';

const FPS = 30;

/** File/Blob から <video> を用意し、メタデータ(長さ・解像度)を得る */
export async function loadVideo(fileOrBlob) {
  const url = URL.createObjectURL(fileOrBlob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  await eventOnce(video, 'loadedmetadata', 'error', 20000).catch(() => {
    URL.revokeObjectURL(url);
    throw new Error('動画を読み込めませんでした。対応形式(MP4等)か確認してください。');
  });
  // MediaRecorder 由来などで duration が Infinity の場合のワークアラウンド
  if (!Number.isFinite(video.duration)) {
    video.currentTime = 1e9;
    await eventOnce(video, 'durationchange', 'error', 10000).catch(() => {});
    video.currentTime = 0;
    await eventOnce(video, 'seeked', 'error', 10000).catch(() => {});
  }
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    URL.revokeObjectURL(url);
    throw new Error('動画の長さを取得できませんでした。');
  }
  return {
    video,
    url,
    duration: video.duration,
    width: video.videoWidth,
    height: video.videoHeight,
    dispose: () => URL.revokeObjectURL(url),
  };
}

/** 指定時刻へシークして描画可能になるまで待つ */
export async function seekTo(video, t) {
  const target = Math.max(0, Math.min(t, Math.max(0, video.duration - 0.001)));
  if (Math.abs(video.currentTime - target) < 1e-4 && video.readyState >= 2) return;
  video.currentTime = target;
  await eventOnce(video, 'seeked', 'error', 15000);
}

/**
 * 作成処理。
 * @returns {sharedBytes, payload} — format 'B' なら sharedBytes に埋め込み済み(payload も返す)
 */
export async function processCreate({ file, tracks, filter, format, keyString, beeps = [], beepFile = null, onProgress }) {
  const src = await loadVideo(file);
  try {
    const { video, duration, width, height } = src;
    const fps = FPS;
    const frames = Math.max(1, Math.round(duration * fps));

    // 復元データの切り出し枠(トラックごとに固定矩形)と縦積みレイアウト
    const layouts = [];
    let restoreW = 0;
    let restoreH = 0;
    for (const track of tracks) {
      const crop = unionBounds(track, duration, width, height, { step: 1 / fps, pad: 4 });
      if (!crop) continue;
      layouts.push({ track, crop, slotY: restoreH });
      restoreW = Math.max(restoreW, crop.w);
      restoreH += crop.h;
    }
    if (layouts.length === 0) throw new Error('領域が指定されていません。');

    const srcCanvas = makeCanvas(width, height);
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    const outCanvas = makeCanvas(width, height);
    const outCtx = outCanvas.getContext('2d');
    const resCanvas = makeCanvas(restoreW, restoreH);
    const resCtx = resCanvas.getContext('2d');

    // 音声方針(不変条件11: 加工しないものは再エンコードしない):
    //  - ピー音なし → 元動画のAAC音声をそのままコピー(パススルー)
    //  - 標準ピー音 → 事前エンコード済みフレームの差し替え(スプライス)。どちらも
    //    エンコーダ不要で AudioEncoder 非対応環境(iPhone Safari 等)でも動く
    //  - 「音の変更」使用時のみ再エンコード(WebCodecs AudioEncoder)。非対応は明確にエラー
    //  - 復元用の元音声は常にパススルー抽出を優先
    const validBeeps = normalizeBeepRanges(beeps, duration);
    const sourceBytes = new Uint8Array(await file.arrayBuffer());
    const sourceAudio = await extractAudioTrack(sourceBytes).catch(() => null);
    let mainRaw = null; // 生サンプル出力(パススルー or スプライス)
    let audio = null; // 再エンコード出力
    let restorePass = null;
    let restoreAudio = null;

    if (validBeeps.length === 0) {
      mainRaw = sourceAudio;
    } else if (!beepFile) {
      if (sourceAudio) {
        const bank = beepBankFor(sourceAudio.config.sampleRate, sourceAudio.config.numberOfChannels);
        if (bank) {
          mainRaw = { ...sourceAudio, samples: spliceBeepFrames(sourceAudio.samples, validBeeps, bank.beepFrames) };
          restorePass = sourceAudio;
        }
      } else {
        const bank = beepBankFor(48000, 1);
        mainRaw = {
          config: { codec: 'aac', numberOfChannels: 1, sampleRate: 48000 },
          description: bank.asc,
          samples: buildBeepOnlyTrack(duration, validBeeps, bank),
        };
      }
    }

    if (!mainRaw) {
      // 再エンコード経路: 音の変更を使う場合、またはスプライス非対応の音声形式
      const origBuf = await decodeAudioFile(file).catch(() => null);
      const sampleRate = origBuf?.sampleRate ?? 48000;
      let sharedChannels = origBuf ? channelsOf(origBuf) : null;
      if (validBeeps.length > 0) {
        sharedChannels = sharedChannels
          ? sharedChannels.map((c) => c.slice()) // 元音声を復元用に保全
          : [new Float32Array(Math.ceil(duration * sampleRate))];
        const customBuf = beepFile ? await decodeAudioFile(beepFile).catch(() => null) : null;
        applyBeeps(sharedChannels, sampleRate, validBeeps, customBuf ? { channelData: channelsOf(customBuf) } : null);
      }
      audio = sharedChannels
        ? await encodeAudioChannels(sharedChannels, sampleRate, duration).catch(() => null)
        : null;
      if (validBeeps.length > 0) {
        if (!audio) {
          throw new Error(beepFile
            ? 'この端末のブラウザは「音の変更」に対応していません。標準のピー音をお使いください。'
            : 'この動画の音声形式にはピー音を入れられませんでした。');
        }
        restorePass = sourceAudio;
        if (!restorePass && origBuf) {
          restoreAudio = await encodeAudioChannels(channelsOf(origBuf), sampleRate, duration).catch(() => null);
        }
      }
    }

    const mainMux = createMuxer({ width, height, fps, audio: mainRaw?.config ?? audio?.config ?? null });
    const mainEnc = await makeVideoEncoder({ width, height, fps, muxer: mainMux });
    const resMux = createMuxer({ width: restoreW, height: restoreH, fps, audio: restorePass?.config ?? restoreAudio?.config ?? null });
    const resEnc = await makeVideoEncoder({ width: restoreW, height: restoreH, fps, muxer: resMux, quality: 'high' });

    for (let i = 0; i < frames; i++) {
      const t = (i + 0.5) / fps;
      await seekTo(video, t);
      srcCtx.drawImage(video, 0, 0, width, height);

      // 復元データ: 各領域の切り出し枠を縦に積む
      for (const { crop, slotY } of layouts) {
        resCtx.drawImage(srcCanvas, crop.x, crop.y, crop.w, crop.h, 0, slotY, crop.w, crop.h);
      }
      await encodeFrame(resEnc, resCanvas, i, fps);

      // 共有動画: フィルター焼き込み
      outCtx.drawImage(srcCanvas, 0, 0);
      const geoms = layouts
        .map(({ track }) => {
          const g = interpolateTrack(track, t);
          return g ? { ...g, shape: track.shape } : null;
        })
        .filter(Boolean);
      applyFilters(outCtx, srcCanvas, geoms, filter);
      await encodeFrame(mainEnc, outCanvas, i, fps);

      onProgress?.((i + 1) / frames);
    }

    await mainEnc.flush();
    await resEnc.flush();
    if (mainRaw) {
      addRawAudio(mainMux, mainRaw);
    } else if (audio) {
      for (const { chunk, meta } of audio.chunks) mainMux.addAudioChunk(chunk, meta);
    }
    if (restorePass) {
      addRawAudio(resMux, restorePass);
    } else if (restoreAudio) {
      for (const { chunk, meta } of restoreAudio.chunks) resMux.addAudioChunk(chunk, meta);
    }
    let sharedBytes = mainMux.finalize();
    const restoreMp4 = resMux.finalize();

    const meta = {
      v: 1,
      fps,
      frames,
      width,
      height,
      filter,
      tracks: layouts.map(({ track, crop, slotY }) => ({
        shape: track.shape,
        keyframes: track.keyframes.map((kf) => ({
          t: round3(kf.t), cx: Math.round(kf.cx), cy: Math.round(kf.cy),
          rx: Math.round(kf.rx), ry: Math.round(kf.ry),
        })),
        crop,
        slotY,
      })),
      restoreW,
      restoreH,
      beeps: validBeeps.map((b) => ({ start: round3(b.start), end: round3(b.end) })),
      hasOriginalAudio: !!(restorePass || restoreAudio),
    };
    const payload = await buildRestorePayload(keyString, meta, restoreMp4);
    if (format === 'B') sharedBytes = embedPayload(sharedBytes, payload);
    return { sharedBytes, payload, hasAudio: !!(mainRaw || audio), meta };
  } finally {
    src.dispose();
  }
}

/** 復元処理。payloadBytes 省略時は動画からの抽出(B案)を試みる */
export async function processRestore({ videoFile, payloadBytes, keyString, onProgress }) {
  const videoBytes = new Uint8Array(await videoFile.arrayBuffer());
  let payload = extractPayload(videoBytes);
  if (!payload && payloadBytes) payload = payloadBytes;
  if (!payload) {
    throw new Error('復元データが見つかりません。復元ファイル(.ezmv)を指定してください。');
  }
  const { meta, mp4Bytes } = await parseRestorePayload(keyString, payload);

  const shared = await loadVideo(new Blob([videoBytes], { type: 'video/mp4' }));
  const restore = await loadVideo(new Blob([mp4Bytes], { type: 'video/mp4' }));
  try {
    const { width, height, fps, frames } = meta;
    const outCanvas = makeCanvas(width, height);
    const ctx = outCanvas.getContext('2d');

    // 音声: ピー音入りで作られた場合は復元動画側の元音声を、それ以外は共有動画の音声を使う。
    // どちらもパススルー(再エンコードなし)を優先し、だめなら再エンコードに落とす
    let pass = null;
    let audio = null;
    if (meta.hasOriginalAudio) pass = await extractAudioTrack(mp4Bytes).catch(() => null);
    if (!pass) pass = await extractAudioTrack(videoBytes).catch(() => null);
    if (!pass) {
      if (meta.hasOriginalAudio) {
        const buf = await decodeAudioFile(new Blob([mp4Bytes], { type: 'video/mp4' })).catch(() => null);
        if (buf) audio = await encodeAudioChannels(channelsOf(buf), buf.sampleRate, shared.duration).catch(() => null);
      }
      if (!audio) {
        const buf = await decodeAudioFile(videoFile).catch(() => null);
        if (buf) audio = await encodeAudioChannels(channelsOf(buf), buf.sampleRate, shared.duration).catch(() => null);
      }
    }
    const mux = createMuxer({ width, height, fps, audio: pass?.config ?? audio?.config ?? null });
    const enc = await makeVideoEncoder({ width, height, fps, muxer: mux });

    for (let i = 0; i < frames; i++) {
      const t = (i + 0.5) / fps;
      await seekTo(shared.video, t);
      await seekTo(restore.video, t);
      ctx.drawImage(shared.video, 0, 0, width, height);
      for (const track of meta.tracks) {
        const g = interpolateTrack(track, t);
        if (g) composeRestore(ctx, restore.video, track, g);
      }
      await encodeFrame(enc, outCanvas, i, fps);
      onProgress?.((i + 1) / frames);
    }
    await enc.flush();
    if (pass) {
      addRawAudio(mux, pass);
    } else if (audio) {
      for (const { chunk, meta: m } of audio.chunks) mux.addAudioChunk(chunk, m);
    }
    return { restoredBytes: mux.finalize(), meta };
  } finally {
    shared.dispose();
    restore.dispose();
  }
}

// ---- 内部ヘルパー ----

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function makeVideoEncoder({ width, height, fps, muxer, quality }) {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('このブラウザは動画エンコード(WebCodecs)に対応していません。Chrome/Edge をお使いください。');
  }
  const factor = quality === 'high' ? 0.15 : 0.08;
  const config = {
    codec: avcCodecString(width, height),
    width,
    height,
    bitrate: Math.max(500_000, Math.min(12_000_000, Math.round(width * height * fps * factor))),
    framerate: fps,
    avc: { format: 'avc' },
  };
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) {
    throw new Error('この解像度の動画エンコードに対応していません。');
  }
  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e; },
  });
  encoder.configure(config);
  encoder.checkError = () => {
    if (encodeError) throw new Error(`エンコードに失敗しました: ${encodeError.message}`);
  };
  return encoder;
}

async function encodeFrame(encoder, canvas, index, fps) {
  encoder.checkError();
  const frame = new VideoFrame(canvas, {
    timestamp: Math.round((index * 1e6) / fps),
    duration: Math.round(1e6 / fps),
  });
  encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 });
  frame.close();
  while (encoder.encodeQueueSize > 4) await sleep(1);
}

// ピー音フレームバンク(base64)を必要時にデコードしてキャッシュする
const beepBankCache = new Map();
function beepBankFor(sampleRate, numberOfChannels) {
  const key = `${sampleRate}_${numberOfChannels}`;
  if (!BEEP_BANK[key]) return null;
  if (!beepBankCache.has(key)) {
    const v = BEEP_BANK[key];
    beepBankCache.set(key, {
      sampleRate,
      numberOfChannels,
      asc: base64ToBytes(v.asc),
      beepFrames: v.beep.map(base64ToBytes),
      silenceFrames: v.silence.map(base64ToBytes),
    });
  }
  return beepBankCache.get(key);
}

/** パススルー抽出した音声サンプルをミュクサへそのまま流し込む */
function addRawAudio(mux, track) {
  let first = true;
  for (const s of track.samples) {
    const meta = first
      ? {
          decoderConfig: {
            codec: 'mp4a.40.2',
            sampleRate: track.config.sampleRate,
            numberOfChannels: track.config.numberOfChannels,
            description: track.description,
          },
        }
      : undefined;
    mux.addAudioChunkRaw(s.data, s.type, s.timestamp, s.duration, meta);
    first = false;
  }
}

/** File/Blob の音声をデコードして AudioBuffer を返す。音声なし・非対応は null */
async function decodeAudioFile(fileOrBlob) {
  const raw = await fileOrBlob.arrayBuffer();
  const ac = new AudioContext();
  try {
    const buf = await ac.decodeAudioData(raw);
    return buf && buf.length > 0 ? buf : null;
  } catch {
    return null;
  } finally {
    ac.close().catch(() => {});
  }
}

/** AudioBuffer から最大2chの Float32Array 配列を取り出す */
function channelsOf(buf) {
  const n = Math.min(2, buf.numberOfChannels);
  const out = [];
  for (let ch = 0; ch < n; ch++) out.push(buf.getChannelData(ch));
  return out;
}

/** チャンネル配列を AAC でエンコードする。非対応は null */
async function encodeAudioChannels(channelData, sampleRate, duration) {
  if (typeof AudioEncoder === 'undefined' || channelData.length === 0) return null;
  const numberOfChannels = channelData.length;
  const config = { codec: 'mp4a.40.2', sampleRate, numberOfChannels, bitrate: 128_000 };
  const support = await AudioEncoder.isConfigSupported(config).catch(() => null);
  if (!support?.supported) return null;

  const chunks = [];
  let audioError = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => chunks.push({ chunk, meta }),
    error: (e) => { audioError = e; },
  });
  encoder.configure(config);

  const totalSamples = Math.min(channelData[0].length, Math.ceil(duration * sampleRate));
  const STEP = 4096;
  for (let offset = 0; offset < totalSamples; offset += STEP) {
    const n = Math.min(STEP, totalSamples - offset);
    const planar = new Float32Array(n * numberOfChannels);
    for (let ch = 0; ch < numberOfChannels; ch++) {
      planar.set(channelData[ch].subarray(offset, offset + n), ch * n);
    }
    encoder.encode(new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: n,
      numberOfChannels,
      timestamp: Math.round((offset / sampleRate) * 1e6),
      data: planar,
    }));
  }
  await encoder.flush();
  if (audioError || chunks.length === 0) return null;
  // description(AudioSpecificConfig)が無いとMP4に正しく格納できず無音になる
  // (一部Safariの既知の落とし穴)。その場合は失敗扱いにして呼び出し側で対処する
  if (!chunks.some(({ meta }) => meta?.decoderConfig?.description)) return null;
  return { config: { codec: 'aac', numberOfChannels, sampleRate }, chunks };
}

function eventOnce(target, okEvent, ngEvent, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeoutMs);
    const ok = () => { cleanup(); resolve(); };
    const ng = () => { cleanup(); reject(new Error(ngEvent)); };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(okEvent, ok);
      target.removeEventListener(ngEvent, ng);
    };
    target.addEventListener(okEvent, ok, { once: true });
    target.addEventListener(ngEvent, ng, { once: true });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}
