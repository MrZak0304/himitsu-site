// 広告レイヤ。app.js からの接点は initAds() と requestRewarded() の2点だけに保つ。
// web / paid では全て no-op(有料版ビルドには広告SDK自体を含めない: 不変条件8)。
// 既定はテスト広告。本番ユニットIDは adMode='prod' のときのみ(不変条件9)。
// adMode='off'(v1.14・AdMob の一時停止の間の「期間限定で広告なし」)は SDK を一切呼ばない。
// リワードの代わりに UI が 1 日 1 回の「+1」を出す(js/core/ad-free-grants.js)。
// プラグイン取得は window.Capacitor.Plugins.AdMob の直参照(registerPlugin は注入ランタイムに無い: curly-train教訓)。
// isTesting に頼らず、テストモードでもプラットフォーム別の公式テストIDを adId として渡す(iOSでAndroid用IDが使われる罠)。

import { BUILD } from './build-flags.js';
import { tr } from './i18n/index.js';

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
  bannerLoaded: 'bannerAdLoaded',
  bannerFailedLoad: 'bannerAdFailedToLoad',
  rewardLoaded: 'onRewardedVideoAdLoaded',
  rewardFailedLoad: 'onRewardedVideoAdFailedToLoad',
  reward: 'onRewardedVideoAdReward',
  rewardDismissed: 'onRewardedVideoAdDismissed',
  rewardFailedShow: 'onRewardedVideoAdFailedToShow',
};

export const MESSAGES = {
  loadFailed: tr('広告を読み込めませんでした。通信状況をご確認ください。'),
  notCompleted: tr('最後まで視聴すると枠が増えます。'),
  showFailed: tr('広告を表示できませんでした。しばらくしてからお試しください。'),
  timeout: tr('広告の読み込みに時間がかかっています。しばらくしてからお試しください。'),
  prodUnitsMissing: tr('本番広告ユニットIDが未設定です。AdMob登録後に AD_UNITS を記入してください。'),
  privacyOptionsFailed: tr('広告のプライバシー設定を開けませんでした。しばらくしてからお試しください。'),
};

// --- バナーの読み込み直し(v1.08・2026-10-16 開発リード決定) ---
// 失敗したら 30秒 → 60 → 120 → 240 秒、以降は5分おきに読み込み直す(短い間隔で何度も要求しない)。
export const BANNER_RETRY_DELAYS_MS = Object.freeze([30000, 60000, 120000, 240000]);
export const BANNER_RETRY_MAX_MS = 300000;

export function bannerRetryDelay(attempt) {
  return BANNER_RETRY_DELAYS_MS[attempt] ?? BANNER_RETRY_MAX_MS;
}

