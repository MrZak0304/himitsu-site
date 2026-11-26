// 予定(v1.06・SPEC §2.7)。手帳のように「その日の印」を絵文字 1 つ+ひとことで入れる。ピュア関数。
// 予定は記録(entries)とは別物: 連続記録・月のまとめ・カード・カレンダーの「記録あり」判定には一切影響しない。
// 形: { [date]: [{ id, emoji, title, createdAt, remindAt }] }(remindAt は通知の時刻 'HH:MM' か null。v1.16)(1 日 PLANS_PER_DAY_MAX 件まで)。予定の出来事の時刻は持たない(PD 決定 2026-10-12)。remindAt は通知のためだけの時刻で、カレンダー・帯には出さない

import { tr, weekdayShort, formatMonthDay } from '../i18n/index.js';

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

// 英語の検索語(v1.06)。どの言語の画面でも、日本語・英語のどちらで探しても見つかるようにする
export const PLAN_EMOJI_KEYWORDS_EN = Object.freeze({
  '🎂': 'birthday cake',
  '🎁': 'present gift',
  '🎉': 'party celebration event anniversary',
  '💍': 'wedding ring anniversary engagement',
  '🎓': 'graduation school ceremony',
  '🎄': 'christmas winter tree',
  '🎃': 'halloween autumn fall pumpkin',
  '🎍': 'new year holiday',
  '🎆': 'fireworks summer festival',
  '🌸': 'cherry blossom spring flower hanami',
  '🍁': 'autumn fall leaves maple',
  '🎎': 'doll festival',
  '🍻': 'drinks beer party cheers bar',
  '🍽️': 'dinner lunch meal restaurant eat',
  '☕': 'cafe coffee tea',
  '👫': 'date friends meet',
  '👨‍👩‍👧': 'family parents home visit',
  '👶': 'baby kids child checkup',
  '🐶': 'dog pet walk',
  '🐱': 'cat pet',
  '💼': 'work office business trip job',
  '📝': 'meeting deadline memo note',
  '💻': 'computer remote online work',
  '📚': 'study reading book class',
  '✏️': 'exam test homework',
  '🏫': 'school kindergarten class',
  '💴': 'money pay salary rent bill',
  '📞': 'call phone contact',
  '📦': 'package delivery parcel',
  '🏥': 'doctor hospital clinic checkup',
  '🦷': 'dentist teeth',
  '💊': 'medicine pharmacy prescription',
  '💉': 'vaccine shot injection blood',
  '💇': 'haircut hair salon barber',
  '💅': 'nails beauty salon spa',
  '🏃': 'run running jog marathon exercise',
  '🏋️': 'gym workout training',
  '🧘': 'yoga stretch meditation rest',
  '♨️': 'hot spring bath sauna onsen',
  '🎬': 'movie cinema film',
  '🎤': 'karaoke concert live sing',
  '🎵': 'music concert festival lesson',
  '🎮': 'game gaming release',
  '⚽': 'soccer football sports game match',
  '⚾': 'baseball sports game match',
  '🏊': 'swim pool beach sea',
  '⛰️': 'hiking mountain camping climb',
  '🎣': 'fishing fish',
  '🎨': 'art museum exhibition painting class',
  '📷': 'photo camera photography',
  '🎡': 'amusement park outing theme park',
  '🛍️': 'shopping sale mall',
  '🛒': 'groceries supermarket shopping',
  '✈️': 'travel flight trip airport abroad',
  '🚗': 'car drive driving',
  '🚃': 'train station trip',
  '🚲': 'bike cycling bicycle',
  '🏨': 'hotel stay trip',
  '⛩️': 'shrine temple visit',
  '🏠': 'home house moving',
  '🧹': 'cleaning tidy chores',
  '🗑️': 'trash garbage recycling',
  '🧺': 'laundry dry cleaning',
  '🍳': 'cooking cook meal prep',
  '🌱': 'plants garden gardening watering',
  '🔧': 'repair maintenance fix',
  '📅': 'plan schedule appointment reservation',
  '❤️': 'love heart important partner',
  '⭐': 'important star goal',
  '😴': 'day off rest sleep relax holiday',
  '☀️': 'sunny weather outside',
  '☔': 'rain umbrella rainy',
});

