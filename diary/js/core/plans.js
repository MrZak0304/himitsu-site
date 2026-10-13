// 予定(v1.06・SPEC §2.7)。手帳のように「その日の印」を絵文字 1 つ+ひとことで入れる。ピュア関数。
// 予定は記録(entries)とは別物: 連続記録・月のまとめ・カード・カレンダーの「記録あり」判定には一切影響しない。
// 形: { [date]: [{ id, emoji, title, createdAt }] }(1 日 PLANS_PER_DAY_MAX 件まで。時刻は持たない=PD 決定 2026-10-12)

export const PLAN_TITLE_MAX = 20; // ひとことの上限(書記素)
export const PLANS_PER_DAY_MAX = 5;

// 絵文字カタログ(ドロップダウンで検索して選ぶ。PD FB 2026-10-13「ずらっと並べずドロップダウンで」)。
// keywords は日本語の検索語(ひらがな・漢字・カタカナ)。画像・外部フォントは使わない(不変条件 7)
export const PLAN_EMOJI_CATALOG = Object.freeze([
  // 行事・お祝い
  { emoji: '🎂', keywords: ['誕生日', 'たんじょうび', 'バースデー', 'ケーキ'] },
  { emoji: '🎁', keywords: ['プレゼント', '贈り物', 'おくりもの', 'ギフト'] },
  { emoji: '🎉', keywords: ['お祝い', 'おいわい', 'パーティー', 'イベント', '記念日', 'きねんび'] },
  { emoji: '💍', keywords: ['結婚', 'けっこん', '指輪', 'ゆびわ', '結婚式', '記念日'] },
  { emoji: '🎓', keywords: ['卒業', 'そつぎょう', '学校', 'がっこう', '入学', 'にゅうがく', '式', 'しき'] },
  { emoji: '🎄', keywords: ['クリスマス', '冬', 'ふゆ', 'ツリー'] },
  { emoji: '🎃', keywords: ['ハロウィン', '秋', 'あき', 'かぼちゃ'] },
  { emoji: '🎍', keywords: ['正月', 'しょうがつ', 'お正月', '門松', '年始', 'ねんし'] },
  { emoji: '🎆', keywords: ['花火', 'はなび', '夏', 'なつ', '祭り', 'まつり'] },
  { emoji: '🌸', keywords: ['桜', 'さくら', '花見', 'はなみ', '春', 'はる', '花', 'はな'] },
  { emoji: '🍁', keywords: ['紅葉', 'こうよう', 'もみじ', '秋', 'あき'] },
  { emoji: '🎎', keywords: ['ひな祭り', 'ひなまつり', '節句', 'せっく'] },
  // 人・集まり
  { emoji: '🍻', keywords: ['飲み会', 'のみかい', 'ビール', '乾杯', 'かんぱい', '宴会', 'えんかい', 'お酒', 'おさけ'] },
  { emoji: '🍽️', keywords: ['食事', 'しょくじ', 'ごはん', 'ランチ', 'ディナー', '外食', 'がいしょく', 'レストラン'] },
  { emoji: '☕', keywords: ['カフェ', 'コーヒー', 'お茶', 'おちゃ', '喫茶', 'きっさ'] },
  { emoji: '👫', keywords: ['デート', '友だち', 'ともだち', '友達', '会う', 'あう'] },
  { emoji: '👨‍👩‍👧', keywords: ['家族', 'かぞく', '実家', 'じっか', '帰省', 'きせい'] },
  { emoji: '👶', keywords: ['赤ちゃん', 'あかちゃん', '子ども', 'こども', '出産', 'しゅっさん', '検診', 'けんしん'] },
  { emoji: '🐶', keywords: ['犬', 'いぬ', 'ペット', '散歩', 'さんぽ'] },
  { emoji: '🐱', keywords: ['猫', 'ねこ', 'ペット'] },
  // 仕事・学び
  { emoji: '💼', keywords: ['仕事', 'しごと', '出勤', 'しゅっきん', '出張', 'しゅっちょう', '会社', 'かいしゃ'] },
  { emoji: '📝', keywords: ['会議', 'かいぎ', 'ミーティング', '打ち合わせ', 'うちあわせ', 'メモ', '締め切り', 'しめきり'] },
  { emoji: '💻', keywords: ['パソコン', 'リモート', '在宅', 'ざいたく', 'オンライン'] },
  { emoji: '📚', keywords: ['勉強', 'べんきょう', '読書', 'どくしょ', '本', 'ほん', '授業', 'じゅぎょう'] },
  { emoji: '✏️', keywords: ['試験', 'しけん', 'テスト', '資格', 'しかく', '宿題', 'しゅくだい'] },
  { emoji: '🏫', keywords: ['学校', 'がっこう', '保育園', 'ほいくえん', '幼稚園', 'ようちえん', '参観', 'さんかん'] },
  { emoji: '💴', keywords: ['給料', 'きゅうりょう', 'お金', 'おかね', '支払い', 'しはらい', '家賃', 'やちん', '振込', 'ふりこみ'] },
  { emoji: '📞', keywords: ['電話', 'でんわ', '連絡', 'れんらく'] },
  { emoji: '📦', keywords: ['荷物', 'にもつ', '宅配', 'たくはい', '配達', 'はいたつ', '届く', 'とどく'] },
  // 健康・美容
  { emoji: '🏥', keywords: ['病院', 'びょういん', '通院', 'つういん', '診察', 'しんさつ', '健診', 'けんしん', '検査', 'けんさ'] },
  { emoji: '🦷', keywords: ['歯医者', 'はいしゃ', '歯', 'は', '歯科', 'しか'] },
  { emoji: '💊', keywords: ['薬', 'くすり', '処方', 'しょほう', '薬局', 'やっきょく'] },
  { emoji: '💉', keywords: ['注射', 'ちゅうしゃ', '予防接種', 'よぼうせっしゅ', 'ワクチン', '献血', 'けんけつ'] },
  { emoji: '💇', keywords: ['美容院', 'びよういん', '髪', 'かみ', '散髪', 'さんぱつ', 'カット', '床屋', 'とこや'] },
  { emoji: '💅', keywords: ['ネイル', '美容', 'びよう', 'エステ', 'サロン'] },
  { emoji: '🏃', keywords: ['運動', 'うんどう', 'ランニング', 'ジョギング', 'マラソン', '走る', 'はしる'] },
  { emoji: '🏋️', keywords: ['ジム', '筋トレ', 'きんとれ', 'トレーニング'] },
  { emoji: '🧘', keywords: ['ヨガ', 'ストレッチ', '瞑想', 'めいそう', '休む', 'やすむ'] },
  { emoji: '♨️', keywords: ['温泉', 'おんせん', 'お風呂', 'おふろ', '銭湯', 'せんとう', 'サウナ'] },
  // 遊び・趣味
  { emoji: '🎬', keywords: ['映画', 'えいが', '映画館', 'えいがかん', 'シネマ'] },
  { emoji: '🎤', keywords: ['カラオケ', 'ライブ', 'コンサート', '歌', 'うた'] },
  { emoji: '🎵', keywords: ['音楽', 'おんがく', 'ライブ', 'コンサート', 'フェス', '演奏', 'えんそう', 'レッスン'] },
  { emoji: '🎮', keywords: ['ゲーム', '発売', 'はつばい'] },
  { emoji: '⚽', keywords: ['サッカー', 'スポーツ', '試合', 'しあい', '観戦', 'かんせん', '部活', 'ぶかつ'] },
  { emoji: '⚾', keywords: ['野球', 'やきゅう', 'スポーツ', '試合', 'しあい', '観戦', 'かんせん'] },
  { emoji: '🏊', keywords: ['プール', '水泳', 'すいえい', '海', 'うみ', '泳ぐ', 'およぐ'] },
  { emoji: '⛰️', keywords: ['山', 'やま', '登山', 'とざん', 'ハイキング', 'キャンプ'] },
  { emoji: '🎣', keywords: ['釣り', 'つり', '魚', 'さかな'] },
  { emoji: '🎨', keywords: ['美術館', 'びじゅつかん', '展示', 'てんじ', '絵', 'え', 'アート', '習い事', 'ならいごと'] },
  { emoji: '📷', keywords: ['写真', 'しゃしん', 'カメラ', '撮影', 'さつえい'] },
  { emoji: '🎡', keywords: ['遊園地', 'ゆうえんち', 'テーマパーク', 'お出かけ', 'おでかけ', '観覧車', 'かんらんしゃ'] },
  { emoji: '🛍️', keywords: ['買い物', 'かいもの', 'ショッピング', 'セール'] },
  { emoji: '🛒', keywords: ['買い物', 'かいもの', 'スーパー', '買い出し', 'かいだし'] },
  // 移動・旅
  { emoji: '✈️', keywords: ['旅行', 'りょこう', '飛行機', 'ひこうき', '出張', 'しゅっちょう', '海外', 'かいがい', '空港', 'くうこう'] },
  { emoji: '🚗', keywords: ['車', 'くるま', 'ドライブ', '運転', 'うんてん', '車検', 'しゃけん'] },
  { emoji: '🚃', keywords: ['電車', 'でんしゃ', '新幹線', 'しんかんせん', '遠出', 'とおで', '駅', 'えき'] },
  { emoji: '🚲', keywords: ['自転車', 'じてんしゃ', 'サイクリング'] },
  { emoji: '🏨', keywords: ['ホテル', '宿', 'やど', '泊まり', 'とまり', '旅館', 'りょかん'] },
  { emoji: '⛩️', keywords: ['神社', 'じんじゃ', 'お参り', 'おまいり', 'お寺', 'おてら', '初詣', 'はつもうで'] },
  // 家・くらし
  { emoji: '🏠', keywords: ['家', 'いえ', '引っ越し', 'ひっこし', '在宅', 'ざいたく', '帰る', 'かえる'] },
  { emoji: '🧹', keywords: ['掃除', 'そうじ', '片付け', 'かたづけ', '大掃除', 'おおそうじ'] },
  { emoji: '🗑️', keywords: ['ゴミ', 'ごみ', 'ゴミの日', '資源', 'しげん', '粗大ゴミ'] },
  { emoji: '🧺', keywords: ['洗濯', 'せんたく', 'クリーニング'] },
  { emoji: '🍳', keywords: ['料理', 'りょうり', '自炊', 'じすい', 'お弁当', 'おべんとう'] },
  { emoji: '🌱', keywords: ['植物', 'しょくぶつ', '園芸', 'えんげい', 'ガーデニング', '水やり', 'みずやり', '畑', 'はたけ'] },
  { emoji: '🔧', keywords: ['修理', 'しゅうり', '点検', 'てんけん', '工事', 'こうじ', '業者', 'ぎょうしゃ'] },
  { emoji: '📅', keywords: ['予定', 'よてい', 'スケジュール', '約束', 'やくそく', '予約', 'よやく'] },
  // 気持ち・その他
  { emoji: '❤️', keywords: ['大事', 'だいじ', '好き', 'すき', '愛', 'あい', 'ハート', '恋人', 'こいびと'] },
  { emoji: '⭐', keywords: ['大切', 'たいせつ', '重要', 'じゅうよう', '星', 'ほし', '目標', 'もくひょう'] },
  { emoji: '😴', keywords: ['休み', 'やすみ', '休日', 'きゅうじつ', '寝る', 'ねる', 'ゆっくり', 'オフ'] },
  { emoji: '☀️', keywords: ['晴れ', 'はれ', '天気', 'てんき', '外', 'そと'] },
  { emoji: '☔', keywords: ['雨', 'あめ', '傘', 'かさ', '梅雨', 'つゆ'] },
]);

