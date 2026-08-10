// マイグレーションのピュアロジック(Nodeテスト可能)。実I/Oは js/store/native-adapter.js 側。

// WebViewストレージから読んだ生JSON文字列の束から、参照されている画像IDを集める。
// 対象: 記録の添付画像 / 日課アイコン(type:image) / ユーザー保存キャラ(本体+表情差分) / 選択中カスタムキャラ
export function collectReferencedImageIds(collected) {
  const ids = new Set();
  const parse = (key) => {
    try {
      return JSON.parse(collected[key] ?? 'null');
    } catch {
      return null;
    }
  };

  const entries = parse('diary-entries-v1');
  if (entries && typeof entries === 'object') {
    for (const entry of Object.values(entries)) {
      for (const id of entry?.images ?? []) {
        if (typeof id === 'string') ids.add(id);
      }
    }
  }

  const habits = parse('diary-habits-v1');
  if (Array.isArray(habits)) {
    for (const habit of habits) {
      if (habit?.icon?.type === 'image' && typeof habit.icon.value === 'string') ids.add(habit.icon.value);
    }
  }

  const settings = parse('diary-settings-v1');
  if (settings && typeof settings === 'object') {
    for (const raw of settings.customCharacters ?? []) {
      const char = typeof raw === 'string' ? { id: raw, expressions: {} } : raw;
      if (typeof char?.id === 'string') ids.add(char.id);
      for (const v of Object.values(char?.expressions ?? {})) {
        if (typeof v === 'string') ids.add(v);
      }
    }
    if (settings.character?.type === 'custom' && typeof settings.character.value === 'string') {
      ids.add(settings.character.value);
    }
  }

  return ids;
}

export function findMissingImageIds(referenced, presentIds) {
  const present = new Set(presentIds);
  return [...referenced].filter((id) => !present.has(id));
}
