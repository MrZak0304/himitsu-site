// 「きょうの1枚カード」のレイアウト計算(ピュア・UI非依存)。v1.1 U1。
// 入力(日付・タグ名・写真の有無・テーマ色)から、描画側(card-render.js)が
// そのまま使える描画命令(背景・テキスト行・位置・サイズ)を組み立てる。
// 本文は載せない(既定で非公開=不変条件1の趣旨)。文言に「無料」「暗号化」を使わない。

export const CARD_SIZE = 1080; // 正方形(SNS向け)
export const CARD_MAX_TAGS = 8; // これを超えたぶんは「+N」で畳む
export const CARD_APP_NAME = 'ポンとにっき';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const PAD = 72; // 外周の余白
const TAG_FONT = 52;
const TAG_PAD_X = 34; // チップの左右パディング
const TAG_GAP = 20;
const TAG_LINE_H = 96;
const DATE_FONT = 44;
const BRAND_FONT = 36;
const STAMP_TILT = [-3, 2.5, -2, 3, -1.5, 2, -2.5, 1.5]; // 度

// 'YYYY-MM-DD' → '2026年10月5日(月)'
export function formatCardDate(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey ?? '');
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wd = WEEKDAYS[new Date(y, mo - 1, d).getDay()];
  return `${y}年${mo}月${d}日(${wd})`;
}

// 文字列の描画幅の見積もり(canvas の measureText を使わずピュアに計算する)。
// 全角=フォントサイズ、半角=0.55倍。実描画のずれはチップ余白で吸収する。
export function estimateTextWidth(text, fontSize) {
  let w = 0;
  for (const ch of text ?? '') {
    w += /[ -~]/.test(ch) ? fontSize * 0.55 : fontSize;
  }
  return w;
}

// タグ名の配列を、幅 maxWidth に収まる行に折り返す。CARD_MAX_TAGS を超えた分は「+N」の1チップにまとめる。
// 戻り値: [{ chips: [{ text, width }] , width }] (行ごと)
export function layoutTagRows(tagNames, { maxWidth, fontSize = TAG_FONT, maxTags = CARD_MAX_TAGS } = {}) {
  const names = (tagNames ?? []).filter((t) => typeof t === 'string' && t.trim() !== '');
  const shown = names.slice(0, maxTags);
  const rest = names.length - shown.length;
  const texts = rest > 0 ? [...shown, `+${rest}`] : shown;
  const rows = [];
  let cur = { chips: [], width: 0 };
  for (const text of texts) {
    const width = Math.min(maxWidth, estimateTextWidth(text, fontSize) + TAG_PAD_X * 2);
    const add = cur.chips.length === 0 ? width : TAG_GAP + width;
    if (cur.chips.length > 0 && cur.width + add > maxWidth) {
      rows.push(cur);
      cur = { chips: [], width: 0 };
    }
    cur.chips.push({ text, width });
    cur.width += cur.chips.length === 1 ? width : TAG_GAP + width;
  }
  if (cur.chips.length > 0) rows.push(cur);
  return rows;
}