// 韓国語の検索語(v1.07)。英語と同じく、どの言語の画面でも探せる
export const PLAN_EMOJI_KEYWORDS_KO = Object.freeze({
  '🎂': '생일 케이크 생신',
  '🎁': '선물 기념',
  '🎉': '파티 축하 이벤트 기념일',
  '💍': '결혼 결혼식 반지 기념일 약혼',
  '🎓': '졸업 졸업식 입학 학교',
  '🎄': '크리스마스 성탄절 겨울 트리',
  '🎃': '핼러윈 할로윈 가을 호박',
  '🎍': '새해 설날 신정 명절',
  '🎆': '불꽃놀이 여름 축제',
  '🌸': '벚꽃 봄 꽃 꽃놀이',
  '🍁': '단풍 가을 낙엽',
  '🎎': '인형 축제',
  '🍻': '술 맥주 회식 모임 건배 술집',
  '🍽️': '저녁 점심 식사 외식 맛집 밥',
  '☕': '카페 커피 차',
  '👫': '데이트 친구 만남 약속',
  '👨‍👩‍👧': '가족 부모님 본가 친정 시댁 방문',
  '👶': '아기 아이 육아 검진',
  '🐶': '강아지 개 반려견 산책',
  '🐱': '고양이 반려묘',
  '💼': '일 회사 출근 출장 업무 직장',
  '📝': '회의 미팅 마감 메모',
  '💻': '컴퓨터 재택 온라인 원격',
  '📚': '공부 독서 책 수업',
  '✏️': '시험 테스트 숙제 과제',
  '🏫': '학교 유치원 어린이집 수업',
  '💴': '돈 결제 월급 월세 납부 공과금',
  '📞': '전화 통화 연락',
  '📦': '택배 배송 소포',
  '🏥': '병원 진료 검진 건강검진',
  '🦷': '치과 치아 이',
  '💊': '약 약국 처방',
  '💉': '예방접종 백신 주사 채혈 헌혈',
  '💇': '미용실 헤어 커트 머리 이발',
  '💅': '네일 손톱 미용 피부',
  '🏃': '달리기 러닝 조깅 마라톤 운동',
  '🏋️': '헬스 운동 트레이닝 필라테스',
  '🧘': '요가 스트레칭 명상 휴식',
  '♨️': '온천 목욕 사우나 찜질방',
  '🎬': '영화 영화관 극장',
  '🎤': '노래방 콘서트 공연 라이브',
  '🎵': '음악 콘서트 페스티벌 레슨',
  '🎮': '게임 발매',
  '⚽': '축구 스포츠 경기 시합',
  '⚾': '야구 스포츠 경기 시합',
  '🏊': '수영 수영장 바다 해변',
  '⛰️': '등산 산 캠핑 하이킹',
  '🎣': '낚시 물고기',
  '🎨': '미술 미술관 전시회 그림 박물관',
  '📷': '사진 카메라 촬영',
  '🎡': '놀이공원 테마파크 나들이',
  '🛍️': '쇼핑 세일 백화점',
  '🛒': '장보기 마트 슈퍼 쇼핑',
  '✈️': '여행 비행기 공항 해외',
  '🚗': '차 드라이브 운전 자동차',
  '🚃': '기차 지하철 역 전철',
  '🚲': '자전거 라이딩',
  '🏨': '호텔 숙박 여행',
  '⛩️': '절 신사 참배',
  '🏠': '집 이사',
  '🧹': '청소 정리 집안일',
  '🗑️': '쓰레기 분리수거 재활용',
  '🧺': '빨래 세탁 세탁소',
  '🍳': '요리 밥 반찬',
  '🌱': '식물 화분 텃밭 물주기',
  '🔧': '수리 점검 공사 고장',
  '📅': '일정 스케줄 약속 예약',
  '❤️': '사랑 하트 소중 연인',
  '⭐': '중요 별 목표',
  '😴': '휴일 쉬는 날 잠 휴식',
  '☀️': '맑음 날씨 밖',
  '☔': '비 우산 장마',
});

