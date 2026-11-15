// 演出レシピ。「動き」1つと「重ねる効果」いくつかを束ねて、ひとつの演出意図を完成させたもの。
// 中身は番号の参照だけ（動きや効果そのものは複製しない）。当てはめたあとは、行ごとに自由に直せる。
// プログラムを含まないデータなので、ここに1件足すだけでレシピが増える。

import type { LayerRef, LineItem } from '../core/model';
import { getEffect } from './effects';
import { hasPreset } from './presets';
import type { Meta } from './presets/types';

export interface Recipe {
  id: string;
  name: string;
  /** 使いどころの説明 */
  hint: string;
  /** 土台にする動き */
  preset: string;
  /** 重ねる効果と、効かせる量 */
  layers: LayerRef[];
  /** 強さ・速さ（省くと行の今の値のまま） */
  strength?: number;
  speed?: number;
  meta: Meta;
}

const DEFS: Recipe[] = [
  {
    id: 'burst',
    name: 'サビ頭の爆発',
    hint: '叩きつけ＋色ずれ＋閃光。サビの頭、決め台詞に',
    preset: 'impact',
    layers: [
      { fx: 'flashcut', amount: 0.5 },
      { fx: 'rgb', amount: 0.6 },
      { fx: 'punch', amount: 0.5 },
      { fx: 'beatpop', amount: 0.35 },
    ],
    strength: 0.7,
    meta: { moods: ['excite', 'anger'], roles: ['chorus'], energy: 1, legibility: 2, minDur: 1.2 },
  },
  {
    id: 'hush',
    name: '囁き声',
    hint: '小さな文字が、暗がりにそっと浮かぶ。独白、秘密に',
    preset: 'whisper',
    layers: [
      { fx: 'veil', amount: 0.35 },
      { fx: 'tracking', amount: 0.45 },
    ],
    strength: 0.4,
    meta: { moods: ['secret', 'lonely', 'calm'], roles: ['intro', 'verse', 'bridge'], energy: 0.1, legibility: 2, minDur: 1.6 },
  },
  {
    id: 'countdown',
    name: '狂気の秒読み',
    hint: '刻み、震え、残像のあと砕ける。サビ前の緊張に',
    preset: 'tremble',
    layers: [
      { fx: 'stutter', amount: 0.6 },
      { fx: 'ghost', amount: 0.5 },
      { fx: 'shards', amount: 0.6 },
    ],
    strength: 0.65,
    meta: { moods: ['chaos', 'fear'], roles: ['pre', 'bridge'], energy: 0.8, legibility: 1, minDur: 1.6 },
  },
  {
    id: 'collapse',
    name: '言葉の崩壊',
    hint: 'いったん普通に見せてから、裂けて砕ける。破局、喪失に',
    preset: 'fall',
    layers: [
      { fx: 'tear', amount: 0.5 },
      { fx: 'shards', amount: 0.7 },
    ],
    strength: 0.6,
    meta: { moods: ['anger', 'lonely', 'chaos'], roles: ['chorus', 'bridge', 'outro'], energy: 0.7, legibility: 2, minDur: 1.8 },
  },
  {
    id: 'erosion',
    name: '言葉の侵食',
    hint: '同じ言葉が周りに増えて迫る。執着、依存、嫉妬に',
    preset: 'pulse',
    layers: [
      { fx: 'veil', amount: 0.4 },
      { fx: 'echo', amount: 0.65 },
    ],
    strength: 0.5,
    meta: { moods: ['obsess', 'fear'], roles: ['verse', 'pre', 'bridge'], energy: 0.6, legibility: 2, minDur: 2, maxChars: 14 },
  },
  {
    id: 'tunnel',
    name: '文字のトンネル',
    hint: '言葉が奥から次々に迫る。導入、間奏、場面転換に',
    preset: 'approach',
    layers: [
      { fx: 'tunnel', amount: 0.55 },
      { fx: 'zoom', amount: 0.5 },
    ],
    strength: 0.5,
    meta: { moods: ['calm', 'fear', 'obsess'], roles: ['intro', 'bridge'], energy: 0.5, legibility: 2, minDur: 2.2, maxChars: 14 },
  },
  {
    id: 'genesis',
    name: '粒子から生まれる言葉',
    hint: '粒が集まって文字になり、また粒へ還る。再生、祈りに',
    preset: 'blur',
    layers: [
      { fx: 'sparks', amount: 0.5 },
      { fx: 'assemble', amount: 0.55 },
      { fx: 'dissolve', amount: 0.55 },
    ],
    strength: 0.5,
    meta: { moods: ['hope', 'calm'], roles: ['intro', 'bridge', 'outro', 'chorus'], energy: 0.45, legibility: 2, minDur: 2.4 },
  },
  {
    id: 'twoface',
    name: '反転する意味',
    hint: '扉のように回って現れ、足もとに逆さの像。皮肉、二面性に',
    preset: 'flip',
    layers: [{ fx: 'mirror', amount: 0.55 }],
    strength: 0.5,
    meta: { moods: ['secret', 'chaos'], roles: ['verse', 'bridge'], energy: 0.4, legibility: 3, minDur: 1.6 },
  },
  {
    id: 'silence',
    name: '無音の衝撃',
    hint: '映像を落とし、動かない一語だけを置く。静止で刺す',
    preset: 'still',
    layers: [
      { fx: 'veil', amount: 0.8 },
      { fx: 'bars', amount: 0.5 },
    ],
    strength: 0.4,
    meta: { moods: ['secret', 'lonely', 'fear'], roles: ['bridge', 'outro'], energy: 0.4, legibility: 3, maxChars: 10 },
  },
  {
    id: 'slash',
    name: '画面を切り裂く',
    hint: '残像を引いて横切り、画面ごと揺らす。速い展開、攻めに',
    preset: 'slide',
    layers: [
      { fx: 'flashcut', amount: 0.3 },
      { fx: 'ghost', amount: 0.7 },
      { fx: 'quake', amount: 0.45 },
    ],
    strength: 0.65,
    meta: { moods: ['anger', 'excite'], roles: ['chorus', 'pre'], energy: 0.9, legibility: 2 },
  },
  {
    id: 'nectar',
    name: '蜜の滴り',
    hint: 'ゆらめいて、最後は溶け落ちる。甘さ、陶酔に',
    preset: 'drip',
    layers: [
      { fx: 'wave', amount: 0.4 },
      { fx: 'melt', amount: 0.6 },
    ],
    strength: 0.5,
    meta: { moods: ['sensual', 'lonely'], roles: ['verse', 'bridge', 'outro'], energy: 0.35, legibility: 2, minDur: 2 },
  },
  {
    id: 'noise',
    name: '壊れた信号',
    hint: '文字化けから現れ、ちらつき、裂ける。混乱、不信に',
    preset: 'type',
    layers: [
      { fx: 'scramble', amount: 0.5 },
      { fx: 'flicker', amount: 0.45 },
      { fx: 'tear', amount: 0.4 },
    ],
    strength: 0.55,
    meta: { moods: ['chaos', 'fear', 'secret'], roles: ['verse', 'pre'], energy: 0.6, legibility: 1, minDur: 1.8 },
  },
  {
    id: 'waltz',
    name: '残像の輪舞',
    hint: '回る文字が尾を引き、足もとに映る。踊り、耽美に',
    preset: 'rondo',
    layers: [
      { fx: 'ghost', amount: 0.55 },
      { fx: 'mirror', amount: 0.4 },
    ],
    strength: 0.55,
    meta: { moods: ['excite', 'sensual'], roles: ['chorus', 'verse'], energy: 0.6, legibility: 2, minDur: 2.2 },
  },
  {
    id: 'heartbeat',
    name: '高鳴る鼓動',
    hint: '拍ごとに文字も映像も脈打つ。高まり、恋に',
    preset: 'pulse',
    layers: [
      { fx: 'beatpop', amount: 0.6 },
      { fx: 'punch', amount: 0.4 },
      { fx: 'backflash', amount: 0.35 },
    ],
    strength: 0.6,
    meta: { moods: ['excite', 'sensual', 'obsess'], roles: ['pre', 'chorus'], energy: 0.75, legibility: 3 },
  },
  {
    id: 'ascend',
    name: '祈りの上昇',
    hint: '光の粒とともに昇り、粒になって消える。希望、解放に',
    preset: 'rise',
    layers: [
      { fx: 'sparks', amount: 0.6 },
      { fx: 'zoom', amount: 0.3 },
      { fx: 'dissolve', amount: 0.5 },
    ],
    strength: 0.5,
    meta: { moods: ['hope', 'calm'], roles: ['chorus', 'outro', 'bridge'], energy: 0.45, legibility: 3, minDur: 2 },
  },
];

/** 参照している動き・効果が実在するレシピだけを使う（書き間違いがあっても、アプリ全体は止めない） */
export const RECIPES: Recipe[] = DEFS.filter((r) => {
  const ok = hasPreset(r.preset) && r.layers.every((l) => !!getEffect(l.fx));
  if (!ok) console.warn(`レシピ ${r.id} は、存在しない動きか効果を参照しているため無効にしました`);
  return ok;
});

const byId = new Map(RECIPES.map((r) => [r.id, r]));

export function getRecipe(id: string | null | undefined): Recipe | undefined {
  return id ? byId.get(id) : undefined;
}

/** レシピを行に当てはめる。効果は写しを入れるので、あとから行ごとに直してもレシピ本体は変わらない */
export function applyRecipe(line: LineItem, r: Recipe): void {
  line.preset = r.preset;
  line.layers = r.layers.map((l) => ({ fx: l.fx, amount: l.amount }));
  line.recipe = r.id;
  if (r.strength !== undefined) line.strength = r.strength;
  if (r.speed !== undefined) line.speed = r.speed;
}
