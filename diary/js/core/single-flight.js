// 進行中の呼び出しを 1 つに絞る(2026-11-21。教訓 2026-11-21-biometric-double-request)。
// 進行中にもう一度呼ばれたら、新しく始めずに同じ Promise を返す。終わったら(成功・失敗とも)次の呼び出しで新しく始める。
//
// ロックの解除(requestUnlock)で使う。ふりかえりの二度押しで生体認証が 2 つ重なると、
// Android のプラグインは進行中の呼び出しを 1 つしか持てず、1 つ目が成功も失敗も返さずに残り、
// 指紋が通っても「取り消し」として返ってパスコードの画面になっていた。
//
// UI 非依存のピュアなロジック。
export function singleFlight(fn) {
  let current = null;
  return (...args) => {
    if (current) return current;
    let p;
    try {
      p = Promise.resolve(fn(...args));
    } catch (err) {
      p = Promise.reject(err);
    }
    const tracked = p.finally(() => {
      if (current === tracked) current = null;
    });
    current = tracked;
    return tracked;
  };
}
