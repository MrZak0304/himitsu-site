// web / free / paid の切り替え。ここにあるのは Web 版の既定値。
// モバイルビルド時は scripts/build-dist.mjs が dist/ 側を生成し直す(フェーズ3で整備)。
export const BUILD = {
  variant: 'web', // 'web' | 'free' | 'paid'
  ads: false,
  adMode: 'test', // 'test' | 'prod'。'prod' は本番広告(明示指定したビルドのみ)
};

// 「どのビルドか」を表す不変値。BUILD.variant は ?variant= の開発フックで書き換わるため、
// 配布物か否かの判定にはこちらを使う(デモで free を試遊中でも 'web' のまま)。
// dist 側は scripts/build-dist.mjs が 'free' | 'paid' を直書きする。
export const BASE_VARIANT = BUILD.variant;

// 開発用フック: web変体かつ開発環境・PD確認デモでのみ、?variant=free|paid と ?reset=1 を適用する。
// 本番相当のデプロイ先では無効(URL操作での課金バイパス・誤リセットを防ぐ)。
// mrzak0304.github.io はPD確認用デモ(himitsu-site)。課金・広告が実在しないプロトタイプ配信のみに使う。
export function applyDevOverrides(location) {
  if (BUILD.variant !== 'web') return { reset: false };
  const host = location.hostname;
  const isDevHost =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '' || host === 'mrzak0304.github.io';
  if (!isDevHost) return { reset: false };
  const params = new URLSearchParams(location.search);
  const v = params.get('variant');
  if (v === 'free' || v === 'paid') {
    BUILD.variant = v;
    BUILD.ads = v === 'free';
  }
  return { reset: params.get('reset') === '1' };
}
