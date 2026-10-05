// 広告レイヤ。app.js からの接点は initAds() と requestRewarded() の2点だけに保つ。
// web / paid では全て no-op(有料版ビルドには広告SDK自体を含めない: 不変条件8)。
// 既定はテスト広告。本番ユニットIDは adMode='prod' のときのみ(不変条件9)。
// プラグイン取得は window.Capacitor.Plugins.AdMob の直参照(registerPlugin は注入ランタイムに無い: curly-train教訓)。
// isTesting に頼らず、テストモードでもプラットフォーム別の公式テストIDを adId として渡す(iOSでAndroid用IDが使われる罠)。

import { BUILD } from './build-flags.js';

const BANNER_PLACEHOLDER_HEIGHT = 52; // Webプレビュー用プレースホルダのみ。ネイティブは実高さを使う

// 本番ユニットID(2026-08-10 AdMob登録・受領)。
// アプリID: iOS ca-app-pub-2706003706222990~4873371507 / Android ca-app-pub-2706003706222990~9244841297
// ⚠ 姉妹アプリのIDと混ぜない(暗号 ~3973373320 / ~4702767530・占い ~4320185236)
export const AD_UNITS = {
  android: {
    banner: 'ca-app-pub-2706003706222990/1881356596',
    rewarded: 'ca-app-pub-2706003706222990/5629029914',
  },
  ios: {
    banner: 'ca-app-pub-2706003706222990/4462307963',
    rewarded: 'ca-app-pub-2706003706222990/6924819774',
  },
};

// Google公式テストID(不変)。バナーはADAPTIVE_BANNERで要求するため
// 「アダプティブバナー」用デモユニットを使う(固定サイズバナー用IDだと Invalid request になる)
export const TEST_UNITS = {
  android: { banner: 'ca-app-pub-3940256099942544/9214589741', rewarded: 'ca-app-pub-3940256099942544/5224354917' },
  ios: { banner: 'ca-app-pub-3940256099942544/2435281174', rewarded: 'ca-app-pub-3940256099942544/1712485313' },
};

// イベント名は enum のメンバー名ではなく実ワイヤ文字列を使う(バンドラなし構成のため)。
// シミュレータ疎通スパイク(フェーズC冒頭)で最終確認する。
const EVENTS = {
  bannerSize: 'bannerAdSizeChanged',
  rewardLoaded: 'onRewardedVideoAdLoaded',
  rewardFailedLoad: 'onRewardedVideoAdFailedToLoad',
  reward: 'onRewardedVideoAdReward',
  rewardDismissed: 'onRewardedVideoAdDismissed',
  rewardFailedShow: 'onRewardedVideoAdFailedToShow',
};

export const MESSAGES = {
  loadFailed: '広告を読み込めませんでした。通信状況をご確認ください。',
  notCompleted: '最後まで視聴すると枠が増えます。',
  showFailed: '広告を表示できませんでした。しばらくしてからお試しください。',
  timeout: '広告の読み込みに時間がかかっています。しばらくしてからお試しください。',
  prodUnitsMissing: '本番広告ユニットIDが未設定です。AdMob登録後に AD_UNITS を記入してください。',
};

// ユニット選択(ピュア・テスト対象)。prod でIDが未記入なら fail-fast(不変条件9)
export function selectUnits(adMode, platform, prodUnits = AD_UNITS) {
  if (adMode === 'prod') {
    const units = prodUnits[platform];
    if (!units?.banner || !units?.rewarded) throw new Error(MESSAGES.prodUnitsMissing);
    return units;
  }
  return TEST_UNITS[platform];
}

function nativePlatform() {
  const p = window.Capacitor?.getPlatform?.();
  return p === 'android' || p === 'ios' ? p : null;
}

function setInset(px) {
  document.documentElement.style.setProperty('--ad-inset', `${px}px`);
}

let AdMob = null;
let units = null;

// リワードの事前ロード状態。UIは「広告が用意できたときだけ」ボタンを押せるようにする
// (App Review 2.1(a)「タップしたのに広告が出ない」対応。新規AdMobアプリはストア公開前に
// 配信が制限されることがあり、その間もタップ→エラーではなくボタン無効で吸収する)。
let rewardReady = false;
let rewardLoading = null; // Promise<boolean> | null

export function isRewardedReady() {
  if (!nativePlatform()) return BUILD.ads; // Webはダミー視聴が常に可能
  return rewardReady;
}

