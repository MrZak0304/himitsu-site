// ピー音: 音声サンプル配列の指定時間範囲をトーン/カスタム音で置き換えるピュアロジック。
// UI・WebAudio 非依存で Node からテストできる。復元は「元音声を復元データに含める」
// 合成方式で行うため、この置き換え自体は不可逆でよい(SPEC §2)。

const DEFAULT_FREQ = 1000; // テレビ的なピー音(1kHz)
const FADE_SEC = 0.005; // クリックノイズ防止のフェード(5ms)

/**
 * channelData(Float32Array の配列)の ranges [{start,end}] 秒区間を
 * ピー音で置き換える(破壊的)。custom を渡すとその音をループで敷き詰める。
 * @param {Float32Array[]} channelData
 * @param {number} sampleRate
 * @param {{start:number,end:number}[]} ranges
 * @param {{channelData: Float32Array[]}|null} custom
 * @param {number} amplitude 標準トーンの音量(0〜1)
 */
export function applyBeeps(channelData, sampleRate, ranges, custom = null, amplitude = 0.25) {
  if (channelData.length === 0) return;
  const total = channelData[0].length;
  const fade = Math.max(1, Math.floor(sampleRate * FADE_SEC));
  for (const r of ranges) {
    const s = Math.max(0, Math.floor(r.start * sampleRate));
    const e = Math.min(total, Math.ceil(r.end * sampleRate));
    if (e <= s) continue;
    for (let ch = 0; ch < channelData.length; ch++) {
      const data = channelData[ch];
      const src = custom ? custom.channelData[ch % custom.channelData.length] : null;
      for (let i = s; i < e; i++) {
        const value = src
          ? src[(i - s) % src.length]
          : Math.sin((2 * Math.PI * DEFAULT_FREQ * (i - s)) / sampleRate) * amplitude;
        // 区間の端はフェードで滑らかに(置き換え音のみ減衰、元音声は消す)
        const env = Math.min(1, (i - s) / fade, (e - 1 - i) / fade);
        data[i] = value * Math.max(0, env);
      }
    }
  }
}

/** 妥当な範囲(start<end)だけを時刻順に並べて返す。UI 入力の整理用 */
export function normalizeBeepRanges(ranges, duration) {
  return ranges
    .map((r) => ({
      start: Math.max(0, Math.min(r.start, duration)),
      end: Math.max(0, Math.min(r.end, duration)),
    }))
    .filter((r) => r.end - r.start > 0.01)
    .sort((a, b) => a.start - b.start);
}
