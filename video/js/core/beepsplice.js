// スプライス方式のピー音: デマルチプレクサで取り出した AAC フレーム列の該当区間だけを
// 事前エンコード済みのピー音フレーム(js/assets/beep-bank.js)に差し替えるピュアロジック。
// デコードもエンコードもしないため AudioEncoder 非対応環境(iPhone Safari 等)でも動く。
// 粒度は AAC 1フレーム=1024サンプル(48kHzで約21ms)。範囲端はこの単位に丸まる。

/**
 * サンプル列 [{data,type,timestamp(µs),duration(µs)}] の ranges(秒)区間を
 * ピー音フレームに差し替えた新しい配列を返す(元配列は変更しない)。
 */
export function spliceBeepFrames(samples, ranges, beepFrames) {
  let k = 0;
  return samples.map((s) => {
    const mid = s.timestamp + s.duration / 2;
    const inRange = ranges.some((r) => mid >= r.start * 1e6 && mid < r.end * 1e6);
    if (!inRange) return s;
    return { ...s, data: beepFrames[k++ % beepFrames.length] };
  });
}

/**
 * 音声のない動画用に、無音+ピー音のフレーム列をゼロから組み立てる。
 * bank: { sampleRate, beepFrames, silenceFrames }
 */
export function buildBeepOnlyTrack(durationSec, ranges, bank) {
  const frameDur = 1024 / bank.sampleRate; // 秒
  const count = Math.max(1, Math.ceil(durationSec / frameDur));
  const out = [];
  let beep = 0;
  let silence = 0;
  for (let i = 0; i < count; i++) {
    const mid = (i + 0.5) * frameDur;
    const inRange = ranges.some((r) => mid >= r.start && mid < r.end);
    out.push({
      data: inRange
        ? bank.beepFrames[beep++ % bank.beepFrames.length]
        : bank.silenceFrames[silence++ % bank.silenceFrames.length],
      type: 'key',
      timestamp: Math.round(i * frameDur * 1e6),
      duration: Math.round(frameDur * 1e6),
    });
  }
  return out;
}
