// 広告レイヤ。app.js からの接点は initAds() と requestRewarded() の2点だけに保つ。
// web / paid では全て no-op(有料版ビルドには広告SDK自体を含めない: 不変条件8)。
// 既定はテスト広告。本番ユニットIDは adMode='prod' のときのみ(不変条件9)。
// Webプロトタイプのリワードは必ず「ダミー視聴→成功」を返し、free実機ビルド時に
// AdMob呼び出しへ差し替える(差し替えポイント: requestRewarded 内)。

import { BUILD } from './build-flags.js';

const BANNER_HEIGHT = 52;

export function initAds() {
  const banner = document.getElementById('ad-banner');
  if (!banner) return;
  if (!BUILD.ads) {
    banner.hidden = true;
    document.documentElement.style.setProperty('--ad-inset', '0px');
    return;
  }
  // Webプロトタイプではプレースホルダ枠で --ad-inset の挙動を検証する
  banner.hidden = false;
  banner.textContent = BUILD.adMode === 'prod' ? '広告' : '広告(テスト)';
  document.documentElement.style.setProperty('--ad-inset', `${BANNER_HEIGHT}px`);
}

// リワード視聴を要求する。成功したら {ok:true}。
export async function requestRewarded() {
  if (!globalThis.window?.Capacitor) {
    // Web: ダミー視聴(実SDKなし)。視聴演出はUI側のオーバーレイで行う。
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true, dummy: true };
  }
  // 差し替えポイント(フェーズ3): AdMob のリワード広告をここで表示する
  return { ok: false, reason: '広告を読み込めませんでした。通信状況をご確認ください。' };
}

export function buildLabel() {
  return { web: 'Web版(プロトタイプ)', free: '無料版', paid: '有料版(広告なし)' }[BUILD.variant] ?? BUILD.variant;
}
