// 音声トラックのパススルー抽出(再エンコードなし)。
// WebCodecs の AudioEncoder が使えない環境(iPhone Safari 等)でも音声を残すため、
// 元MP4のAAC音声サンプルをそのまま取り出して出力へコピーする用途で使う。
// mp4box.js(js/vendor/mp4box.all.min.js、クラシックscriptでグローバル読み込み)に依存。

/**
 * MP4 バイト列から AAC 音声トラックを抽出する。
 * @returns {Promise<{config, description, samples} | null>}
 *   config: { codec:'aac', numberOfChannels, sampleRate }
 *   description: AudioSpecificConfig(esds由来。無ければ合成)
 *   samples: [{ data:Uint8Array, type:'key'|'delta', timestamp:µs, duration:µs }]
 *   音声なし・AAC以外・mp4box未読込は null。
 */
export function extractAudioTrack(bytes, timeoutMs = 15000) {
  const MP4Box = globalThis.MP4Box;
  if (!MP4Box) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(value);
      }
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    let file;
    try {
      file = MP4Box.createFile();
    } catch {
      return finish(null);
    }
    let track = null;
    let timescale = 1;
    const samples = [];

    file.onError = () => finish(null);
    file.onReady = (info) => {
      track = info.audioTracks?.[0];
      if (!track || !/^mp4a/.test(track.codec)) return finish(null);
      timescale = track.timescale;
      file.setExtractionOptions(track.id, null, { nbSamples: 1_000_000 });
      file.start();
    };
    file.onSamples = (id, user, newSamples) => {
      samples.push(...newSamples);
      if (track && samples.length >= track.nb_samples) {
        finish(buildResult(file, track, timescale, samples));
      }
    };

    try {
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      buf.fileStart = 0;
      file.appendBuffer(buf);
      file.flush();
    } catch {
      finish(null);
    }
  });
}

function buildResult(file, track, timescale, samples) {
  const numberOfChannels = track.audio?.channel_count ?? 2;
  const sampleRate = track.audio?.sample_rate ?? 48000;
  let description = null;
  try {
    // esds → ES_Descriptor → DecoderConfigDescriptor → DecoderSpecificInfo(AudioSpecificConfig)
    const entry = file.getTrackById(track.id).mdia.minf.stbl.stsd.entries[0];
    const dsi = entry.esds.esd.descs[0].descs[0];
    if (dsi?.data?.length) description = new Uint8Array(dsi.data);
  } catch { /* 下で合成する */ }
  if (!description) description = synthesizeAacConfig(sampleRate, numberOfChannels);
  return {
    config: { codec: 'aac', numberOfChannels, sampleRate },
    description,
    samples: samples.map((s) => ({
      data: new Uint8Array(s.data),
      type: s.is_sync ? 'key' : 'delta',
      timestamp: Math.round((s.cts / timescale) * 1e6),
      duration: Math.round((s.duration / timescale) * 1e6),
    })),
  };
}

/** AudioSpecificConfig(AAC-LC)を sampleRate/ch から合成する(esds が読めない場合の保険) */
function synthesizeAacConfig(sampleRate, channels) {
  const FREQS = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  let idx = FREQS.indexOf(sampleRate);
  if (idx < 0) idx = 4; // 44100 扱い
  const out = new Uint8Array(2);
  out[0] = (2 << 3) | (idx >> 1); // AudioObjectType=2(AAC-LC)
  out[1] = ((idx & 1) << 7) | (channels << 3);
  return out;
}
