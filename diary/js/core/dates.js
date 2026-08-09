// 日付キー(ローカルタイム YYYY-MM-DD)のピュア関数集。
// 「今日」は必ず引数で受け取り、UI側が new Date() を渡す(テスト容易性のため)。

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function toKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayKey(now = new Date()) {
  return toKey(now);
}

export function isValidKey(key) {
  if (typeof key !== 'string') return false;
  const m = KEY_RE.exec(key);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

export function addDays(key, n) {
  const m = KEY_RE.exec(key);
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n);
  return toKey(date);
}

export function prevDayKey(key) {
  return addDays(key, -1);
}

export function monthOfKey(key) {
  const m = KEY_RE.exec(key);
  return { year: Number(m[1]), month: Number(m[2]) };
}

export function compareKeys(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
