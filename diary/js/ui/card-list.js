// 日記内に保存したカードの一覧(v1.05)。きょう画面と日別詳細で共用する画面部品。
// タップで再編集(カード編集画面を開く)、×の2段階タップで削除(写真の削除と同じ作法)。
import { UI_ICONS } from '../icons.js';

export function createCardList(ctx) {
  const urlsByEl = new WeakMap();

  // container に entry.cards を描く。空なら hidden。onChange は削除後の再描画用
  async function render(container, dateKey, entry, { onChange } = {}) {
    for (const u of urlsByEl.get(container) ?? []) URL.revokeObjectURL(u);
    const urls = [];
    urlsByEl.set(container, urls);
    const cards = entry?.cards ?? [];
    container.hidden = cards.length === 0;
    if (cards.length === 0) {
      container.replaceChildren();
      return;
    }
    const cells = await Promise.all(
      cards.map(async (card) => {
        const rec = await ctx.pipeline.store.get(card.imageId);
        const cell = document.createElement('div');
        cell.className = 'image-cell card-cell';
        cell.dataset.cardId = card.id;
        if (rec?.thumbBlob ?? rec?.blob) {
          const url = URL.createObjectURL(rec.thumbBlob ?? rec.blob);
          urls.push(url);
          const img = document.createElement('img');
          img.src = url;
          img.alt = 'この日の1枚カード';
          img.title = 'タップで作り直す';
          img.onclick = () => ctx.cardDialog?.open(dateKey, { cardId: card.id });
          cell.append(img);
        }
        const badge = document.createElement('span');
        badge.className = 'card-badge';
        badge.textContent = 'カード';
        cell.append(badge);
        const del = document.createElement('button');
        del.className = 'del-btn';
        del.title = '削除';
        del.innerHTML = UI_ICONS.close;
        let confirming = false;
        let timer = null;
        const resetDel = () => {
          confirming = false;
          clearTimeout(timer);
          del.classList.remove('confirm');
          del.title = '削除';
          del.innerHTML = UI_ICONS.close;
        };
        del.onclick = async (e) => {
          e.stopPropagation();
          if (!confirming) {
            confirming = true;
            del.classList.add('confirm');
            del.title = 'もう一度タップで削除';
            del.textContent = '削除';
            timer = setTimeout(resetDel, 3000);
            return;
          }
          resetDel();
          const removed = await ctx.stores.entries.removeCard(dateKey, card.id);
          if (removed) await ctx.pipeline.store.remove(removed.imageId).catch(() => {});
          ctx.notifySaved?.();
          onChange?.();
        };
        cell.append(del);
        return cell;
      }),
    );
    container.replaceChildren(...cells);
  }

  return { render };
}