// パレットの絵文字(カタログの順)。後方互換のために残す
export const PLAN_EMOJI_PRESETS = Object.freeze(PLAN_EMOJI_CATALOG.map((x) => x.emoji));

// カタカナ → ひらがな(検索の揺れを吸収)
function toHiragana(s) {
  return s.replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// 検索語で絵文字を絞る。空なら全部。検索語自体が絵文字ならそれも先頭に返す(自由入力の代わり)
export function searchEmojis(query) {
  const q = toHiragana((typeof query === 'string' ? query : '').trim().toLowerCase());
  if (q === '') return [...PLAN_EMOJI_PRESETS];
  return PLAN_EMOJI_CATALOG
    .filter((x) => x.emoji === q || x.keywords.some((k) => toHiragana(k).includes(q)))
    .map((x) => x.emoji);
}

export const MESSAGES = {
  noEmoji: '絵文字を1つえらんでください。',
  tooMany: `予定は1日に${PLANS_PER_DAY_MAX}件までです。`,
  pastDate: '予定は今日以降の日にちに入れられます。',
  badDate: '日にちを選んでください。',
};

// 文字列を書記素(見た目の 1 文字)に分ける。絵文字の結合(👨‍👩‍👧・🇯🇵・❤️ など)を 1 つとして数える
export function graphemes(s) {
  const str = typeof s === 'string' ? s : '';
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(str)].map((x) => x.segment);
  }
  return [...str];
}

