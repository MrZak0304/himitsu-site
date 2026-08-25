// 広告レイヤ(AdMob)。無料版(BUILD.ads=true)かつネイティブアプリ実行時のみ動作し、
// Web版・有料版ではすべて no-op になる。app.js からの接続は initAds() と
// maybeShowCompletionAd() の2点だけに保つこと。
//
// 【広告IDについて】この動画アプリ用の AdMob アプリ/ユニットIDは未登録(PDタスク)。
// AdMobアカウントは暗号・占いと共通(publisher pub-2706003706222990)だが、
// アプリごとに新しいアプリIDとユニットIDを登録する必要がある。登録後に AD_UNITS を
// 実IDへ差し替える。既定(adMode=test)では常にGoogle公式テストIDを使うため、
// 本番IDが未設定でもテスト広告は表示できる。
// ⚠ 本番IDの広告を開発者自身の端末で表示・タップすると無効トラフィック扱い(停止リスク)。
//    動作確認は必ずテストモードで。アプリID(Manifest/Info.plist側)は常に本番でよい。

import { BUILD } from './build-flags.js';

// TODO(PD登録後に差し替え): 動画アプリ用の本番ユニットID
const AD_UNITS = {
  android: { banner: '', interstitial: '', rewarded: '' },
  ios: { banner: '', interstitial: '', rewarded: '' },
};

// Google公式テスト用ユニットID(プラットフォーム別)。
// isTesting:true は内蔵テストIDに差し替えるが iOS で Android 用IDが使われ
// 「Invalid request」になる既知問題(curly-train 2026-08-02)があるため、
// テストモードでも明示的にプラットフォーム別テストIDを adId で渡す。
const TEST_UNITS = {
  android: {
    banner: 'ca-app-pub-3940256099942544/6300978111',
    interstitial: 'ca-app-pub-3940256099942544/1033173712',
    rewarded: 'ca-app-pub-3940256099942544/5224354917',
  },
  ios: {
    banner: 'ca-app-pub-3940256099942544/2934735716',
    interstitial: 'ca-app-pub-3940256099942544/4411468910',
    rewarded: 'ca-app-pub-3940256099942544/1712485313',
  },
};

const AD_TESTING = BUILD.adMode !== 'prod';

let AdMob = null;
let units = null;

function nativePlatform() {
  const p = window.Capacitor?.getPlatform?.();
  return p === 'android' || p === 'ios' ? p : null;
}

export async function initAds() {
  const platform = nativePlatform();
  if (!BUILD.ads || !platform) return; // Web版・有料版・ブラウザでは何もしない
  try {
    AdMob = window.Capacitor.Plugins?.AdMob ?? window.Capacitor.registerPlugin('AdMob');
    units = AD_TESTING ? TEST_UNITS[platform] : AD_UNITS[platform];
    await AdMob.initialize({ initializeForTesting: AD_TESTING });
    // バナー高さぶんプレビュー等を持ち上げる(CSS変数 --ad-inset)
    AdMob.addListener?.('bannerAdSizeChanged', (size) => {
      document.documentElement.style.setProperty('--ad-inset', `${size?.height ?? 0}px`);
    });
    await AdMob.showBanner({
      adId: units.banner,
      adSize: 'ADAPTIVE_BANNER',
      position: 'BOTTOM_CENTER',
      margin: 0,
    });
  } catch (e) {
    console.warn('広告の初期化に失敗しました:', e); // 広告が出せなくても本体は止めない
    AdMob = null;
  }
}

// 書き出し完了時に呼ぶ。無料版のみ、完成時にリワード広告を出す(SPEC §1: 作成完了時リワード)。
// リワード視聴の成否は本体機能に影響させない(完成物は必ず得られる)。
export async function maybeShowCompletionAd() {
  if (!AdMob) return;
  try {
    await AdMob.prepareRewardVideoAd({ adId: units.rewarded });
    await AdMob.showRewardVideoAd();
  } catch { /* 表示失敗は無視 */ }
}
