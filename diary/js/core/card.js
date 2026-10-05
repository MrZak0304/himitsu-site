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
  const tagRows = rows.map((row, i) => {
    const y = tagsBottom - (rows.length - 1 - i) * TAG_LINE_H; // 行の下端
    let x = PAD;
    const chips = row.chips.map((c) => {
      const chip = { text: c.text, x, y: y - TAG_LINE_H + 12, w: c.width, h: TAG_LINE_H - 20, fontSize: TAG_FONT };
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
      chipBg: hasPhoto ? 'rgba(255,255,255,0.92)' : '#ffffff',
      chipText: accent,
      text: hasPhoto ? '#ffffff' : fg,
      brand: hasPhoto ? 'rgba(255,255,255,0.85)' : accent,
      scrim: hasPhoto ? '#000000' : accent,
    },
  };
}

export function cardFileName(dateKey) {
  return `pontonikki-card-${(dateKey ?? '').replaceAll('-', '')}.png`;
}