// 入力から絵文字 1 つを取り出す(先頭の書記素。空白は除く)。無ければ ''
export function normalizeEmoji(raw) {
  const g = graphemes(typeof raw === 'string' ? raw.trim() : '');
  return g.length > 0 ? g[0] : '';
}

// ひとこと: 前後の空白を除き、PLAN_TITLE_MAX 書記素で切る
export function normalizeTitle(raw) {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return graphemes(s).slice(0, PLAN_TITLE_MAX).join('');
}

// 1 件の正規化。id と絵文字が無ければ捨てる
export function normalizePlan(raw) {
  if (typeof raw !== 'object' || raw === null) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  const emoji = normalizeEmoji(raw.emoji);
  if (!emoji) return null;
  return {
    id: raw.id,
    emoji,
    title: normalizeTitle(raw.title),
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
  };
}

// 1 日分の正規化(壊れた要素を捨て、入れた順に並べ、上限で切る)
export function normalizeDayPlans(raw) {
  const list = (Array.isArray(raw) ? raw : []).map(normalizePlan).filter(Boolean);
  list.sort((a, b) => a.createdAt - b.createdAt);
  return list.slice(0, PLANS_PER_DAY_MAX);
}

export function canAddPlan(dayPlans) {
  return (dayPlans?.length ?? 0) < PLANS_PER_DAY_MAX;
}