// 中国語(簡体字)の検索語(v1.09)。英語・韓国語と同じく、どの言語の画面でも探せる
export const PLAN_EMOJI_KEYWORDS_ZH = Object.freeze({
  '🎂': '生日 蛋糕 寿辰',
  '🎁': '礼物 纪念',
  '🎉': '派对 庆祝 活动 纪念日',
  '💍': '结婚 婚礼 戒指 纪念日 订婚',
  '🎓': '毕业 毕业典礼 入学 学校',
  '🎄': '圣诞节 圣诞 冬天 圣诞树',
  '🎃': '万圣节 秋天 南瓜',
  '🎍': '新年 元旦 春节 过年',
  '🎆': '烟花 夏天 节日 庙会',
  '🌸': '樱花 春天 花 赏花',
  '🍁': '红叶 枫叶 秋天 落叶',
  '🎎': '人偶 女儿节',
  '🍻': '喝酒 啤酒 聚餐 聚会 干杯 酒吧',
  '🍽️': '晚饭 午饭 吃饭 外食 美食 餐厅',
  '☕': '咖啡 咖啡馆 喝茶 下午茶',
  '👫': '约会 朋友 见面 约',
  '👨‍👩‍👧': '家人 父母 回家 老家 探亲',
  '👶': '宝宝 孩子 育儿 体检',
  '🐶': '狗 狗狗 宠物 遛狗',
  '🐱': '猫 猫咪 宠物',
  '💼': '工作 公司 上班 出差 职场',
  '📝': '会议 开会 截止 备忘',
  '💻': '电脑 居家办公 在线 远程',
  '📚': '学习 读书 书 上课',
  '✏️': '考试 测验 作业 功课',
  '🏫': '学校 幼儿园 托儿所 上课',
  '💴': '钱 付款 工资 房租 缴费',
  '📞': '电话 通话 联系',
  '📦': '快递 包裹 收货 配送',
  '🏥': '医院 看病 体检 就诊',
  '🦷': '牙医 牙齿 牙科',
  '💊': '药 药店 处方 吃药',
  '💉': '疫苗 打针 接种 抽血 献血',
  '💇': '美发 理发 剪头发 发型',
  '💅': '美甲 指甲 美容 护肤',
  '🏃': '跑步 慢跑 马拉松 运动',
  '🏋️': '健身 运动 训练 普拉提',
  '🧘': '瑜伽 拉伸 冥想 放松',
  '♨️': '温泉 泡澡 桑拿 洗澡',
  '🎬': '电影 电影院 看电影',
  '🎤': 'ktv 唱歌 演唱会 演出 现场',
  '🎵': '音乐 演唱会 音乐节 课程',
  '🎮': '游戏 发售',
  '⚽': '足球 体育 比赛',
  '⚾': '棒球 体育 比赛',
  '🏊': '游泳 泳池 海边 沙滩',
  '⛰️': '登山 爬山 露营 徒步',
  '🎣': '钓鱼 鱼',
  '🎨': '美术 美术馆 展览 画画 博物馆',
  '📷': '拍照 相机 摄影',
  '🎡': '游乐园 主题公园 出游',
  '🛍️': '购物 逛街 打折 商场',
  '🛒': '买菜 超市 购物',
  '✈️': '旅行 旅游 飞机 机场 出国',
  '🚗': '开车 自驾 兜风 汽车',
  '🚃': '电车 地铁 火车 车站',
  '🚲': '自行车 骑车 骑行',
  '🏨': '酒店 住宿 旅行',
  '⛩️': '寺庙 神社 参拜',
  '🏠': '家 搬家',
  '🧹': '打扫 整理 家务 大扫除',
  '🗑️': '垃圾 倒垃圾 分类 回收',
  '🧺': '洗衣服 洗衣 干洗',
  '🍳': '做饭 料理 下厨 便当',
  '🌱': '植物 盆栽 种菜 浇水',
  '🔧': '修理 维修 检修 装修 故障',
  '📅': '日程 计划 安排 预约',
  '❤️': '爱 爱心 重要 恋人',
  '⭐': '重要 星星 目标',
  '😴': '休息 假日 睡觉 放假',
  '☀️': '晴天 天气 外出',
  '☔': '下雨 雨伞 梅雨',
});

