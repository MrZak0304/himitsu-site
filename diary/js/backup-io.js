// バックアップ書き出し/取り込みの窓口モジュール(Worker接続+保存部の3分岐)。
// ネイティブでは Filesystem(CACHE)+Share の共有シート経路(Android WebView は <a download> 不可)。
// 全量一括のbase64/文字列連結をブリッジに渡さないよう、書き出しはチャンク分割で行う(プランU6)。

export function createBackupIO() {
  function run(message) {
    return new Promise((resolve, reject) => {
      // 生成/展開のたびに使い捨てWorker(処理終了で確実に解放)
      const w = new Worker(new URL('./workers/backup-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        w.terminate();
        if (e.data.ok) resolve(e.data);
        else reject(new Error(e.data.message));
      };
      w.onerror = () => {
        w.terminate();
        reject(new Error('バックアップ処理を開始できませんでした。'));
      };
      w.postMessage(message);
    });
  }

  return {
    // collections: {entries,tags,habits,habitLogs,settings}, imageRecords: 画像ストアの全レコード
    async exportBackup(collections, imageRecords) {
      const { json } = await run({ op: 'build', data: { collections, imageRecords } });
      return json;
    },
    async importBackup(text) {
      const { parsed, imageRecords } = await run({ op: 'parse', text });
      return { parsed, imageRecords };
    },
  };
}

// 書き出しの拡張子は `.json`。中身は元からJSONで、`.diarybak` のような独自拡張子は
// iOS が型を判定できず、ファイル選択画面で**保存したバックアップがグレーアウトして選べない**
// (2026-08-10 PD実機報告の真因)。`public.json` は各OS・クラウドが認識できる。
export const BACKUP_EXT = '.json';
// ファイル名だけ見て「ポンとにっきのバックアップ」と分かるようにする(2026-08-11 PD FB)。
// 半角英数にしているのは、共有先(メール・クラウド・PC)で文字化けや弾かれを避けるため
export const BACKUP_PREFIX = 'pontonikki-backup-';
const LEGACY_PREFIXES = ['diary-']; // 旧ビルドで書き出したファイルの後始末用
const LEGACY_BACKUP_EXT = '.diarybak';

// CACHEの掃除対象か(自分が書き出したバックアップだけを消す。無関係なjsonを巻き込まない)
export function isBackupCacheFile(name) {
  if (typeof name !== 'string') return false;
  const known = [BACKUP_PREFIX, ...LEGACY_PREFIXES].some((p) => name.startsWith(p));
  if (!known) return false;
  return name.endsWith(BACKUP_EXT) || name.endsWith(LEGACY_BACKUP_EXT);
}
export const CHUNK_SIZE = 4 * 1024 * 1024; // 1チャンク数MB以下(プランU6)

export function chunkString(s, size = CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

function nativeFs() {
  if (!globalThis.window?.Capacitor?.isNativePlatform?.()) return null;
  return window.Capacitor.Plugins ?? null;
}

export const SHARE_TITLE = 'ポンとにっきのバックアップ';

// 書き出しの保存部。Web=<a download> / ネイティブ=CACHEへチャンク書き込み→共有シート→後始末。
// 戻り値 {saved}: 共有シートをキャンセルしたら false(「書き出しました」と誤って伝えないため)
export async function deliverBackup(json, filename) {
  const plugins = nativeFs();
  if (plugins?.Filesystem && plugins?.Share) {
    const { Filesystem, Share } = plugins;
    const chunks = chunkString(json);
    await Filesystem.writeFile({ path: filename, directory: 'CACHE', data: chunks[0] ?? '', encoding: 'utf8', recursive: true });
    for (const chunk of chunks.slice(1)) {
      await Filesystem.appendFile({ path: filename, directory: 'CACHE', data: chunk, encoding: 'utf8' });
    }
    let saved = false;
    try {
      const { uri } = await Filesystem.getUri({ path: filename, directory: 'CACHE' });
      // iOSの共有シートはキャンセルすると reject する。保存できたときだけ成功として扱う
      await Share.share({ title: SHARE_TITLE, text: SHARE_TITLE, files: [uri] });
      saved = true;
    } catch {
      saved = false; // キャンセル(エラー扱いはしないが「保存した」とも言わない)
    } finally {
      // ロックの外側に平文コピーを残さない(プランU6)
      await Filesystem.deleteFile({ path: filename, directory: 'CACHE' }).catch(() => {});
    }
    return { saved };
  }
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { saved: true };
}

// 起動時の後始末: 共有後に残ったバックアップの平文コピーをCACHEから削除する
export async function cleanupBackupCache() {
  const plugins = nativeFs();
  if (!plugins?.Filesystem) return;
  try {
    const { files } = await plugins.Filesystem.readdir({ path: '', directory: 'CACHE' });
    for (const f of files ?? []) {
      const name = typeof f === 'string' ? f : f.name;
      if (isBackupCacheFile(name)) {
        await plugins.Filesystem.deleteFile({ path: name, directory: 'CACHE' }).catch(() => {});
      }
    }
  } catch {
    /* CACHEが読めない環境では何もしない */
  }
}
