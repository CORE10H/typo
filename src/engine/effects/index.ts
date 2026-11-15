// 重ねる効果の一覧（演出カタログ）。
// 効果を足すときは、該当するファイルに1つ書いて、ここに1行足す。

import { tilt, tunnel, zoom } from './depth';
import { melt, wave } from './distort';
import { flicker, ghost, rgb, scramble, tear } from './glitch';
import { assemble, dissolve, shards, sparks } from './particle';
import { backflash, barhit, beatpop, stutter } from './rhythm';
import { bars, flashcut, punch, quake, veil } from './scene';
import { echo, mirror, reveal, tracking } from './typeset';
import type { Effect } from './types';

export const EFFECTS: Effect[] = [
  // グリッチ
  rgb,
  tear,
  flicker,
  ghost,
  scramble,
  // 歪み
  wave,
  melt,
  // 奥行き
  tunnel,
  zoom,
  tilt,
  // リズム
  beatpop,
  backflash,
  barhit,
  stutter,
  // 粒子
  assemble,
  dissolve,
  shards,
  sparks,
  // 文字組み
  tracking,
  echo,
  mirror,
  reveal,
  // 画面
  flashcut,
  veil,
  bars,
  punch,
  quake,
];

const byId = new Map(EFFECTS.map((e) => [e.id, e]));

export function getEffect(id: string): Effect | undefined {
  return byId.get(id);
}

/** 1つの行に重ねられる効果の数の上限（重くなりすぎ・読みにくくなりすぎを防ぐ） */
export const MAX_LAYERS = 5;