// スペイン語の検索語(v1.10)。中南米の共通スペイン語。ほかの言語と同じく、どの言語の画面でも探せる。
// アクセント記号は付けたまま持ち、検索ではアクセントを無視して比べる(foldAccents)
export const PLAN_EMOJI_KEYWORDS_ES = Object.freeze({
  '🎂': 'cumpleaños pastel torta',
  '🎁': 'regalo obsequio',
  '🎉': 'fiesta celebración evento aniversario',
  '💍': 'boda casamiento anillo aniversario compromiso',
  '🎓': 'graduación escuela ceremonia',
  '🎄': 'navidad invierno árbol',
  '🎃': 'halloween otoño calabaza',
  '🎍': 'año nuevo feriado',
  '🎆': 'fuegos artificiales verano festival',
  '🌸': 'flor de cerezo primavera flores',
  '🍁': 'otoño hojas arce',
  '🎎': 'muñecas festival',
  '🍻': 'bebidas cerveza brindis bar salida',
  '🍽️': 'cena almuerzo comida restaurante comer',
  '☕': 'café cafetería té',
  '👫': 'cita amigos verse salida',
  '👨‍👩‍👧': 'familia padres casa visita',
  '👶': 'bebé niños hijo control',
  '🐶': 'perro mascota paseo',
  '🐱': 'gato mascota',
  '💼': 'trabajo oficina viaje de negocios empleo',
  '📝': 'reunión fecha límite nota apuntes',
  '💻': 'computadora remoto en línea teletrabajo',
  '📚': 'estudio lectura libro clase',
  '✏️': 'examen prueba tarea',
  '🏫': 'escuela colegio jardín clase',
  '💴': 'dinero pago sueldo alquiler cuenta',
  '📞': 'llamada teléfono contacto',
  '📦': 'paquete envío entrega',
  '🏥': 'médico hospital clínica control',
  '🦷': 'dentista dientes',
  '💊': 'medicina farmacia receta',
  '💉': 'vacuna inyección sangre',
  '💇': 'corte de pelo peluquería cabello barbería',
  '💅': 'uñas belleza manicura spa',
  '🏃': 'correr carrera trotar maratón ejercicio',
  '🏋️': 'gimnasio entrenamiento ejercicio',
  '🧘': 'yoga estiramiento meditación descanso',
  '♨️': 'aguas termales baño sauna',
  '🎬': 'película cine',
  '🎤': 'karaoke concierto en vivo cantar',
  '🎵': 'música concierto festival clase',
  '🎮': 'videojuego juego lanzamiento',
  '⚽': 'fútbol deporte partido',
  '⚾': 'béisbol deporte partido',
  '🏊': 'natación piscina alberca playa mar',
  '⛰️': 'senderismo montaña campamento escalar',
  '🎣': 'pesca pescar',
  '🎨': 'arte museo exposición pintura clase',
  '📷': 'foto cámara fotografía',
  '🎡': 'parque de diversiones salida paseo',
  '🛍️': 'compras rebajas centro comercial',
  '🛒': 'mercado supermercado súper compras',
  '✈️': 'viaje vuelo avión aeropuerto extranjero',
  '🚗': 'auto carro coche manejar',
  '🚃': 'tren metro estación viaje',
  '🚲': 'bicicleta bici ciclismo',
  '🏨': 'hotel hospedaje viaje',
  '⛩️': 'santuario templo visita',
  '🏠': 'casa hogar mudanza',
  '🧹': 'limpieza ordenar quehaceres',
  '🗑️': 'basura reciclaje',
  '🧺': 'lavandería ropa tintorería',
  '🍳': 'cocinar cocina comida',
  '🌱': 'plantas jardín jardinería regar',
  '🔧': 'reparación mantenimiento arreglo',
  '📅': 'plan agenda cita reserva',
  '❤️': 'amor corazón importante pareja',
  '⭐': 'importante estrella meta',
  '😴': 'día libre descanso dormir relajarse feriado',
  '☀️': 'soleado clima afuera',
  '☔': 'lluvia paraguas lluvioso',
});

