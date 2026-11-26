// ストアの評価(@capawesome/capacitor-app-review)の窓口。ネイティブのみ実動作、Web(デモ)では何もしない。
// 自作の「気に入りましたか?」などの質問は出さない(Apple 5.6.1・Google のアプリ内レビューの規約)。
// 評価と引き換えの特典も出さない。

import { BUILD } from './build-flags.js';
import { tr } from './i18n/index.js';

// App Store の Apple ID(公開ストアの URL の id)。iOS の openAppStore に必要。Android はパッケージ名から開く
const APPLE_IDS = { free: '6799875058', paid: '6799877267' };

function plugin() {
  if (!window.Capacitor?.isNativePlatform?.()) return null;
  return window.Capacitor.Plugins?.AppReview ?? null;
}

export function reviewAvailable() {
  return plugin() !== null;
}

// OS の評価ダイアログを頼む(表示するかは OS が決める)。失敗しても利用者には何も出さない
export async function requestReview() {
  const p = plugin();
  if (!p) return;
  try {
    await p.requestReview();
  } catch {
    // 表示回数の制限・Play 以外から入れたアプリなど。黙って諦める
  }
}

// 設定の「アプリを評価する」: ストアのレビュー画面を開く。戻り値 {ok, reason?}
export async function openStoreReview() {
  const p = plugin();
  if (!p) return { ok: true };
  try {
    const ios = window.Capacitor.getPlatform?.() === 'ios';
    await p.openAppStore(ios ? { appId: APPLE_IDS[BUILD.variant] ?? APPLE_IDS.free } : undefined);
    return { ok: true };
  } catch {
    return { ok: false, reason: tr('ストアを開けませんでした。しばらくしてからお試しください。') };
  }
}
