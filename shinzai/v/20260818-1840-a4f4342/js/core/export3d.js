// js/core/export3d.js — 3Dソフト(Blender/ZBrush等)向けの OBJ 書き出し(UI非依存・ピュア関数)
// 三面図で編集している関節は内部で 3D 座標(x=右, y=下, z=前、単位 cm、股が原点)を持つ。
// それをそのまま Y-up(OBJ 標準)に変換し、骨格線=線径のチューブ、関節=小球、任意で肉付けの目安=丸いブロックを出す。
// 単位: 1 = 1cm(Blender では読み込み時に Scale 0.01 で m に)。第60弾FB。

import { BONES, FOOT_BONES, neckStubEnd } from './pose3d.js';

const fmt = (n) => (Math.round(n * 1000) / 1000).toString();

// 内部座標 → OBJ(Y-up)。足裏が Y=0 になるように持ち上げる
function toObj(p, soleY) {
  return { x: p.x, y: soleY - p.y, z: p.z };
}

function basis(d) {
  const l = Math.hypot(d.x, d.y, d.z) || 1;
  const u = { x: d.x / l, y: d.y / l, z: d.z / l };
  const ref = Math.abs(u.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  // n1 = normalize(cross(u, ref)), n2 = cross(u, n1)
  let n1 = { x: u.y * ref.z - u.z * ref.y, y: u.z * ref.x - u.x * ref.z, z: u.x * ref.y - u.y * ref.x };
  const nl = Math.hypot(n1.x, n1.y, n1.z) || 1;
  n1 = { x: n1.x / nl, y: n1.y / nl, z: n1.z / nl };
  const n2 = { x: u.y * n1.z - u.z * n1.y, y: u.z * n1.x - u.x * n1.z, z: u.x * n1.y - u.y * n1.x };
  return { u, n1, n2, len: l };
}

class ObjWriter {
  constructor() { this.lines = []; this.vcount = 0; }
  object(name) { this.lines.push(`o ${name}`); }
  vertex(p) { this.lines.push(`v ${fmt(p.x)} ${fmt(p.y)} ${fmt(p.z)}`); this.vcount += 1; return this.vcount; }
  face(idx) { this.lines.push(`f ${idx.join(' ')}`); }
  // 2点を結ぶチューブ(端は開いた円筒。半径 r、side 角形)
  tube(a, b, r, sides = 8) {
    const { n1, n2, len } = basis({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });
    if (len < 1e-6) return;
    const ringA = []; const ringB = [];
    for (let i = 0; i < sides; i++) {
      const th = (i / sides) * Math.PI * 2;
      const ox = (n1.x * Math.cos(th) + n2.x * Math.sin(th)) * r;
      const oy = (n1.y * Math.cos(th) + n2.y * Math.sin(th)) * r;
      const oz = (n1.z * Math.cos(th) + n2.z * Math.sin(th)) * r;
      ringA.push(this.vertex({ x: a.x + ox, y: a.y + oy, z: a.z + oz }));
      ringB.push(this.vertex({ x: b.x + ox, y: b.y + oy, z: b.z + oz }));
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.face([ringA[i], ringB[i], ringB[j], ringA[j]]);
    }
  }
  // 楕円体(UV球)。rx/ry/rz 半径、seg 分割
  ellipsoid(c, rx, ry, rz, segU = 12, segV = 8) {
    const rows = [];
    for (let v = 0; v <= segV; v++) {
      const phi = (v / segV) * Math.PI; // 0..π
      const row = [];
      for (let u = 0; u < segU; u++) {
        const th = (u / segU) * Math.PI * 2;
        row.push(this.vertex({
          x: c.x + rx * Math.sin(phi) * Math.cos(th),
          y: c.y + ry * Math.cos(phi),
          z: c.z + rz * Math.sin(phi) * Math.sin(th),
        }));
      }
      rows.push(row);
    }
    for (let v = 0; v < segV; v++) {
      for (let u = 0; u < segU; u++) {
        const u2 = (u + 1) % segU;
        this.face([rows[v][u], rows[v + 1][u], rows[v + 1][u2], rows[v][u2]]);
      }
    }
  }
  toString() { return `${this.lines.join('\n')}\n`; }
}

// joints: pose3d の関節(cm、股原点、y下)。seg: computeArmature().segments。
// opts.name: オブジェクト名の接頭辞、opts.wireMm: 線径(mm)、opts.flesh: 肉付けの目安を含める
export function buildObj(joints, seg, opts = {}) {
  const wireR = ((opts.wireMm ?? 2) / 10) / 2 * 1.4; // 2本撚りぶん少し太め(cm)
  const soleY = Math.max(joints.ankleL.y, joints.ankleR.y) + seg.ankle;
  const P = (p) => toObj(p, soleY);
  const w = new ObjWriter();
  w.lines.push('# 芯材メーカー 書き出し(単位: cm。Blender では読み込み時に Scale 0.01 で m)');
  w.lines.push(`# 完成サイズ ${seg.figureHeight}cm / 線径 ${opts.wireMm ?? 2}mm`);
  const name = (opts.name || 'shinzai').replace(/\s+/g, '_');

  // 骨格線(芯材)
  w.object(`${name}_armature`);
  for (const [a, b] of BONES) w.tube(P(joints[a]), P(joints[b]), wireR);
  // 首の先(頭への差し込み)・手首の先・足首の先(接続しろ)
  w.tube(P(joints.neck), P(neckStubEnd(joints, seg.head)), wireR);
  for (const s of ['L', 'R']) {
    const e = joints[`elbow${s}`]; const wr = joints[`wrist${s}`];
    const d = { x: wr.x - e.x, y: wr.y - e.y, z: wr.z - e.z }; const l = Math.hypot(d.x, d.y, d.z) || 1;
    const stub = seg.hand * 0.4;
    w.tube(P(wr), P({ x: wr.x + (d.x / l) * stub, y: wr.y + (d.y / l) * stub, z: wr.z + (d.z / l) * stub }), wireR);
    const kn = joints[`knee${s}`]; const an = joints[`ankle${s}`];
    const d2 = { x: an.x - kn.x, y: an.y - kn.y, z: an.z - kn.z }; const l2 = Math.hypot(d2.x, d2.y, d2.z) || 1;
    w.tube(P(an), P({ x: an.x + (d2.x / l2) * seg.ankle, y: an.y + (d2.y / l2) * seg.ankle, z: an.z + (d2.z / l2) * seg.ankle }), wireR);
  }
  // 関節の小球(位置の目印)
  w.object(`${name}_joints`);
  for (const id of ['spineTop', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR', 'hip', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']) {
    const c = P(joints[id]);
    w.ellipsoid(c, wireR * 1.8, wireR * 1.8, wireR * 1.8, 8, 6);
  }
  // つま先の向き(足)
  for (const [a, b] of FOOT_BONES) w.tube(P(joints[a]), P(joints[b]), wireR * 0.6, 6);

  if (opts.flesh) {
    // 肉付けの目安(粗いブロック)。posefig の太さ比率に合わせる: 基準 unit = min(肩幅, 頭高×1.5)
    const unit = Math.min(seg.shoulderWidth, seg.head * 1.5);
    const rArm = unit * 0.15; const rFore = unit * 0.12; const rLeg = unit * 0.22; const rShin = unit * 0.16;
    w.object(`${name}_flesh_guide`);
    // 頭
    const hc = P(neckStubEnd(joints, seg.head)); // 首の先=頭の中
    const headR = seg.head / 2;
    const top = P(joints.top); const neck = P(joints.neck);
    w.ellipsoid({ x: (top.x + neck.x) / 2, y: (top.y + neck.y) / 2, z: (top.z + neck.z) / 2 }, headR * 0.85, headR, headR * 0.9);
    void hc;
    // 胸〜腹(背骨の上 2/3)、腰(骨盤)
    const st = P(joints.spineTop); const hp = P(joints.hip);
    const chestC = { x: st.x + (hp.x - st.x) * 0.3, y: st.y + (hp.y - st.y) * 0.3, z: st.z + (hp.z - st.z) * 0.3 };
    const spineLen = Math.hypot(st.x - hp.x, st.y - hp.y, st.z - hp.z);
    w.ellipsoid(chestC, seg.shoulderWidth * 0.46, spineLen * 0.36, unit * 0.31);
    const pelvC = { x: hp.x, y: hp.y + spineLen * 0.12, z: hp.z };
    w.ellipsoid(pelvC, seg.pelvisWidth * 0.5 + rLeg * 0.9, spineLen * 0.22, unit * 0.3);
    // 手足のカプセル(円筒+関節の球)
    for (const s of ['L', 'R']) {
      w.tube(P(joints[`shoulder${s}`]), P(joints[`elbow${s}`]), rArm, 10);
      w.tube(P(joints[`elbow${s}`]), P(joints[`wrist${s}`]), rFore, 10);
      w.tube(P(joints[`hip${s}`]), P(joints[`knee${s}`]), rLeg, 10);
      w.tube(P(joints[`knee${s}`]), P(joints[`ankle${s}`]), rShin, 10);
      for (const [id, r] of [[`shoulder${s}`, rArm], [`elbow${s}`, rFore], [`knee${s}`, rShin * 1.1], [`hip${s}`, rLeg]]) {
        w.ellipsoid(P(joints[id]), r, r, r, 8, 6);
      }
      // 手・足
      const wr = P(joints[`wrist${s}`]); const e = P(joints[`elbow${s}`]);
      const dw = { x: wr.x - e.x, y: wr.y - e.y, z: wr.z - e.z }; const lw = Math.hypot(dw.x, dw.y, dw.z) || 1;
      w.ellipsoid({ x: wr.x + (dw.x / lw) * seg.hand * 0.5, y: wr.y + (dw.y / lw) * seg.hand * 0.5, z: wr.z + (dw.z / lw) * seg.hand * 0.5 }, seg.hand * 0.28, seg.hand * 0.5, seg.hand * 0.15, 8, 6);
      const an = P(joints[`ankle${s}`]); const toe = P(joints[`toe${s}`]);
      w.ellipsoid({ x: (an.x + toe.x) / 2, y: (an.y + toe.y) / 2 - seg.ankle * 0.1, z: (an.z + toe.z) / 2 }, seg.footLength * 0.25, seg.ankle * 0.5, seg.footLength * 0.5, 8, 6);
    }
  }
  return w.toString();
}
