// 顔検出の結果(フレームごとの顔bbox列)を、既存の領域トラック(楕円キーフレーム列)へ
// 変換するピュアロジック。UI・MediaPipe 非依存で Node からテストできる。
//
// 入力 detections: [{ t, faces: [{cx,cy,rx,ry, score}] }] を時刻順に。
//   faces は正規化なしのピクセル座標(楕円換算済み)。
// 出力: [{ shape:'ellipse', name, keyframes:[{t,cx,cy,rx,ry}] }]

/**
 * フレーム列の顔を時間方向に対応づけ(トラッキング)、顔ごとのトラックにまとめる。
 * 近接する顔を同一人物とみなす(中心距離が閾値内)。一定フレーム見えなくなったら打ち切る。
 * @param {{t:number, faces:{cx,cy,rx,ry,score}[]}[]} detections 時刻順
 * @param {object} opts { maxGap:途切れ許容秒, matchDist:同一とみなす中心距離(領域幅比) }
 */
export function facesToTracks(detections, opts = {}) {
  const { maxGap = 0.4, matchDist = 0.6, minFrames = 2 } = opts;
  const active = []; // { keyframes:[{t,cx,cy,rx,ry}], lastT }
  const finished = [];

  for (const { t, faces } of detections) {
    // 直前から maxGap を超えて途切れた active は確定へ移す
    for (let i = active.length - 1; i >= 0; i--) {
      if (t - active[i].lastT > maxGap) {
        finished.push(active[i]);
        active.splice(i, 1);
      }
    }
    const usedFace = new Set();
    // 既存トラックに最も近い顔を割り当てる(貪欲マッチング)
    for (const track of active) {
      const last = track.keyframes[track.keyframes.length - 1];
      let best = -1;
      let bestDist = Infinity;
      for (let j = 0; j < faces.length; j++) {
        if (usedFace.has(j)) continue;
        const f = faces[j];
        const tol = Math.max(f.rx, last.rx) * 2 * matchDist;
        const d = Math.hypot(f.cx - last.cx, f.cy - last.cy);
        if (d < tol && d < bestDist) { bestDist = d; best = j; }
      }
      if (best >= 0) {
        const f = faces[best];
        track.keyframes.push({ t, cx: f.cx, cy: f.cy, rx: f.rx, ry: f.ry });
        track.lastT = t;
        usedFace.add(best);
      }
    }
    // マッチしなかった顔は新規トラック
    for (let j = 0; j < faces.length; j++) {
      if (usedFace.has(j)) continue;
      const f = faces[j];
      active.push({ keyframes: [{ t, cx: f.cx, cy: f.cy, rx: f.rx, ry: f.ry }], lastT: t });
    }
  }
  finished.push(...active);

  // 短すぎるトラック(誤検出)を捨て、キーフレームを間引いて名前を付ける
  return finished
    .filter((tr) => tr.keyframes.length >= minFrames)
    .sort((a, b) => a.keyframes[0].t - b.keyframes[0].t)
    .map((tr, i) => ({
      shape: 'ellipse',
      name: `顔${i + 1}`,
      enabled: true,
      keyframes: simplifyKeyframes(tr.keyframes),
    }));
}

/**
 * キーフレームを間引く(直線的に補間できる中間点を除く)。
 * 位置・サイズが tol(領域サイズ比)以内で線形予測できる点は落とす。
 */
export function simplifyKeyframes(keyframes, tol = 0.12) {
  if (keyframes.length <= 2) return keyframes.map(roundKf);
  const out = [keyframes[0]];
  let anchor = keyframes[0];
  for (let i = 1; i < keyframes.length - 1; i++) {
    const prev = keyframes[i - 1];
    const cur = keyframes[i];
    const next = keyframes[i + 1];
    // anchor→next の直線上に cur が乗るか(時間比で内挿して比較)
    const u = (cur.t - anchor.t) / (next.t - anchor.t || 1);
    const pred = {
      cx: anchor.cx + (next.cx - anchor.cx) * u,
      cy: anchor.cy + (next.cy - anchor.cy) * u,
      rx: anchor.rx + (next.rx - anchor.rx) * u,
      ry: anchor.ry + (next.ry - anchor.ry) * u,
    };
    const scale = Math.max(cur.rx, cur.ry, 1);
    const err = Math.max(
      Math.abs(pred.cx - cur.cx),
      Math.abs(pred.cy - cur.cy),
      Math.abs(pred.rx - cur.rx),
      Math.abs(pred.ry - cur.ry),
    ) / scale;
    if (err > tol) {
      out.push(cur);
      anchor = cur;
    }
    void prev;
  }
  out.push(keyframes[keyframes.length - 1]);
  return out.map(roundKf);
}

/** 顔検出bbox(中心と幅高さ)を楕円ジオメトリに変換。scaleで少し大きめに覆う */
export function faceBoxToEllipse(box, scale = 1.15) {
  return {
    cx: box.x + box.w / 2,
    cy: box.y + box.h / 2,
    rx: (box.w / 2) * scale,
    ry: (box.h / 2) * scale,
    score: box.score ?? 1,
  };
}

function roundKf(kf) {
  return {
    t: Math.round(kf.t * 1000) / 1000,
    cx: Math.round(kf.cx),
    cy: Math.round(kf.cy),
    rx: Math.round(kf.rx),
    ry: Math.round(kf.ry),
  };
}