// カード全体のレイアウト。
// input: { dateKey, tagNames, hasPhoto, theme: { bg, accent, fg } }
// 戻り値は描画命令: { size, background, photo, scrim, tagRows(位置付き), date, brand }
export function layoutCard({ dateKey, tagNames = [], hasPhoto = false, theme = {} } = {}) {
  const size = CARD_SIZE;
  const accent = theme.accent ?? '#4a7dbd';
  const bg = theme.bg ?? '#f7f6f2';
  const fg = theme.fg ?? '#2b2925';
  const maxWidth = size - PAD * 2;
  const rows = layoutTagRows(tagNames, { maxWidth });

  // 下から積む: ブランド行 → 日付 → タグ行(複数)。写真があれば下部にスクリムを敷く
  const brandY = size - PAD;
  const dateY = brandY - BRAND_FONT - 28;
  const tagsBottom = dateY - DATE_FONT - 24;
  let chipSeq = 0;
  const tagRows = rows.map((row, i) => {
    const y = tagsBottom - (rows.length - 1 - i) * TAG_LINE_H; // 行の下端
    let x = PAD;
    const chips = row.chips.map((c) => {
      const chip = {
        text: c.text, x, y: y - TAG_LINE_H + 12, w: c.width, h: TAG_LINE_H - 20, fontSize: TAG_FONT,
        // ハンコ風: 押した跡のように少しずつ傾ける(並び順で決まる=同じ入力なら同じ見た目)
        rotate: STAMP_TILT[chipSeq % STAMP_TILT.length],
      };
      chipSeq += 1;
      x += c.width + TAG_GAP;
      return chip;
    });
    return { chips };
  });
  const contentTop = tagRows.length > 0 ? tagRows[0].chips[0].y - 40 : dateY - DATE_FONT - 40;

  return {
    size,
    background: hasPhoto ? { kind: 'photo' } : { kind: 'gradient', from: accent, to: bg },
    photo: hasPhoto ? { x: 0, y: 0, w: size, h: size, fit: 'cover' } : null,
    // 写真の上の文字を読ませる膜。写真が無いときはグラデーションに薄く(テーマ色で十分読める)
    // 膜は文字より十分上から始めてなだらかに濃くする(境目が見えないように)
    scrim: { y: Math.max(0, contentTop - 260), h: size - Math.max(0, contentTop - 260), alpha: hasPhoto ? 0.62 : 0.18 },
    tagRows,
    date: { text: formatCardDate(dateKey), x: PAD, y: dateY, fontSize: DATE_FONT },
    brand: { text: CARD_APP_NAME, x: PAD, y: brandY, fontSize: BRAND_FONT },
    colors: {
      chipBg: hasPhoto ? 'rgba(255,255,255,0.90)' : 'rgba(255,255,255,0.96)',
      chipText: accent,
      stampInk: accent, // ハンコの枠線(二重枠)
      text: hasPhoto ? '#ffffff' : fg,
      brand: hasPhoto ? 'rgba(255,255,255,0.85)' : accent,
      scrim: hasPhoto ? '#000000' : accent,
    },
  };
}

// 写真の表示範囲(ピュア)。cx, cy = 注視点(画像内の相対位置 0〜1)、zoom = 拡大率(1=正方形いっぱい・最大4)。
// 正方形カードを cover で埋める元画像の切り出し矩形を返す。範囲外は画像内に収まるようクランプする。
export const CROP_MAX_ZOOM = 4;
export function photoSourceRect(imgW, imgH, { cx = 0.5, cy = 0.5, zoom = 1 } = {}) {
  const w = Math.max(1, imgW);
  const h = Math.max(1, imgH);
  const z = Math.min(CROP_MAX_ZOOM, Math.max(1, Number.isFinite(zoom) ? zoom : 1));
  const side = Math.min(w, h) / z;
  const x = Number.isFinite(cx) ? cx : 0.5;
  const y = Number.isFinite(cy) ? cy : 0.5;
  const sx = Math.min(Math.max(0, x * w - side / 2), w - side);
  const sy = Math.min(Math.max(0, y * h - side / 2), h - side);
  return { sx, sy, sw: side, sh: side };
}

// ドラッグ量(カード上のピクセル)を注視点の移動量へ。cardPx = 表示中のカードの一辺(px)
export function panCrop(crop, dxPx, dyPx, cardPx, imgW, imgH) {
  const { sw } = photoSourceRect(imgW, imgH, crop);
  const perPx = sw / Math.max(1, cardPx); // カード1pxあたりの元画像ピクセル
  return clampCrop({ ...crop, cx: crop.cx - (dxPx * perPx) / imgW, cy: crop.cy - (dyPx * perPx) / imgH }, imgW, imgH);
}

// 注視点を「切り出し矩形が画像内に収まる範囲」へ丸める(スライダー操作後の飛びを防ぐ)
export function clampCrop(crop, imgW, imgH) {
  const r = photoSourceRect(imgW, imgH, crop);
  return { cx: (r.sx + r.sw / 2) / Math.max(1, imgW), cy: (r.sy + r.sh / 2) / Math.max(1, imgH), zoom: Math.min(CROP_MAX_ZOOM, Math.max(1, crop.zoom ?? 1)) };
}