// ポルトガル語(ブラジル)の検索語(v1.11)。スペイン語と同じく、アクセント記号は付けたまま持ち、検索ではアクセントを無視して比べる
export const PLAN_EMOJI_KEYWORDS_PT = Object.freeze({
  '🎂': 'aniversário bolo parabéns',
  '🎁': 'presente lembrancinha',
  '🎉': 'festa comemoração evento celebração',
  '💍': 'casamento aliança anel noivado bodas',
  '🎓': 'formatura escola colação cerimônia',
  '🎄': 'natal inverno árvore',
  '🎃': 'halloween outono abóbora',
  '🎍': 'ano novo réveillon feriado',
  '🎆': 'fogos de artifício verão festival',
  '🌸': 'flor de cerejeira primavera flores',
  '🍁': 'outono folhas bordo',
  '🎎': 'bonecas festival',
  '🍻': 'bebidas cerveja brinde bar happy hour',
  '🍽️': 'jantar almoço refeição restaurante comer',
  '☕': 'café cafeteria chá',
  '👫': 'encontro amigos sair rolê',
  '👨‍👩‍👧': 'família pais casa visita',
  '👶': 'bebê crianças filho consulta',
  '🐶': 'cachorro pet passeio',
  '🐱': 'gato pet',
  '💼': 'trabalho escritório viagem a trabalho emprego',
  '📝': 'reunião prazo nota anotações',
  '💻': 'computador remoto online home office',
  '📚': 'estudo leitura livro aula',
  '✏️': 'prova exame tarefa lição de casa',
  '🏫': 'escola colégio creche aula',
  '💴': 'dinheiro pagamento salário aluguel conta',
  '📞': 'ligação telefone contato',
  '📦': 'pacote encomenda entrega',
  '🏥': 'hospital médico consulta clínica',
  '🦷': 'dentista dentes',
  '💊': 'remédio farmácia receita',
  '💉': 'vacina injeção exame de sangue',
  '💇': 'corte de cabelo salão cabeleireiro barbearia',
  '💅': 'unhas beleza manicure spa',
  '🏃': 'corrida correr maratona exercício',
  '🏋️': 'academia treino exercício',
  '🧘': 'ioga yoga alongamento meditação descanso',
  '♨️': 'águas termais banho sauna',
  '🎬': 'filme cinema',
  '🎤': 'karaokê show ao vivo cantar',
  '🎵': 'música show festival aula',
  '🎮': 'videogame jogo lançamento',
  '⚽': 'futebol esporte jogo partida',
  '⚾': 'beisebol esporte jogo partida',
  '🏊': 'natação piscina praia mar',
  '⛰️': 'trilha montanha acampamento escalada',
  '🎣': 'pesca pescar',
  '🎨': 'arte museu exposição pintura aula',
  '📷': 'foto câmera fotografia',
  '🎡': 'parque de diversões passeio',
  '🛍️': 'compras liquidação shopping',
  '🛒': 'mercado supermercado feira compras',
  '✈️': 'viagem voo avião aeroporto exterior',
  '🚗': 'carro dirigir',
  '🚃': 'trem metrô estação viagem',
  '🚲': 'bicicleta bike ciclismo',
  '🏨': 'hotel hospedagem viagem',
  '⛩️': 'santuário templo visita',
  '🏠': 'casa lar mudança',
  '🧹': 'limpeza faxina arrumar tarefas',
  '🗑️': 'lixo reciclagem',
  '🧺': 'lavanderia roupa lavar',
  '🍳': 'cozinhar cozinha comida',
  '🌱': 'plantas jardim jardinagem regar',
  '🔧': 'conserto manutenção reparo',
  '📅': 'plano agenda compromisso reserva',
  '❤️': 'amor coração importante namoro',
  '⭐': 'importante estrela meta',
  '😴': 'folga descanso dormir relaxar feriado',
  '☀️': 'ensolarado tempo ao ar livre',
  '☔': 'chuva guarda-chuva chuvoso',
});

