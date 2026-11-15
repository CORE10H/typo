// 砕散：文字が破片になって飛び散る。壊れる、裂く歌詞に。

import { clamp01, ease, hash, srand } from '../util';
import { beatShake, resetState, type CharBox, type DrawCtx, type LineCtx, type Preset, type Sprite } from './types';

const GRID = 3; // 1文字を 3×3 の破片に分ける

function timing(L: LineCtx) {
  const inDur = Math.min(0.32 * L.sp, L.dur * 0.3);
  const outDur = Math.min(0.85 * L.sp, L.dur * 0.45);
  return { inDur, outDur, outStart: L.dur - outDur };
}

/**
 * 1文字を破片にして描く。p は砕け始めてからの進み具合（0〜1）。
 * 重ねる効果の「破片になって散る」からも使う。
 */
export function drawShards(ctx: DrawCtx, sprite: Sprite, c: CharBox, L: LineCtx, p: number, power: number): void {
  const e = ease('out', p);
  const fade = 1 - Math.pow(p, 1.6);
  const baseAlpha = ctx.globalAlpha;
  const base = ctx.getTransform();
  const cw = sprite.canvas.width / GRID;
  const ch = sprite.canvas.height / GRID;
  const pw = sprite.w / GRID;
  const ph = sprite.h / GRID;

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const id = gy * GRID + gx;
      // 破片の中心（文字の中心から見た位置）
      const px = (gx + 0.5 - GRID / 2) * pw;
      const py = (gy + 0.5 - GRID / 2) * ph;
      const ang = Math.atan2(py, px || 0.001) + srand(c.seed, id + 100) * 0.9;
      const dist = (0.9 + hash(c.seed, id + 200) * 2.4) * L.em * power * e;
      const ox = Math.cos(ang) * dist;
      const oy = Math.sin(ang) * dist + p * p * 1.4 * L.em; // 重力で落ちる
      const rot = srand(c.seed, id + 300) * 5 * e * power;
      const sc = 1 - p * 0.45;

      ctx.setTransform(base);
      ctx.translate(px + ox, py + oy);
      ctx.rotate(rot);
      ctx.scale(sc, sc);
      ctx.globalAlpha = baseAlpha * fade;
      ctx.drawImage(sprite.canvas, gx * cw, gy * ch, cw, ch, -pw / 2, -ph / 2, pw, ph);
    }
  }
  ctx.setTransform(base);
  ctx.globalAlpha = baseAlpha;
}

export const shatter: Preset = {
  id: 'shatter',
  name: '砕散',
  hint: '破片になって飛び散る。壊れる、裂くに',
  kind: 'special',
  sizeFactor: 1,
  particles: 1.3,
  meta: { moods: ['anger', 'chaos', 'lonely'], roles: ['chorus', 'bridge', 'outro'], energy: 0.8, legibility: 2, minDur: 1.6 },

  state(c, L, s) {
    resetState(s);
    const { inDur, outStart } = timing(L);
    const delay = (c.n > 1 ? c.i / (c.n - 1) : 0) * inDur * 0.6;
    const pIn = L.noEnter ? 1 : clamp01((L.t - delay) / inDur);
    if (pIn < 1) {
      const e = ease('outBack', pIn);
      const sc = 0.3 + 0.7 * e;
      s.sx = sc;
      s.sy = sc;
      s.alpha = clamp01(pIn * 2.5);
    }
    // 砕ける直前は、ひびが入るように小刻みに震える
    const tense = clamp01((L.t - (outStart - 0.35)) / 0.35);
    if (tense > 0 && L.t < outStart) {
      const step = Math.floor(L.t * 30);
      s.dx += srand(c.seed, step + 1) * 0.03 * L.em * L.k * tense;
      s.dy += srand(c.seed, step + 2) * 0.03 * L.em * L.k * tense;
    }
  },

  fx(L, out) {
    beatShake(L, 0.014, out);
    if (L.noExit) return;
    const { outStart } = timing(L);
    const since = L.t - outStart;
    if (since >= 0) {
      // 砕けた瞬間の衝撃
      const a = 0.09 * L.em * L.k * Math.exp(-since * 10);
      const step = Math.floor(since * 40);
      out.shakeX += srand(L.seed, step + 51) * a;
      out.shakeY += srand(L.seed, step + 52) * a;
      out.flash = Math.max(out.flash, 0.3 * Math.exp(-since / 0.1));
    }
  },

  draw(ctx, sprite, c, L) {
    if (L.noExit) return false; // 重ねた効果が退場を受け持つ
    const { outStart, outDur } = timing(L);
    const delay = hash(c.seed, 9) * outDur * 0.25;
    const p = (L.t - outStart - delay) / (outDur - outDur * 0.25);
    if (p <= 0) return false; // まだ砕けていない。通常どおり描く
    if (p >= 1) return true;
    drawShards(ctx, sprite, c, L, p, L.k);
    return true;
  },
};
