// 「きょうの1枚カード」の作成→共有の窓口(v1.1 U3)。きょう画面とふりかえりの日別詳細から呼ぶ。
// 本文は載せない。写真は一押し(未選択なら最初の1枚)。共有はユーザー操作でのみ外へ出る(不変条件1)。

import { normalizePushIndex } from './core/image-rules.js';
import { cardFileName } from './core/card.js';
import { renderCard, currentThemeColors } from './card-render.js';
import { deliverFile } from './backup-io.js';

export const CARD_EMPTY_MESSAGE = 'タグか写真を記録すると、カードにできます。';

// その日のカードを作れるか(タグか写真があるとき)
export function canMakeCard(entry) {
  return (entry?.tags?.length ?? 0) > 0 || (entry?.images?.length ?? 0) > 0;
}

// 戻り値 {saved, reason?}
export async function shareCardForDate(ctx, dateKey) {
  const entry = await ctx.stores.entries.get(dateKey);
  if (!canMakeCard(entry)) return { saved: false, reason: CARD_EMPTY_MESSAGE };
  const tags = await ctx.stores.tags.list({ includeHidden: true });
  const nameOf = new Map(tags.map((t) => [t.id, t.name]));
  const tagNames = (entry.tags ?? []).map((id) => nameOf.get(id)).filter(Boolean);
  let photoBlob = null;
  const images = entry.images ?? [];
  if (images.length > 0) {
    const idx = normalizePushIndex(images, entry.pushImageIndex ?? null);
    const rec = await ctx.pipeline.store.get(images[idx]);
    photoBlob = rec?.blob ?? null; // 原寸ではなく保存時にリサイズ済みの本体(不変条件5)
  }
  ctx.showLoading('カードを作っています…');
  try {
    const png = await renderCard({ dateKey, tagNames, photoBlob, theme: currentThemeColors() });
    return await deliverFile(png, cardFileName(dateKey));
  } catch (err) {
    return { saved: false, reason: err?.message ?? 'カードを作れませんでした。' };
  } finally {
    ctx.hideLoading();
  }
}
