// 重ねる効果（レイヤー）の共通の型。
// 1つの行には「動き」を1つ選び、その上に効果をいくつでも重ねられる。
//
// 重ねたときの決まり（同じ項目を複数の効果が触るとき）：
//   位置・回転       … 足し合わせる
//   大きさ・透明度   … 掛け合わせる
//   ぼかし           … いちばん強いものを採る
//   文字の切り方（破片・粒・輪切りなど）… リストの後ろにある効果が優先。該当しない瞬間は前の効果へ譲る
//   登場・退場を受け持つ効果 … それぞれ1つまで（動きの側の登場・退場は省かれる）

import type { CharBox, CharState, DrawCtx, LineCtx, LineFx, Sprite } from '../presets/types';

export type EffectCategory = 'glitch' | 'distort' | 'depth' | 'rhythm' | 'particle' | 'type' | 'scene';

export const CATEGORY_LABELS: Record<EffectCategory, string> = {
  glitch: 'グリッチ',
  distort: '歪み',
  depth: '奥行き',
  rhythm: 'リズム',
  particle: '粒子',
  type: '文字組み',
  scene: '画面',
};

/** 色づけ。0 = そのまま、1 = 赤、2 = 水色、3 = 白 */
export type Tint = 0 | 1 | 2 | 3;

/** 行の写し（残像・色ずれ・奥行きの複製など）を1枚描くための指示 */
export interface Pass {
  /** ずらす量（出力のピクセル） */
  dx: number;
  dy: number;
  scale: number;
  /** 上下を反転する（水面の映り込み用） */
  flipY: boolean;
  rot: number;
  alpha: number;
  /** ぼかしの上乗せ 0〜1 */
  blur: number;
  tint: Tint;
  /** 何秒前（負の値）の姿を描くか */
  dt: number;
  /** 本体より手前に描く */
  front: boolean;
}

export interface DrawTools {
  /** 同じ見た目で、別の文字の絵を取り出す（文字化けの効果用） */
  glyph(ch: string): Sprite;
  /** この行に出てくる文字の一覧 */
  pool: string[];
}

export interface Effect {
  id: string;
  name: string;
  /** 使いどころの説明 */
  hint: string;
  category: EffectCategory;
  /** 働く場面。enter = 登場、exit = 退場、hold = 出ている間、accent = 瞬間 */
  slot: 'enter' | 'exit' | 'hold' | 'accent';
  /** 動きの側の登場・退場を省いて、この効果が受け持つ */
  replaces?: 'enter' | 'exit';
  /** 重さ。1 = 軽い、3 = 重い */
  cost: 1 | 2 | 3;
  /** 読みやすさ。3 = 影響なし、1 = 一時的に読みにくい */
  legibility: 1 | 2 | 3;
  /** 1文字ごとの位置・大きさ・濃さを変える。a は効かせる量（標準 1） */
  state?(c: CharBox, L: LineCtx, s: CharState, a: number): void;
  /** 行全体・画面全体にかかる効果 */
  fx?(L: LineCtx, out: LineFx, a: number): void;
  /** 行の写しを足す。add() が返す入れ物に値を書き込む */
  passes?(L: LineCtx, a: number, add: () => Pass): void;
  /** 文字の描き方を変える。true を返すと通常の描画を省く */
  draw?(ctx: DrawCtx, sprite: Sprite, c: CharBox, L: LineCtx, s: CharState, a: number, tools: DrawTools): boolean;
}

/** 効かせる量 0〜1 を、係数（0.5 のとき 1）に直す */
export function amountToFactor(amount: number): number {
  return 0.35 + 1.3 * Math.min(1, Math.max(0, amount));
}

/** 登場にかける秒数 */
export function enterLen(L: LineCtx, sec: number): number {
  return Math.max(0.05, Math.min(sec * L.sp, L.dur * 0.45));
}

/** 退場が始まる時刻と、かける秒数 */
export function exitSpan(L: LineCtx, sec: number): { start: number; len: number } {
  const len = Math.max(0.05, Math.min(sec * L.sp, L.dur * 0.45));
  return { start: L.dur - len, len };
}

/** 出入りをなめらかにするための、0→1→0 の山 */
export function inOutEnvelope(L: LineCtx, inSec: number, outSec: number): number {
  const a = Math.min(1, Math.max(0, L.t / Math.max(0.01, Math.min(inSec, L.dur * 0.4))));
  const b = Math.min(1, Math.max(0, (L.dur - L.t) / Math.max(0.01, Math.min(outSec, L.dur * 0.4))));
  return a * b;
}

/** 行の中での横位置（0 = 左端、1 = 右端） */
export function across(c: CharBox, L: LineCtx): number {
  return L.width > 1 ? Math.min(1, Math.max(0, c.x / L.width + 0.5)) : 0.5;
}
