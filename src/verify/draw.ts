// 文字を描く関数。プレビューと書き出しで必ず同じものを使う（CLAUDE.md の決まり）。
// 段階1では、固定の日本語の文字と経過秒数を描くだけ。

import type { Layout } from '../layout';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const TEST_TEXT = '歌詞テスト：甘い夢が降る夜に';
const FONT_FAMILY = '"Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';

/** 縁取り付きの文字を1行描く */
function drawOutlinedText(ctx: Ctx2D, text: string, x: number, y: number, fontSize: number): void {
  ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, fontSize * 0.18);
  ctx.strokeStyle = '#000000';
  ctx.fillStyle = '#ffffff';
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

/**
 * 映像の上に重ねる文字を描く。
 * @param ctx 描き先
 * @param layout 出力の寸法と、映像を置いた場所
 * @param timeSec 動画の先頭からの経過秒数
 */
export function drawOverlay(ctx: Ctx2D, layout: Layout, timeSec: number): void {
  const v = layout.video;
  const centerX = v.x + v.width / 2;
  const fontSize = Math.round(v.height * 0.075);

  ctx.save();
  drawOutlinedText(ctx, TEST_TEXT, centerX, v.y + v.height * 0.7, fontSize);
  drawOutlinedText(ctx, `${timeSec.toFixed(2)} 秒`, centerX, v.y + v.height * 0.84, fontSize);
  ctx.restore();
}