// カレンダーのマスに出す絵文字(先頭 max 個)
export function cellEmojis(dayPlans, max = 2) {
  return (dayPlans ?? []).slice(0, max).map((p) => p.emoji);
}

// 今日以降の予定を日付順に平らにする({date, ...plan})。days を指定すると today+days まで
export function upcomingPlans(plansByDate, todayKey, { days = null, limit = null, from = todayKey } = {}) {
  const out = [];
  const keys = Object.keys(plansByDate ?? {}).sort();
  for (const date of keys) {
    if (date < from) continue;
    if (days !== null && daysBetween(todayKey, date) > days) continue;
    for (const p of plansByDate[date] ?? []) out.push({ date, ...p });
  }
  return limit !== null ? out.slice(0, limit) : out;
}

// 2 つの日付キーの日数差(b - a)。ローカル日付の差なので DST の影響を受けない
export function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// 日付の表示(きょう画面の「このあと」用): 「10/15(水)」
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
export function shortDateLabel(dateKey, todayKey = null) {
  if (todayKey && dateKey === todayKey) return 'きょう';
  if (todayKey && daysBetween(todayKey, dateKey) === 1) return 'あした';
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${dow})`;
}

// きょう画面の「今週の予定」(1 行で 1 週間分。PD FB 2026-10-13): today から n 日分の { date, dow, day, emojis, count }
export function weekDays(plansByDate, todayKey, n = 7) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const date = addDaysKey(todayKey, i);
    const [, , d] = date.split('-').map(Number);
    const list = plansByDate?.[date] ?? [];
    out.push({ date, dow: WEEKDAYS[dayOfWeek(date)], day: d, emojis: cellEmojis(list), count: list.length, today: i === 0 });
  }
  return out;
}

function dayOfWeek(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function addDaysKey(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