// バナーの表示と読み込み直し(ピュアに近い形: SDK とタイマーを外から渡すので Node でテストできる)。
// show() は読み込みを始めるだけ。結果は loaded() / failed() で受け取る。
// 失敗したら余白を 0 に戻し(空の帯を残さない)、間隔を空けて remove() → show() する。
// バックグラウンド中は止め、アプリに戻ったときに出ていなければすぐ 1 回試す。
export function createBannerLoader({ show, remove, setInset, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let started = false;
  let loaded = false;
  let inFlight = false;
  let active = true;
  let attempt = 0;
  let timer = null;

  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const attemptShow = async (reload) => {
    if (inFlight || loaded || !active) return;
    inFlight = true;
    try {
      if (reload) await Promise.resolve(remove()).catch(() => {});
      await show();
    } catch {
      onFailed(); // 呼び出し自体の失敗も、読み込み失敗と同じ扱い
    }
  };
  const schedule = () => {
    if (!active || timer !== null) return;
    const delay = bannerRetryDelay(attempt);
    attempt += 1;
    timer = setTimer(() => {
      timer = null;
      attemptShow(true);
    }, delay);
  };
  function onFailed() {
    inFlight = false;
    loaded = false;
    setInset(0);
    schedule();
  }
  return {
    start() {
      if (started) return;
      started = true;
      attemptShow(false);
    },
    loaded() {
      inFlight = false;
      loaded = true;
      attempt = 0;
      cancelTimer();
    },
    failed() {
      // 表示中のバナーの自動更新の失敗は SDK に任せる(前の広告が出たままなので、余白を消さない)
      if (!started || loaded) return;
      onFailed();
    },
    setActive(isActive) {
      active = isActive;
      if (!isActive) {
        cancelTimer();
        return;
      }
      if (started && !loaded && !inFlight) {
        cancelTimer();
        attemptShow(true);
      }
    },
    state: () => ({ started, loaded, inFlight, active, attempt, retryPending: timer !== null }),
  };
}

// --- 広告の同意(UMP・v1.08。英国などの GDPR 対象の利用者だけに同意画面が出る) ---
// requestConsentInfo / showConsentForm の結果(status・isConsentFormAvailable・canRequestAds・
// privacyOptionsRequirementStatus)から次の動きを決める。
// - 'show-form': 同意が要り、フォームがある → 同意画面を出す
// - 'load-ads': 広告を読み込んでよい
// - 'no-ads': 広告を読み込まない(まだ選んでいない・同意画面を閉じきれなかったなど)
// 「同意しない」を選んだ人も canRequestAds は true になる(Google の仕様。個人に合わせない・制限つきの広告が出る)
// 情報が取れなかった(通信失敗など)ときは 'load-ads'。前回の同意は SDK が覚えているので、
// それに従って配信される(Google の案内どおり。日本などの利用者の広告が通信の揺らぎで止まらないように)。
export function consentAction(info, { formShown = false } = {}) {
  if (!info) return 'load-ads';
  if (!formShown && info.status === 'REQUIRED' && info.isConsentFormAvailable) return 'show-form';
  return info.canRequestAds ? 'load-ads' : 'no-ads';
}

// 設定の「広告のプライバシー設定」を出すか(GDPR: 同意をあとから変えられること)
export function shouldShowPrivacyOptions(info) {
  return info?.privacyOptionsRequirementStatus === 'REQUIRED';
}

// 同意の地域の見せかけ(確認用)。テスト広告のビルドだけで効かせ、本番広告では必ず無視する(不変条件9と同じ考え方)。
// debugGeography の値は AdmobConsentDebugGeography(EEA = 1)。
export function consentRequestOptions(adMode, consentDebug) {
  if (adMode === 'prod' || consentDebug?.geography !== 'eea') return {};
  return { debugGeography: 1, testDeviceIdentifiers: [...(consentDebug.testDevices ?? [])] };
}

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
let consentInfo = null; // 最後に受け取った同意の情報(設定の項目の出し分けに使う)
let adsAllowed = false; // 同意の結果、広告を読み込んでよいか
let bannerLoader = null; // createBannerLoader の戻り値

// リワードの事前ロード状態。UIは「広告が用意できたときだけ」ボタンを押せるようにする
// (App Review 2.1(a)「タップしたのに広告が出ない」対応。新規AdMobアプリはストア公開前に
// 配信が制限されることがあり、その間もタップ→エラーではなくボタン無効で吸収する)。
let rewardReady = false;
let rewardLoading = null; // Promise<boolean> | null

// 広告なしのお試し期間か(広告つき版で adMode='off')。UI はこれで「+1」ボタンに切り替える
export function isAdFree() {
  return BUILD.ads && BUILD.adMode === 'off';
}

export function isRewardedReady() {
  if (isAdFree()) return false; // SDK に触れない(+1 ボタンは UI 側で判定する)
  if (!nativePlatform()) return BUILD.ads; // Webはダミー視聴が常に可能
  return rewardReady;
}

// リワード広告を裏でロードする。成功で true。冪等(ロード済み/進行中なら使い回す)。
// initAds() は await されずに呼ばれるため、初期化完了を待ってから判定する
// (待たないと起動直後の refresh で「AdMob未初期化=無効」に倒れてしまう)。
export async function preloadRewarded({ timeoutMs = 25000 } = {}) {
  if (isAdFree()) return false;
  const platform = nativePlatform();
  if (!platform) return BUILD.ads;
  if (initPromise) await initPromise.catch(() => {});
  if (!AdMob || !units || !adsAllowed) return false;
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
// 初期化の完了(設定画面が initAds より先に作られても待てるように、呼ばれる前から用意しておく)
let resolveReady;
const readyPromise = new Promise((resolve) => {
  resolveReady = resolve;
});

export function initAds() {
  initPromise = doInitAds();
  initPromise.finally(resolveReady).catch(() => {});
  return initPromise;
}

async function doInitAds() {
  const banner = document.getElementById('ad-banner');
  if (!banner) return;
  if (!BUILD.ads || isAdFree()) {
    // 買い切り版・web、と広告なしのお試し期間(off: 初期化・バナー・同意画面のどれもしない)
    banner.hidden = true;
    setInset(0);
    return;
  }
  const platform = nativePlatform();
  if (!platform) {
    // Webプレビュー: プレースホルダ枠で --ad-inset の挙動を検証する
    banner.hidden = false;
    banner.textContent = BUILD.adMode === 'prod' ? tr('広告') : tr('広告(テスト)');
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
    // 上部バナー(TOP_CENTER)。ステータスバー/Dynamic Islandとの重なりは実機検証(U12)で確認。
    // 読み込みに失敗したら間隔を空けて読み込み直す(v1.08)
    bannerLoader = createBannerLoader({
      show: () => AdMob.showBanner({ adId: units.banner, adSize: 'ADAPTIVE_BANNER', position: 'TOP_CENTER', margin: 0 }),
      remove: () => AdMob.removeBanner?.(),
      setInset,
    });
    AdMob.addListener?.(EVENTS.bannerLoaded, () => bannerLoader.loaded());
    AdMob.addListener?.(EVENTS.bannerFailedLoad, () => bannerLoader.failed());
    window.Capacitor.Plugins?.App?.addListener?.('appStateChange', ({ isActive }) => bannerLoader.setActive(isActive));
    // 同意(UMP)を確かめてから広告を読み込む。対象外の地域の人には何も出ない
    adsAllowed = (await resolveConsent()) === 'load-ads';
    if (adsAllowed) bannerLoader.start();
  } catch (err) {
    // 失敗しても本体機能は止めない。ただし静かに死ぬため、実機での初回目視確認が必須(curly-train教訓)
    console.warn(tr('広告の初期化に失敗:'), err);
    AdMob = null;
  }
}

// 同意の情報を取り、必要なら同意画面を出す。'load-ads' | 'no-ads' を返す
async function resolveConsent() {
  consentInfo = null;
  let info = null;
  try {
    info = await AdMob.requestConsentInfo(consentRequestOptions(BUILD.adMode, BUILD.consentDebug));
  } catch (err) {
    console.warn(tr('広告の同意の確認に失敗:'), err);
    return consentAction(null);
  }
  consentInfo = info;
  if (consentAction(info) !== 'show-form') return consentAction(info);
  try {
    info = await AdMob.showConsentForm();
    consentInfo = info;
  } catch (err) {
    console.warn(tr('広告の同意画面を表示できませんでした:'), err);
  }
  return consentAction(consentInfo, { formShown: true });
}

// 広告の初期化(同意の確認を含む)が終わるのを待つ。設定の項目の出し分けに使う
export function whenAdsReady() {
  return readyPromise;
}

// 設定に「広告のプライバシー設定」を出すか(広告つき版・ネイティブで、同意の対象の地域の人だけ)
export function privacyOptionsAvailable() {
  return Boolean(AdMob) && shouldShowPrivacyOptions(consentInfo);
}

// 「広告のプライバシー設定」を開く。同意を変えたあとは、広告を読み込んでよいかを見直す
export async function openPrivacyOptions() {
  if (!AdMob) return { ok: false, reason: MESSAGES.privacyOptionsFailed };
  try {
    await AdMob.showPrivacyOptionsForm();
  } catch {
    return { ok: false, reason: MESSAGES.privacyOptionsFailed };
  }
  try {
    consentInfo = await AdMob.requestConsentInfo(consentRequestOptions(BUILD.adMode, BUILD.consentDebug));
    adsAllowed = consentAction(consentInfo, { formShown: true }) === 'load-ads';
    if (adsAllowed) bannerLoader?.start();
  } catch {
    // 見直しに失敗しても、いまの状態のまま続ける
  }
  return { ok: true };
}

// リワード視聴を要求する。増枠の確定は Rewarded イベント受信時のみ(Dismissed と混同しない: プランR9)。
// 事前ロード(preloadRewarded)済みの広告を表示する。未ロードならその場でロードを試みる(フォールバック)。
export async function requestRewarded() {
  if (isAdFree()) return { ok: false, reason: MESSAGES.loadFailed }; // off では呼ばれない想定(SDK に触れない)
  const platform = nativePlatform();
  if (!platform) {
    // Web: ダミー視聴(実SDKなし)
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true, dummy: true };
  }
  if (!AdMob || !units || !adsAllowed) return { ok: false, reason: MESSAGES.loadFailed };

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
  if (BUILD.variant === 'free' && isAdFree()) return tr('広告つき(期間限定で広告なし)');
  return { web: tr('Web版(プロトタイプ)'), free: tr('広告つき'), paid: tr('広告なし') }[BUILD.variant] ?? BUILD.variant;
}
