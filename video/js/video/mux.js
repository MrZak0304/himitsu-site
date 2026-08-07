// MP4 まわりのバイト操作:
//  - createMuxer: WebCodecs の出力を MP4 に多重化(vendor/mp4-muxer 使用)
//  - embedPayload / extractPayload: B案(MP4埋め込み)用。MP4末尾に標準の
//    無視されるボックス 'skip' として復元ペイロードを付加・抽出する。
//    埋め込み・抽出はピュアなバイト操作で Node からもテストできる。

import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';
import { looksLikePayload } from '../core/keyformat.js';

/** mp4-muxer のラッパ。audio は {codec:'aac'|'opus', numberOfChannels, sampleRate} か null */
export function createMuxer({ width, height, fps, audio = null }) {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: audio
      ? { codec: audio.codec, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate }
      : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  return {
    addVideoChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    addAudioChunk: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    // パススルー用: デマルチプレクサで取り出した生サンプルをそのまま追加する
    addAudioChunkRaw: (data, type, timestamp, duration, meta) =>
      muxer.addAudioChunkRaw(data, type, timestamp, duration, meta),
    finalize: () => {
      muxer.finalize();
      return new Uint8Array(target.buffer);
    },
  };
}

/** 解像度から H.264 のコーデック文字列を選ぶ(Baseline、レベルは解像度で切替) */
export function avcCodecString(width, height) {
  const mb = (width * height) / 256; // マクロブロック数
  if (mb <= 3600) return 'avc1.42001f'; // ~720p level 3.1
  if (mb <= 8192) return 'avc1.420028'; // ~1080p level 4.0
  return 'avc1.420032'; // level 5.0
}

/** MP4 バイト列の末尾に復元ペイロードを 'skip' ボックスとして付加する */
export function embedPayload(mp4Bytes, payload) {
  const box = new Uint8Array(8 + payload.length);
  const view = new DataView(box.buffer);
  view.setUint32(0, box.length, false);
  box[4] = 0x73; box[5] = 0x6b; box[6] = 0x69; box[7] = 0x70; // 'skip'
  box.set(payload, 8);
  const out = new Uint8Array(mp4Bytes.length + box.length);
  out.set(mp4Bytes, 0);
  out.set(box, mp4Bytes.length);
  return out;
}

/**
 * MP4 のトップレベルボックスを走査し、埋め込まれた復元ペイロードを返す。
 * 見つからなければ null。
 */
export function extractPayload(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  while (pos + 8 <= bytes.length) {
    let size = view.getUint32(pos, false);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    let headerSize = 8;
    if (size === 1) {
      if (pos + 16 > bytes.length) return null;
      const hi = view.getUint32(pos + 8, false);
      const lo = view.getUint32(pos + 12, false);
      size = hi * 2 ** 32 + lo;
      headerSize = 16;
    } else if (size === 0) {
      size = bytes.length - pos; // 最後のボックス
    }
    if (size < headerSize || pos + size > bytes.length) return null; // 壊れた構造
    if (type === 'skip') {
      const payload = bytes.subarray(pos + headerSize, pos + size);
      if (looksLikePayload(payload)) return payload;
    }
    pos += size;
  }
  return null;
}
