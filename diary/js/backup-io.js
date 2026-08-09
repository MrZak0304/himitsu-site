// バックアップ書き出し/取り込みの窓口モジュール(Worker接続)。
// 保存部(ダウンロード)は関数分離し、モバイル化時に共有シートへ差し替える。

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

// 差し替えポイント(フェーズ3): Capacitor では Filesystem+Share に置き換える
export function downloadBackup(json, filename) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
