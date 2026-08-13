// 領域トラック: モザイク/ぼかしをかける領域の時間変化を表すピュアロジック。
// track = { id, shape: 'circle'|'ellipse'|'rect', keyframes: [{t, cx, cy, rx, ry}] }
//   円・楕円・矩形は中心(cx,cy)と半径(rx,ry)で表す。
// 自由形状(なげなわ): shape:'poly'。基準輪郭 track.points(重心を原点に平行移動した
//   相対座標の配列 [{x,y}...])を持ち、keyframes は {t, cx, cy, scale} で
//   輪郭全体の移動・拡縮を表す。時刻tの絶対頂点 = {cx + x*scale, cy + y*scale}。
// t は秒。座標・半径は動画のピクセル座標系。

/** キーフレームを時刻順に並べたコピーを返す */
export function sortedKeyframes(track) {
  return [...track.keyframes].sort((a, b) => a.t - b.t);
}

/**
 * 時刻 t の領域ジオメトリを線形補間で返す。キーフレームが無ければ null。
 * poly の場合は絶対頂点列 poly:[{x,y}] と外接矩形(cx,cy,rx,ry)も含めて返す。
 */
export function interpolateTrack(track, t) {
  const kfs = sortedKeyframes(track);
  if (kfs.length === 0) return null;
  let interp;
  if (t <= kfs[0].t) interp = geomOf(kfs[0]);
  else if (t >= kfs[kfs.length - 1].t) interp = geomOf(kfs[kfs.length - 1]);
  else {
    interp = geomOf(kfs[kfs.length - 1]);
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i];
      const b = kfs[i + 1];
      if (t >= a.t && t <= b.t) {
        const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
        interp = {
          cx: lerp(a.cx, b.cx, u),
          cy: lerp(a.cy, b.cy, u),
        };
        if (a.scale !== undefined) interp.scale = lerp(a.scale, b.scale ?? 1, u);
        if (a.rx !== undefined) { interp.rx = lerp(a.rx, b.rx, u); interp.ry = lerp(a.ry, b.ry, u); }
        break;
      }
    }
  }
  if (track.shape === 'poly') return resolvePoly(track, interp);
  return interp;
}

/** poly の補間結果(cx,cy,scale)から絶対頂点列と外接矩形を求める */
function resolvePoly(track, interp) {
  const scale = interp.scale ?? 1;
  const poly = track.points.map((p) => ({ x: interp.cx + p.x * scale, y: interp.cy + p.y * scale }));
  let mx = 0, my = 0;
  for (const p of track.points) { mx = Math.max(mx, Math.abs(p.x)); my = Math.max(my, Math.abs(p.y)); }
  return { cx: interp.cx, cy: interp.cy, scale, rx: mx * scale, ry: my * scale, poly };
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
  const g = { cx: o.cx, cy: o.cy };
  if (o.scale !== undefined) g.scale = o.scale;
  if (o.rx !== undefined) { g.rx = o.rx; g.ry = o.ry; }
  return g;
}

/**
 * なめらかにたどった生の点列から poly トラック用の基準輪郭を作る。
 * 重心を原点に移動した相対点列と、初期キーフレーム{cx,cy,scale:1}を返す。
 * 近すぎる点は間引く(minDist ピクセル)。
 */
export function buildPolyPoints(rawPoints, minDist = 4) {
  const pts = [];
  for (const p of rawPoints) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDist) pts.push({ x: p.x, y: p.y });
  }
  if (pts.length < 3) return null;
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  const cx = sx / pts.length;
  const cy = sy / pts.length;
  return {
    points: pts.map((p) => ({ x: p.x - cx, y: p.y - cy })),
    center: { cx, cy },
  };
}

/** 点が poly(絶対頂点列)の内側かを判定する(レイキャスティング) */
export function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function lerp(a, b, u) {
  return a + (b - a) * u;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