// リワード広告を裏でロードする。成功で true。冪等(ロード済み/進行中なら使い回す)。
// initAds() は await されずに呼ばれるため、初期化完了を待ってから判定する
// (待たないと起動直後の refresh で「AdMob未初期化=無効」に倒れてしまう)。
export async function preloadRewarded({ timeoutMs = 25000 } = {}) {
  const platform = nativePlatform();
  if (!platform) return BUILD.ads;
  if (initPromise) await initPromise.catch(() => {});
  if (!AdMob || !units) return false;
  if (rewardReady) return true;
  if (rewardLoading) return rewardLoading;
  rewardLoading = new Promise((resolve) => {
    let done = false;
    const handles = [];
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const h of handles) Promise.resolve(h).then((x) => x?.remove?.()).catch(() => {});
      rewardReady = ok;
      rewardLoading = null;
      resolve(ok);
    };
    const listen = (name, fn) => handles.push(AdMob.addListener?.(name, fn));
    listen(EVENTS.rewardLoaded, () => finish(true));
    listen(EVENTS.rewardFailedLoad, () => finish(false));
    Promise.resolve(AdMob.prepareRewardVideoAd({ adId: units.rewarded })).catch(() => finish(false));
    const timer = setTimeout(() => finish(false), timeoutMs);
  });
  return rewardLoading;
}

let initPromise = null;

export function initAds() {
  initPromise = doInitAds();
  return initPromise;
}

async function doInitAds() {
  const banner = document.getElementById('ad-banner');
  if (!banner) return;
  if (!BUILD.ads) {
    banner.hidden = true;
    setInset(0);
    return;
  }
  const platform = nativePlatform();
  if (!platform) {
    // Webプレビュー: プレースホルダ枠で --ad-inset の挙動を検証する
    banner.hidden = false;
    banner.textContent = BUILD.adMode === 'prod' ? '広告' : '広告(テスト)';
    setInset(BANNER_PLACEHOLDER_HEIGHT);
    return;
  }
  banner.hidden = true; // ネイティブはSDKのバナービューを使う
  try {
    AdMob = window.Capacitor.Plugins?.AdMob ?? null;
    if (!AdMob) throw new Error('AdMob plugin not found');
    units = selectUnits(BUILD.adMode, platform);
    await AdMob.initialize({ initializeForTesting: BUILD.adMode !== 'prod' });
    AdMob.addListener?.(EVENTS.bannerSize, (size) => setInset(size?.height ?? 0));
    // 上部バナー(TOP_CENTER)。ステータスバー/Dynamic Islandとの重なりは実機検証(U12)で確認
    await AdMob.showBanner({ adId: units.banner, adSize: 'ADAPTIVE_BANNER', position: 'TOP_CENTER', margin: 0 });
  } catch (err) {
    // 失敗しても本体機能は止めない。ただし静かに死ぬため、実機での初回目視確認が必須(curly-train教訓)
    console.warn('広告の初期化に失敗:', err);
    AdMob = null;
  }
}

// リワード視聴を要求する。増枠の確定は Rewarded イベント受信時のみ(Dismissed と混同しない: プランR9)。
// 事前ロード(preloadRewarded)済みの広告を表示する。未ロードならその場でロードを試みる(フォールバック)。
export async function requestRewarded() {
  const platform = nativePlatform();
  if (!platform) {
    // Web: ダミー視聴(実SDKなし)
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true, dummy: true };
  }
  if (!AdMob || !units) return { ok: false, reason: MESSAGES.loadFailed };

  if (!rewardReady) {
    const loaded = await preloadRewarded();
    if (!loaded) return { ok: false, reason: MESSAGES.loadFailed };
  }
  rewardReady = false; // 表示ごとに使い切り(次回分は preloadRewarded で再ロード)

  return new Promise((resolve) => {
    let rewarded = false;
    let done = false;
    const handles = [];
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const h of handles) Promise.resolve(h).then((x) => x?.remove?.()).catch(() => {});
      resolve(result);
    };
    const listen = (name, fn) => handles.push(AdMob.addListener?.(name, fn));

    listen(EVENTS.reward, () => {
      rewarded = true;
    });
    listen(EVENTS.rewardDismissed, () => {
      finish(rewarded ? { ok: true } : { ok: false, reason: MESSAGES.notCompleted });
    });
    listen(EVENTS.rewardFailedShow, () => finish({ ok: false, reason: MESSAGES.showFailed }));

    Promise.resolve(AdMob.showRewardVideoAd()).catch(() => finish({ ok: false, reason: MESSAGES.showFailed }));
    // 保険のタイムアウト。動画+エンドカードの視聴時間より十分長く取る
    // (旧30秒は実広告の動画途中に発火しうる)。通常は dismissed/failedShow が先に来る。
    const timer = setTimeout(() => finish(rewarded ? { ok: true } : { ok: false, reason: MESSAGES.timeout }), 120000);
  });
}

export function buildLabel() {
  // 版名はストア名称と統一(「無料版」の語は使わない: App Store 2.3.7 対応の運用ルール)
  return { web: 'Web版(プロトタイプ)', free: '広告つき', paid: '広告なし' }[BUILD.variant] ?? BUILD.variant;
}
