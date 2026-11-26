// 「月の1枚」のレイアウト計算(ピュア・UI非依存)。
// ふりかえりの月カレンダー(一押し画像+タグ)を縦長の1枚にする。描画は month-card-render.js。
// 載せるのは 年月・曜日・日付のマス(サムネイルとタグ上位1〜2個)・よく使ったタグ・アプリ名だけ。
// 日記の本文・予定・日課は載せない(きょうの1枚カードと同じ考え方。不変条件1の趣旨)。

import { formatYearMonth, weekdayShort, locale, tr } from '../i18n/index.js';
import { estimateTextWidth, CARD_APP_NAME } from './card.js';

export const MONTH_CARD_W = 1080; // 4:5(Instagram のフィードと X の両方で切れにくい)
export const MONTH_CARD_H = 1350;
export const MONTH_CARD_TOP_TAGS = 3; // 「よく使ったタグ」に並べる数
export const MONTH_CARD_HASHTAG = '#ポンとにっき'; // 日本語の画面のときだけ隅に入れる(PD 確定 2026-11-26。海外向けは未定)

const PAD = 54;
const TITLE_FONT = 64;
const TITLE_Y = 128; // ベースライン
const DOW_FONT = 28;
const DOW_Y = 192;
const GRID_TOP = 216;
const GRID_BOTTOM = 1056; // 6 週の月でここまで使う
const GAP = 8;
const CELL_MAX_H = 170;
const DAY_FONT = 26;
const CELL_TAG_FONT = 20; // 定番タグ「#がんばった」がマスの幅に切れずに入る大きさ
const CELL_TAG_H = 28;
const CELL_TAG_GAP = 4;
const CELL_INSET = 6;
const RANK_LABEL_FONT = 28;
const RANK_FONT = 36;
const RANK_H = 68;
const RANK_PAD_X = 26;
const RANK_GAP = 16;
const BRAND_FONT = 34;

// 幅に収まるように文字を切り詰める(収まらなければ末尾を「…」に)
export function fitText(text, fontSize, maxWidth) {
  const s = String(text ?? '');
  if (estimateTextWidth(s, fontSize) <= maxWidth) return s;
  const chars = [...s];
  while (chars.length > 1 && estimateTextWidth(`${chars.join('')}…`, fontSize) > maxWidth) chars.pop();
  return `${chars.join('')}…`;
}

// その月に記録のある日が 1 日でもあるか(weeks は core/calendar.js の buildMonth の戻り値)
export function monthHasEntries(weeks) {
  return (weeks ?? []).some((week) => week.some((cell) => cell?.hasEntry));
}

// その月に一押し画像のある日が 1 日でもあるか(「写真をのせる」の切り替えを出すかどうか)
export function monthHasPhotos(weeks) {
  return (weeks ?? []).some((week) => week.some((cell) => cell?.imageId));
}

export function monthCardFileName(year, month) {
  return `pontonikki-month-${year}${String(month).padStart(2, '0')}.png`;
}

