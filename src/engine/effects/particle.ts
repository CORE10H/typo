// 粒子（文字を粒に分ける・粒から組み立てる）の効果。
// 文字の絵を小さな升目に切り、升目ごとに飛ばして描く。

import { drawShards } from '../presets/shatter';
import type { CharBox, DrawCtx, LineCtx, Sprite } from '../presets/types';
import { clamp01, ease, hash, srand } from '../util';
import { across, enterLen, exitSpan, type Effect } from './types';

/** 文字数が多い行では升目を粗くして、描く数を抑える（スマホでの重さ対策） */
function grid(L: LineCtx): { gx: number; gy: number } {
  if (L.n > 30) return { gx: 2, gy: 3 };
  if (L.n > 18) return { gx: 3, gy: 4 };
  return { gx: 4, gy: 5 };
}

/**
 * 文字を粒にして描く。
 * @param progress 升目ごとの進み具合（0 = 元の位置、1 = 飛び去って消えた）を返す関数
 */
function drawCells(ctx: DrawCtx, sprite: Sprite, c: CharBox, L: LineCtx, a: number, progress: (id: number) => number): void {
  const { gx: GX, gy: GY } = grid(L);
  const baseAlpha = ctx.globalAlpha;
  const srcW = sprite.canvas.width;
  const srcH = sprite.canvas.height;
  for (let iy = 0; iy < GY; iy++) {
    const y0 = Math.round((srcH * iy) / GY);
    const y1 = Math.round((srcH * (iy + 1)) / GY);
    for (let ix = 0; ix < GX; ix++) {
      const id = iy * GX + ix;
      const p = clamp01(progress(id));
      if (p >= 1) continue;
      const x0 = Math.round((srcW * ix) / GX);
      const x1 = Math.round((srcW * (ix + 1)) / GX);
      const w = (sprite.w * (x1 - x0)) / srcW;
      const h = (sprite.h * (y1 - y0)) / srcH;
      // 升目の中心（文字の中心から見た位置）
      let cx = -sprite.w / 2 + (sprite.w * (x0 + x1)) / 2 / srcW;
      let cy = -sprite.h / 2 + (sprite.h * (y0 + y1)) / 2 / srcH;
      let sc = 1;
      if (p > 0) {
        const e = ease('out', p);
        // おおむね上へ、風に流されるように飛ぶ
        const ang = -Math.PI / 2 + srand(c.seed, id + 1100) * 1.2;
        const dist = (0.5 + hash(c.seed, id + 1200) * 1.9) * L.em * a * e;
        cx += Math.cos(ang) * dist + Math.sin(p * 5 + hash(c.seed, id + 1300) * 6.28) * 0.16 * L.em * p;
        cy += Math.sin(ang) * dist;
        sc = 1 - 0.78 * p;
        ctx.globalAlpha = baseAlpha * (1 - Math.pow(p, 1.5));
      } else {
        ctx.globalAlpha = baseAlpha;
      }
      ctx.drawImage(sprite.canvas, x0, y0, x1 - x0, y1 - y0, cx - (w * sc) / 2, cy - (h * sc) / 2, w * sc + 0.4, h * sc + 0.4);
    }
  }
  ctx.globalAlpha = baseAlpha;
}

export const assemble: Effect = {
  id: 'assemble',
  name: '粒から集まる',
  hint: '漂う粒が集まって文字になる。再生、目覚めに',
  category: 'particle',
  slot: 'enter',
  replaces: 'enter',
  cost: 3,
  legibility: 2,
  draw(ctx, sprite, c, L, _s, a) {
    const len = enterLen(L, 1.1);
    if (L.t >= len) return false;
    // 行の左から右へ、順に形になっていく
    const sweep = across(c, L) * 0.35;
    drawCells(ctx, sprite, c, L, a, (id) => {
      const delay = (sweep + hash(c.seed, id + 1400) * 0.25) * len;
      return 1 - clamp01((L.t - delay) / (len * 0.4));
    });
    return true;
  },
};

export const dissolve: Effect = {
  id: 'dissolve',
  name: '粒になって消える',
  hint: '文字が粒にほどけて、風に流れる。余韻、別れに',
  category: 'particle',
  slot: 'exit',
  replaces: 'exit',
  cost: 3,
  legibility: 2,
  draw(ctx, sprite, c, L, _s, a) {
    const { start, len } = exitSpan(L, 1.1);
    const since = L.t - start;
    if (since <= 0) return false;
    const sweep = across(c, L) * 0.35;
    drawCells(ctx, sprite, c, L, a, (id) => {
      const delay = (sweep + hash(c.seed, id + 1500) * 0.25) * len;
      return (since - delay) / (len * 0.4);
    });
    return true;
  },
};

export const shards: Effect = {
  id: 'shards',
  name: '破片になって散る',
  hint: '文字が砕けて飛び散る。破壊、決別に',
  category: 'particle',
  slot: 'exit',
  replaces: 'exit',
  cost: 2,
  legibility: 2,
  fx(L, out, a) {
    const { start } = exitSpan(L, 0.85);
    const since = L.t - start;
    if (since < 0) return;
    const d = Math.exp(-since * 10);
    const step = Math.floor(since * 40);
    out.shakeX += srand(L.seed, step + 1601) * 0.08 * L.em * a * d;
    out.shakeY += srand(L.seed, step + 1602) * 0.08 * L.em * a * d;
    out.flash = Math.max(out.flash, 0.3 * Math.exp(-since / 0.1));
  },
  draw(ctx, sprite, c, L, _s, a) {
    const { start, len } = exitSpan(L, 0.85);
    const delay = hash(c.seed, 9) * len * 0.25;
    const p = (L.t - start - delay) / (len * 0.75);
    if (p <= 0) return false;
    if (p < 1) drawShards(ctx, sprite, c, L, p, a);
    return true;
  },
};

export const sparks: Effect = {
  id: 'sparks',
  name: '粒子を増やす',
  hint: 'テーマの粒子（火の粉・塵・滴）を多く舞わせる。華やかに',
  category: 'particle',
  slot: 'hold',
  cost: 2,
  legibility: 3,
  fx(_L, out, a) {
    out.particles *= 1 + 1.4 * a;
  },
};