export function cardFileName(dateKey) {
  return `pontonikki-card-${(dateKey ?? '').replaceAll('-', '')}.png`;
}

// ---- タグのシール貼り(PD FB 2026-10-05 第2弾)----
// タグを「シール」として自由に貼る。位置はカード内の相対座標(0〜1・中心)、rotate は度、orient は 'h'(横)|'v'(縦)。
// 既定は自動配置(layoutCard の tagRows)をそのままシール化したもの=今のデザイン。

const STAMP_PAD = 20; // シールの内側余白(縦書き時の上下)
export const STICKER_ROTATE_STEP = 90; // 回転ボタン1回ぶん(度)。90°/180°/270° を既定にする(PD FB 3)
export const DEFAULT_CROP = Object.freeze({ cx: 0.5, cy: 0.5, zoom: 1 });

// シールの寸法(カード座標・px)。横は layoutTagRows と同じ計算、縦は文字を縦に積む
export function stampSize(text, orient = 'h', fontSize = TAG_FONT) {
  const chars = [...(text ?? '')];
  if (orient === 'v') {
    return { w: TAG_LINE_H - 20, h: Math.max(TAG_LINE_H - 20, chars.length * fontSize * 1.05 + STAMP_PAD * 2) };
  }
  return { w: Math.min(CARD_SIZE - PAD * 2, estimateTextWidth(text, fontSize) + TAG_PAD_X * 2), h: TAG_LINE_H - 20 };
}

// 自動配置(layoutCard の結果)→ シール配列。中心座標を 0〜1 に正規化
export function autoStickers(layout) {
  const out = [];
  for (const row of layout.tagRows ?? []) {
    for (const chip of row.chips) {
      out.push({ text: chip.text, x: (chip.x + chip.w / 2) / layout.size, y: (chip.y + chip.h / 2) / layout.size, rotate: chip.rotate ?? 0, orient: 'h' });
    }
  }
  return out;
}

// 中心が外へ出すぎないように丸める(少しはみ出すのは「貼った感」として許す)
export function clampSticker(sticker) {
  const lim = (v) => Math.min(0.97, Math.max(0.03, Number.isFinite(v) ? v : 0.5));
  const rot = Number.isFinite(sticker.rotate) ? ((sticker.rotate % 360) + 360) % 360 : 0;
  return { ...sticker, x: lim(sticker.x), y: lim(sticker.y), rotate: rot, orient: sticker.orient === 'v' ? 'v' : 'h' };
}

// シールの描画矩形(カード座標・px)
export function stickerRect(sticker, size = CARD_SIZE) {
  const { w, h } = stampSize(sticker.text, sticker.orient);
  return { cx: sticker.x * size, cy: sticker.y * size, w, h, rotate: sticker.rotate ?? 0 };
}

// 当たり判定: カード座標(px)の点が乗っている最前面(配列の最後)のシールの index。無ければ -1
export function hitSticker(stickers, px, py, size = CARD_SIZE) {
  for (let i = (stickers?.length ?? 0) - 1; i >= 0; i -= 1) {
    const r = stickerRect(stickers[i], size);
    const rad = (-(r.rotate) * Math.PI) / 180; // 逆回転して軸に揃える
    const dx = px - r.cx;
    const dy = py - r.cy;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (Math.abs(lx) <= r.w / 2 + 8 && Math.abs(ly) <= r.h / 2 + 8) return i;
  }
  return -1;
}

// シールを新しく貼るときの位置: 中央付近で、重ならないよう少しずつずらす
export function placeNewSticker(text, existing) {
  const n = existing?.length ?? 0;
  return clampSticker({ text, x: 0.5 + ((n % 3) - 1) * 0.08, y: 0.42 + (Math.floor(n / 3) % 3) * 0.08, rotate: STAMP_TILT[n % STAMP_TILT.length], orient: 'h' });
}

// ピンチ: 2本指の距離の比で拡大率を変える(注視点はそのまま。範囲外は clampCrop)
export function pinchZoom(crop, ratio, imgW, imgH) {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  return clampCrop({ ...crop, zoom: (crop.zoom ?? 1) * r }, imgW, imgH);
}