// パレットの絵文字(カタログの順)。後方互換のために残す
export const PLAN_EMOJI_PRESETS = Object.freeze(PLAN_EMOJI_CATALOG.map((x) => x.emoji));

// カタカナ → ひらがな(検索の揺れを吸収)
function toHiragana(s) {
  return s.replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// ラテン文字のアクセント記号を外す(café → cafe、cumpleaños → cumpleanos、almoço → almoco。v1.10・v1.11)。
// 外すのは結合文字 U+0300〜036F だけで、最後に NFC に戻すので、かなの濁点・半濁点(が・パ)はそのまま残る
export function foldAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
}

// 検索語で絵文字を絞る。空なら全部。検索語自体が絵文字ならそれも先頭に返す(自由入力の代わり)
export function searchEmojis(query) {
  const q = toHiragana((typeof query === 'string' ? query : '').trim().toLowerCase());
  if (q === '') return [...PLAN_EMOJI_PRESETS];
  const qFolded = foldAccents(q);
  return PLAN_EMOJI_CATALOG
    .filter((x) => x.emoji === q || x.keywords.some((k) => toHiragana(k).includes(q)) || (PLAN_EMOJI_KEYWORDS_EN[x.emoji] ?? '').includes(q) || (PLAN_EMOJI_KEYWORDS_KO[x.emoji] ?? '').includes(q) || (PLAN_EMOJI_KEYWORDS_ZH[x.emoji] ?? '').includes(q) || foldAccents(PLAN_EMOJI_KEYWORDS_ES[x.emoji] ?? '').includes(qFolded) || foldAccents(PLAN_EMOJI_KEYWORDS_PT[x.emoji] ?? '').includes(qFolded))
    .map((x) => x.emoji);
}

export const MESSAGES = {
  noEmoji: tr('絵文字を1つえらんでください。'),
  tooMany: tr('予定は1日に{0}件までです。', PLANS_PER_DAY_MAX),
  pastDate: tr('予定は今日以降の日にちに入れられます。'),
  badDate: tr('日にちを選んでください。'),
};

// 入力欄のカーソル位置(start〜end の選択範囲)に text を入れる(2026-10-27 PD 了承: タグとできごとに絵文字をすぐ入れる)。
// maxLength(入力欄の maxlength。UTF-16 の長さ)を超えるときは入れない=null。戻り値: { value, caret }
export function insertAtCaret(value, start, end, text, maxLength = -1) {
  const v = typeof value === 'string' ? value : '';
  const s = Number.isInteger(start) && start >= 0 && start <= v.length ? start : v.length;
  const e = Number.isInteger(end) && end >= s && end <= v.length ? end : s;
  const next = v.slice(0, s) + text + v.slice(e);
  if (maxLength >= 0 && next.length > maxLength) return null;
  return { value: next, caret: s + text.length };
}

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