// input: { year, month, weeks(buildMonth), tagName: Map<id, 名前>, topTags: [名前](多い順), showPhotos, theme: { bg, accent, fg } }
// 戻り値は描画命令。座標は MONTH_CARD_W × MONTH_CARD_H の px
export function layoutMonthCard({ year, month, weeks = [], tagName = new Map(), topTags = [], showPhotos = true, theme = {} } = {}) {
  const w = MONTH_CARD_W;
  const h = MONTH_CARD_H;
  const accent = theme.accent ?? '#4a7dbd';
  const bg = theme.bg ?? '#f7f6f2';
  const fg = theme.fg ?? '#2b2925';
  const inner = w - PAD * 2;
  const cellW = (inner - GAP * 6) / 7;
  const rows = Math.max(1, weeks.length);
  const cellH = Math.min(CELL_MAX_H, (GRID_BOTTOM - GRID_TOP - GAP * (rows - 1)) / rows);

  const weekdays = [];
  for (let dow = 0; dow < 7; dow += 1) {
    weekdays.push({ text: weekdayShort(dow), x: PAD + dow * (cellW + GAP) + cellW / 2, y: DOW_Y, fontSize: DOW_FONT });
  }

  const cells = [];
  weeks.forEach((week, r) => {
    week.forEach((cell, c) => {
      if (!cell) return;
      const x = PAD + c * (cellW + GAP);
      const y = GRID_TOP + r * (cellH + GAP);
      const imageId = showPhotos ? cell.imageId ?? null : null;
      // タグはマスの下端から積む(カレンダーと同じ並び=付けた順で先頭 2 個まで)
      const names = (cell.tags ?? []).map((id) => tagName.get(id) ?? '').filter((t) => t !== '');
      const tags = names.map((name, i) => ({
        text: fitText(name, CELL_TAG_FONT, cellW - CELL_INSET * 2 - 4),
        x: x + CELL_INSET,
        y: y + cellH - CELL_INSET - (names.length - i) * CELL_TAG_H - (names.length - 1 - i) * CELL_TAG_GAP,
        w: cellW - CELL_INSET * 2,
        h: CELL_TAG_H,
        fontSize: CELL_TAG_FONT,
      }));
      cells.push({
        key: cell.key,
        x, y, w: cellW, h: cellH,
        hasEntry: !!cell.hasEntry,
        imageId,
        day: { text: String(cell.day), x: x + 10, y: y + 8 + DAY_FONT, fontSize: DAY_FONT },
        tags,
      });
    });
  });
  const gridBottom = GRID_TOP + rows * cellH + (rows - 1) * GAP;

  // よく使ったタグ(上位 3 つ)。幅に収まる分だけ並べる
  const brandY = h - PAD;
  const rankChipY = brandY - BRAND_FONT - 40 - RANK_H;
  const rankLabelY = rankChipY - 22;
  const chips = [];
  let cx = PAD;
  for (const name of (topTags ?? []).filter((t) => typeof t === 'string' && t.trim() !== '').slice(0, MONTH_CARD_TOP_TAGS)) {
    const text = fitText(name, RANK_FONT, 300);
    const cw = estimateTextWidth(text, RANK_FONT) + RANK_PAD_X * 2;
    if (chips.length > 0 && cx + cw > w - PAD) break;
    chips.push({ text, x: cx, y: rankChipY, w: Math.min(cw, inner), h: RANK_H, fontSize: RANK_FONT });
    cx += cw + RANK_GAP;
  }

  const hashtag = locale() === 'ja' ? { text: MONTH_CARD_HASHTAG, x: w - PAD, y: brandY, fontSize: BRAND_FONT } : null;

  return {
    w, h,
    background: { color: bg },
    title: { text: formatYearMonth(year, month), x: PAD, y: TITLE_Y, fontSize: TITLE_FONT },
    weekdays,
    cells,
    gridBottom,
    ranking: chips.length > 0 ? { label: { text: tr('よく使うタグ'), x: PAD, y: rankLabelY, fontSize: RANK_LABEL_FONT }, chips } : null,
    brand: { text: CARD_APP_NAME, x: PAD, y: brandY, fontSize: BRAND_FONT },
    hashtag,
    colors: {
      text: fg,
      dim: accent,
      accent,
      cellEmpty: 'rgba(128,128,128,0.10)', // 記録のない日
      cellFilled: accent, // 記録はあるが写真のない日(薄く敷く。濃さは描画側)
      cellFilledAlpha: 0.2,
      photoScrim: 'rgba(0,0,0,0.34)',
      photoText: '#ffffff',
      // タグの地はテーマの背景色にする(文字=アクセント色との組み合わせは、暗いテーマでも読める)
      tagBg: bg,
      tagBgAlpha: 0.92,
      tagText: accent,
      chipBg: bg,
    },
  };
}
