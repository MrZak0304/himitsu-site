// 領域トラック: モザイク/ぼかしをかける領域の時間変化を表すピュアロジック。
// track = { id, shape: 'circle'|'ellipse', keyframes: [{t, cx, cy, rx, ry}] }
// t は秒。座標・半径は動画のピクセル座標系。

/** キーフレームを時刻順に並べたコピーを返す */
export function sortedKeyframes(track) {
  return [...track.keyframes].sort((a, b) => a.t - b.t);
}

/** 時刻 t の領域ジオメトリを線形補間で返す。キーフレームが無ければ null */
export function interpolateTrack(track, t) {
  const kfs = sortedKeyframes(track);
  if (kfs.length === 0) return null;
  if (t <= kfs[0].t) return geomOf(kfs[0]);
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return geomOf(last);
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return {
        cx: lerp(a.cx, b.cx, u),
        cy: lerp(a.cy, b.cy, u),
        rx: lerp(a.rx, b.rx, u),
        ry: lerp(a.ry, b.ry, u),
      };
    }
  }
  return geomOf(last);
}

/** 時刻 t のキーフレームを更新、無ければ挿入する(t の許容誤差 eps 秒) */
export function upsertKeyframe(track, t, geom, eps = 1 / 60) {
  const existing = track.keyframes.find((kf) => Math.abs(kf.t - t) < eps);
  if (existing) {
    Object.assign(existing, geomOf(geom));
    existing.t = t;
  } else {
    track.keyframes.push({ t, ...geomOf(geom) });
  }
  track.keyframes.sort((a, b) => a.t - b.t);
}

/** 時刻 t のキーフレームを削除する。削除できたら true */
export function removeKeyframe(track, t, eps = 1 / 60) {
  const i = track.keyframes.findIndex((kf) => Math.abs(kf.t - t) < eps);
  if (i < 0) return false;
  track.keyframes.splice(i, 1);
  return true;
}

/**
 * トラックが動画全体で通過する範囲の外接矩形(復元データの切り出し枠)。
 * step 秒間隔でサンプリングし、pad ピクセル余白を足し、動画境界にクランプ、
 * 幅・高さは偶数に丸める(H.264 の制約)。
 */
export function unionBounds(track, duration, videoW, videoH, { step = 0.1, pad = 4 } = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const times = new Set();
  for (let t = 0; t <= duration + 1e-9; t += step) times.add(Math.min(t, duration));
  for (const kf of track.keyframes) times.add(Math.max(0, Math.min(kf.t, duration)));
  for (const t of times) {
    const g = interpolateTrack(track, t);
    if (!g) continue;
    x0 = Math.min(x0, g.cx - g.rx);
    y0 = Math.min(y0, g.cy - g.ry);
    x1 = Math.max(x1, g.cx + g.rx);
    y1 = Math.max(y1, g.cy + g.ry);
  }
  if (!Number.isFinite(x0)) return null;
  x0 = clamp(Math.floor(x0 - pad), 0, videoW);
  y0 = clamp(Math.floor(y0 - pad), 0, videoH);
  x1 = clamp(Math.ceil(x1 + pad), 0, videoW);
  y1 = clamp(Math.ceil(y1 + pad), 0, videoH);
  let w = Math.max(2, x1 - x0);
  let h = Math.max(2, y1 - y0);
  if (w % 2) w = x0 + w + 1 <= videoW ? w + 1 : w - 1;
  if (h % 2) h = y0 + h + 1 <= videoH ? h + 1 : h - 1;
  return { x: x0, y: y0, w, h };
}

function geomOf(o) {
  return { cx: o.cx, cy: o.cy, rx: o.rx, ry: o.ry };
}

function lerp(a, b, u) {
  return a + (b - a) * u;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
