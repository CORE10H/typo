// 動き（プリセット）の共通の型。
// 基本型は basic.ts のデータで定義し、特殊型は 1プリセット = 1ファイルで書く（仕様書6章の決まり）。

/** 1文字ぶんの置き場所。x, y は行の中心から見た位置（出力のピクセル） */
export interface CharBox {
  ch: string;
  x: number;
  y: number;
  /** 文字の幅 */
  w: number;
  /** 行の中での通し番号と総数 */
  i: number;
  n: number;
  /** 文字ごとに決まった乱数の種 */
  seed: number;
}

/** ある瞬間の1文字の状態 */
export interface CharState {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  /** 回転（ラジアン） */
  rot: number;
  alpha: number;
  /** ぼかし 0〜1 */
  blur: number;
  /** 拡大縮小の基準。0 = 中央、-0.5 = 上端 */
  originY: number;
}

export interface BeatInfo {
  /** 今の拍が始まってからの秒数 */
  sinceBeat: number;
  /** 今の小節が始まってからの秒数 */
  sinceBar: number;
  /** 1拍の長さ（秒） */
  beatLen: number;
  /** 1小節の長さ（秒） */
  barLen: number;
  /** 曲の頭から数えた拍の番号 */
  beatNo: number;
  /** 小節の頭の拍か */
  strong: boolean;
}

/** ある瞬間の行（またはフレーズ）の状況 */
export interface LineCtx {
  /** 行が出てからの秒数 */
  t: number;
  /** 行が出ている長さ（秒） */
  dur: number;
  /** 強さの係数（強さ 0.5 のとき 1） */
  k: number;
  /** 速さの係数（速さ 0.5 のとき 1。小さいほど速い） */
  sp: number;
  /** 文字の大きさ（出力のピクセル） */
  em: number;
  /** 行の幅と高さ */
  width: number;
  height: number;
  n: number;
  seed: number;
  beat: BeatInfo;
}

/** 行全体にかかる効果 */
export interface LineFx {
  shakeX: number;
  shakeY: number;
  /** 光のフラッシュ 0〜1 */
  flash: number;
}

/** 文字の絵（あらかじめ描いておいた1文字ぶんの画像） */
export interface Sprite {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** 出力のピクセルでの幅と高さ（余白込み） */
  w: number;
  h: number;
}

export interface Preset {
  id: string;
  name: string;
  /** 向いている歌詞の説明 */
  hint: string;
  kind: 'basic' | 'special';
  /** 文字の大きさの倍率（囁きは小さめ、など） */
  sizeFactor: number;
  /** 粒子の量の倍率 */
  particles: number;
  state(c: CharBox, L: LineCtx, out: CharState): void;
  fx(L: LineCtx, out: LineFx): void;
  /**
   * 特別な描き方が要るときだけ用意する（砕散の破片など）。
   * 文字の中心が原点、回転と拡大は適用済みの状態で呼ばれる。true を返すと通常の描画を省く。
   */
  draw?(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    sprite: Sprite,
    c: CharBox,
    L: LineCtx,
    s: CharState,
  ): boolean;
}

export function resetState(s: CharState): void {
  s.dx = 0;
  s.dy = 0;
  s.sx = 1;
  s.sy = 1;
  s.rot = 0;
  s.alpha = 1;
  s.blur = 0;
  s.originY = 0;
}

/** すべてのプリセットに共通の「強い拍でわずかに揺らす」効果 */
export function beatShake(L: LineCtx, amount: number, out: LineFx): void {
  const b = L.beat;
  const since = b.strong ? b.sinceBeat : b.sinceBar;
  const decay = Math.exp(-since * 9);
  if (decay < 0.01) return;
  const a = amount * L.em * L.k * decay;
  const dir = (b.beatNo * 2.399963) % (Math.PI * 2);
  out.shakeX += Math.cos(dir) * a;
  out.shakeY += Math.sin(dir) * a;
}
