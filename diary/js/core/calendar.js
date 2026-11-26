// 月カレンダーの組み立て(ピュア)。週は日曜はじまり。
// 各日のマス: その日のタグ上位1〜2個(付けた順)+一押し画像。

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 記録として「中身がある」か(連続日数・カレンダー表示の判定に使う)
export function hasEntryContent(entry) {
  if (!entry) return false;
  return (entry.tags?.length ?? 0) > 0 || (entry.text ?? '') !== '' || (entry.images?.length ?? 0) > 0;
}

// その日に表示するタグ(付けた順で先頭2個まで)
export function displayTags(entry) {
  return (entry?.tags ?? []).slice(0, 2);
}

// 一押し画像のID。未選択なら最初の1枚。画像がなければ null。
export function pushImageId(entry) {
  const imgs = entry?.images ?? [];
  if (imgs.length === 0) return null;
  const i = entry.pushImageIndex;
  const valid = Number.isInteger(i) && i >= 0 && i < imgs.length;
  return imgs[valid ? i : 0];
}

export function prevMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function nextMonth(year, month) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

// カレンダーのスワイプ(2026-10-26 PD 要望「動かした感のある途中の動作」)。
// 指に合わせてカレンダーを横に流し、離したときに隣の月へ送るか元に戻すかを決める。

// なぞり始めの向き。dx,dy: 指を置いてからの移動量(px)。
// 戻り値: 'x'=横(月を流す) / 'y'=縦(ブラウザのスクロールに任せる) / null=まだ決めない(動きが小さい)
export const SWIPE_LOCK_PX = 8;
export function swipeAxis(dx, dy) {
  if (Math.abs(dx) < SWIPE_LOCK_PX && Math.abs(dy) < SWIPE_LOCK_PX) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

// 指を離したときの行き先。dx: 横の移動量(px)、width: カレンダーの幅(px)、velocity: 離す直前の速さ(px/ms)。
// 戻り値: -1=前の月(右へなぞった) / 1=次の月(左へなぞった) / 0=元の月に戻す。
// 幅の 4 割以上動かすか、同じ向きにすばやく払った(0.5px/ms 以上・50px 以上)ときだけ月を送る。
export const SWIPE_MIN_PX = 50;
export const SWIPE_FLICK_SPEED = 0.5;
export function swipeSettle(dx, width, velocity = 0) {
  if (!(width > 0) || dx === 0) return 0;
  const far = Math.abs(dx) >= width * 0.4;
  const flick = Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(velocity) >= SWIPE_FLICK_SPEED && Math.sign(velocity) === Math.sign(dx);
  if (!far && !flick) return 0;
  return dx > 0 ? -1 : 1;
}

// month: 1〜12。entriesByDate: {キー→entry}。today: 今日のキー(null可)。
// 戻り値: 週(7要素)の配列。月外は null。
export function buildMonth(year, month, entriesByDate = {}, today = null) {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = `${year}-${pad2(month)}-${pad2(d)}`;
    const entry = entriesByDate[key] ?? null;
    cells.push({
      key,
      day: d,
      isToday: key === today,
      hasEntry: hasEntryContent(entry),
      tags: displayTags(entry),
      imageId: pushImageId(entry),
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