// タイトルの先頭の絵文字を取り出す(2026-10-30: 予定の入力をタグと同じ「入力欄+🎉▾」にした。「🎉▾」で選んだ絵文字も、
// キーボードで打った絵文字も、タイトル欄の先頭にあるものが予定の絵文字になる)。先頭が絵文字でなければ emoji は ''。戻り値: { emoji, title }
export function splitLeadingEmoji(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  const g = graphemes(s);
  if (g.length === 0 || !isEmojiGrapheme(g[0])) return { emoji: '', title: s };
  return { emoji: g[0], title: g.slice(1).join('').trim() };
}

// 書記素 1 つが絵文字か(国旗・キーキャップを含む)。ふつうの文字・数字は false
export function isEmojiGrapheme(g) {
  return typeof g === 'string' && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(g);
}

// 予定の入力欄の文字から、保存する { emoji, title } を作る。先頭の絵文字が予定の絵文字。
// 絵文字を選ばなかったときは、タイトルの頭文字を予定の印にする(2026-10-31 PD FB「絵文字なしにしたい場合もある。頭文字が出るように」)。
// タイトルはそのまま残す(「誕生日」→ 印は「誕」、タイトルは「誕生日」)。どちらも空なら emoji は ''
export function planFromInput(raw) {
  const { emoji, title } = splitLeadingEmoji(raw);
  if (emoji) return { emoji, title };
  return { emoji: graphemes(normalizeTitle(title))[0] ?? '', title };
}

// 予定から入力欄に出す文字(planFromInput の逆)。絵文字なら先頭に付け、頭文字の印ならタイトルだけ
export function planInputText(plan) {
  const emoji = plan?.emoji ?? '';
  const title = plan?.title ?? '';
  if (isEmojiGrapheme(emoji)) return `${emoji}${title}`;
  return title || emoji;
}

// 「🎉▾」で選んだ絵文字をタイトル欄の先頭に入れる。先頭にもう絵文字があれば入れ替える(予定の絵文字は 1 つ)。
// maxLength(入力欄の maxlength。UTF-16 の長さ)を超えるときは入れない=null。戻り値: { value, caret }(caret は絵文字のうしろ)
export function putLeadingEmoji(value, emoji, maxLength = -1) {
  const { title } = splitLeadingEmoji(value);
  const next = emoji + title;
  if (maxLength >= 0 && next.length > maxLength) return null;
  return { value: next, caret: emoji.length };
}

// ひとこと: 前後の空白を除き、PLAN_TITLE_MAX 書記素で切る
export function normalizeTitle(raw) {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  return graphemes(s).slice(0, PLAN_TITLE_MAX).join('');
}

// 通知の時刻(v1.16)。'HH:MM' だけを受け付け、ほかは null(お知らせなし)
export function normalizeRemindAt(raw) {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{2}):(\d{2})$/.exec(raw);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return raw;
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
    remindAt: normalizeRemindAt(raw.remindAt), // 通知の時刻(v1.16)。null=お知らせなし。旧データは欠落=null
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
export function shortDateLabel(dateKey, todayKey = null) {
  if (todayKey && dateKey === todayKey) return tr('きょう');
  if (todayKey && daysBetween(todayKey, dateKey) === 1) return tr('あした');
  const [y, m, d] = dateKey.split('-').map(Number);
  return formatMonthDay(m, d, new Date(y, m - 1, d).getDay());
}

// きょう画面の「今週の予定」(1 行で 1 週間分。PD FB 2026-10-13): today から n 日分の { date, dow, day, emojis, count }
export function weekDays(plansByDate, todayKey, n = 7) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const date = addDaysKey(todayKey, i);
    const [, , d] = date.split('-').map(Number);
    const list = plansByDate?.[date] ?? [];
    out.push({ date, dow: weekdayShort(dayOfWeek(date)), day: d, emojis: cellEmojis(list), count: list.length, today: i === 0 });
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
