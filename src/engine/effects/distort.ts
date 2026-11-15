// 歪み（文字の形を変える）の効果。文字の絵を縦に細く切り、切れ端ごとにずらして描く。

import { clamp01, hash } from '../util';
import { exitSpan, type Effect } from './types';

const STRIPS = 5;

export const wave: Effect = {
  id: 'wave',
  name: '波打ち',
  hint: '文字が水面のように揺らぐ。陶酔、夢、不安に',
  category: 'distort',
  slot: 'hold',
  cost: 2,
  legibility: 2,
  draw(ctx, sprite, c, L, _s, a) {
    const srcW = sprite.canvas.width;
    const amp = 0.13 * L.em * a;
    for (let i = 0; i < STRIPS; i++) {
      const x0 = Math.round((srcW * i) / STRIPS);
      const x1 = Math.round((srcW * (i + 1)) / STRIPS);
      const dx = (sprite.w * x0) / srcW;
      const dw = (sprite.w * (x1 - x0)) / srcW;
      // 行の左から右へ、波が流れていく
      const phase = L.t * 3.4 + ((c.x - sprite.w / 2 + dx) / L.em) * 1.1;
      const dy = Math.sin(phase) * amp;
      ctx.drawImage(sprite.canvas, x0, 0, x1 - x0, sprite.canvas.height, -sprite.w / 2 + dx, -sprite.h / 2 + dy, dw + 0.6, sprite.h);
    }
    return true;
  },
};

export const melt: Effect = {
  id: 'melt',
  name: '溶け落ち',
  hint: '文字が下へ垂れて溶ける。甘さ、喪失、終わりに',
  category: 'distort',
  slot: 'exit',
  replaces: 'exit',
  cost: 2,
  legibility: 2,
  draw(ctx, sprite, c, L, _s, a) {
    const { start, len } = exitSpan(L, 1.2);
    const since = L.t - start;
    if (since <= 0) return false;
    const srcW = sprite.canvas.width;
    const baseAlpha = ctx.globalAlpha;
    for (let i = 0; i < STRIPS; i++) {
      const delay = hash(c.seed, i + 500) * len * 0.35;
      const p = clamp01((since - delay) / (len * 0.65));
      const x0 = Math.round((srcW * i) / STRIPS);
      const x1 = Math.round((srcW * (i + 1)) / STRIPS);
      const dx = (sprite.w * x0) / srcW;
      const dw = (sprite.w * (x1 - x0)) / srcW;
      const stretch = 1 + p * p * (0.8 + hash(c.seed, i + 510) * 2.4) * a;
      ctx.globalAlpha = baseAlpha * (1 - Math.pow(p, 1.8));
      if (ctx.globalAlpha <= 0.004) continue;
      // 上の端を留めたまま、下へ伸びる
      ctx.drawImage(sprite.canvas, x0, 0, x1 - x0, sprite.canvas.height, -sprite.w / 2 + dx, -sprite.h / 2, dw + 0.6, sprite.h * stretch);
    }
    ctx.globalAlpha = baseAlpha;
    return true;
  },
};
