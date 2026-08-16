// js/affiliates.js — 材料・道具の一覧と購入導線の一元管理
//
// 方針(2026-08-13 PD決定): アフィリエイトは不採用。**素の検索リンク+入手できそうな店舗名**のみ。
// 将来アフィ化を再検討する場合は Amazonアソシエイト規約のアプリ内利用制約(SPEC §8-2)を
// 先に再提示すること。リンク・店舗情報はこのファイル以外に書かない(不変条件)。

export const MATERIALS = [
  {
    name: 'アルミ線(自在ワイヤー)',
    search: 'アルミ線 2mm 工作',
    note: '芯材本体。太さは計算結果の目安に合わせる',
    shops: '100円ショップ・ホームセンター・手芸店',
  },
  {
    name: 'エポキシパテ',
    search: 'エポキシパテ 造形',
    note: '芯に肉付けする造形材',
    shops: 'ホームセンター・模型店',
  },
  {
    name: '石粉ねんど',
    search: '石粉粘土 フィギュア',
    note: '肉付け用(パテの代わりに)',
    shops: '100円ショップ・手芸店・画材店',
  },
  {
    name: 'ペンチ・ニッパー',
    search: 'ミニ ペンチ ニッパー セット',
    note: '線の切断・ねじり・曲げ',
    shops: '100円ショップ・ホームセンター',
  },
  {
    name: '定規・ノギス',
    search: 'ノギス 150mm',
    note: '寸法どおりに切るための計測',
    shops: '100円ショップ・ホームセンター',
  },
  {
    name: 'スパチュラ',
    search: 'スパチュラ 粘土 造形',
    note: '細部の造形(ネイル用品でも代用可)',
    shops: '100円ショップ・画材店',
  },
];

export function materialUrl(material) {
  return `https://www.amazon.co.jp/s?k=${encodeURIComponent(material.search)}`;
}
