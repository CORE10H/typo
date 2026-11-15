// グリッチ（デジタルの乱れ）の効果。

import { clamp01, hash, srand } from '../util';
import { enterLen, type Effect } from './types';

/** 色ずれが出る強さ。出てすぐと、小節の頭で強く出て、すぐ収まる（読める時間を残す） */
function burst(t: number, strong: boolean, sinceBeat: number): number {
  // 文字が見え始めてから効くよう、出だしは少し長めに残す
  let e = Math.exp(-Math.max(0, t - 0.15) / 0.28);
  if (strong) e = Math.max(e, 0.75 * Math.exp(-sinceBeat / 0.11));
  return e;
}

export const rgb: Effect = {
  id: 'rgb',
  name: '色ずれ',
  hint: '赤と水色の像が一瞬ずれる。衝撃、サビの頭に',
  category: 'glitch',
  slot: 'accent',
  cost: 2,
  legibility: 2,
  passes(L, a, add) {
    const e = burst(L.t, L.beat.strong, L.beat.sinceBeat);
    if (e < 0.04) return;
    const step = Math.floor(L.t * 30);
    const o = (0.05 + 0.035 * hash(L.seed, step + 310)) * L.em * a * e;
    const alpha = Math.min(0.9, e * 1.4);
    const red = add();
    red.dx = -o;
    red.dy = srand(L.seed, step + 311) * o * 0.25;
    red.tint = 1;
    red.alpha = alpha;
    const cyan = add();
    cyan.dx = o;
    cyan.dy = srand(L.seed, step + 312) * o * 0.25;
    cyan.tint = 2;
    cyan.alpha = alpha;
  },
};

const TEAR_ROWS = 5;

export const tear: Effect = {
  id: 'tear',
  name: '水平ずれ',
  hint: '文字が横に裂けてずれる。不穏、壊れかけに',
  category: 'glitch',
  slot: 'accent',
  cost: 2,
  legibility: 2,
  draw(ctx, sprite, c, L, _s, a) {
    const step = Math.floor(L.t * 14);
    // 出た直後と、ときどき不意に起きる
    const active = L.t < 0.16 || hash(L.seed, step + 400) < 0.14;
    if (!active) return false;
    const srcH = sprite.canvas.height;
    const row = Math.round(c.y / L.em);
    for (let r = 0; r < TEAR_ROWS; r++) {
      const y0 = Math.round((srcH * r) / TEAR_ROWS);
      const y1 = Math.round((srcH * (r + 1)) / TEAR_ROWS);
      // 同じ高さの帯は、どの文字でも同じだけずれる（行が帯ごと裂けて見える）
      const key = step * 37 + (r + row * 8) * 5;
      const moved = hash(L.seed, key + 410) < 0.6;
      const off = moved ? srand(L.seed, key + 420) * 0.3 * L.em * a : 0;
      ctx.drawImage(
        sprite.canvas,
        0,
        y0,
        sprite.canvas.width,
        y1 - y0,
        -sprite.w / 2 + off,
        -sprite.h / 2 + (sprite.h * y0) / srcH,
        sprite.w,
        (sprite.h * (y1 - y0)) / srcH,
      );
    }
    return true;
  },
};

export const flicker: Effect = {
  id: 'flicker',
  name: '明滅',
  hint: '信号が途切れるように、ちらつく。不安、狂気に',
  category: 'glitch',
  slot: 'hold',
  cost: 1,
  legibility: 2,
  state(c, L, s, a) {
    const step = Math.floor(L.t * 20);
    if (hash(L.seed, step + 700) < 0.07 * a) {
      s.alpha *= 0.12; // 行全体が一瞬消える
    } else if (hash(c.seed, step + 701) < 0.06 * a) {
      s.alpha *= 0.3; // 1文字だけ欠ける
    }
    if (hash(L.seed, step + 702) < 0.09 * a) s.dx += srand(L.seed, step + 703) * 0.14 * L.em * a;
  },
};

export const ghost: Effect = {
  id: 'ghost',
  name: '残像',
  hint: '動いた跡が尾を引く。速い動き、陶酔に',
  category: 'glitch',
  slot: 'hold',
  cost: 2,
  legibility: 3,
  passes(_L, a, add) {
    for (let k = 1; k <= 3; k++) {
      const p = add();
      p.dt = -0.055 * k * a;
      p.alpha = 0.42 / k;
      p.blur = 0.12 * k;
    }
  },
};

export const scramble: Effect = {
  id: 'scramble',
  name: '文字化け',
  hint: 'でたらめな文字が、正しい文字へ落ち着く。暴露、解読に',
  category: 'glitch',
  slot: 'enter',
  replaces: 'enter',
  cost: 1,
  legibility: 2,
  draw(ctx, sprite, c, L, _s, a, tools) {
    const len = enterLen(L, 0.9 * Math.min(1.6, a));
    const settle = len * (0.25 + 0.75 * (c.n > 1 ? c.i / (c.n - 1) : 0));
    if (L.t >= settle) return false;
    const baseAlpha = ctx.globalAlpha;
    ctx.globalAlpha = baseAlpha * clamp01(0.35 + (L.t / Math.max(0.05, settle)) * 0.65);
    const step = Math.floor(L.t * 16);
    const pool = tools.pool;
    const ch = pool.length > 1 ? pool[Math.floor(hash(c.seed, step + 800) * pool.length) % pool.length] : c.ch;
    const g = ch === c.ch ? sprite : tools.glyph(ch);
    ctx.drawImage(g.canvas, -g.w / 2, -g.h / 2, g.w, g.h);
    ctx.globalAlpha = baseAlpha;
    return true;
  },
};
