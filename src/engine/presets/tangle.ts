// 絡まり：行が中心へ渦を巻いて巻き取られる。縛る、罠の歌詞に。

import { clamp01, ease } from '../util';
import { beatShake, resetState, type CharBox, type CharState, type LineCtx, type Preset } from './types';

/** e = 0 で元の位置、e = 1 で中心に巻き取られた状態 */
function wind(c: CharBox, L: LineCtx, e: number, turn: number, s: CharState): void {
  const r0 = Math.hypot(c.x, c.y);
  const a0 = Math.atan2(c.y, c.x);
  const r = r0 * (1 - e);
  const a = a0 + e * turn * (1 + (r0 / Math.max(1, L.width)) * 1.5);
  s.dx = Math.cos(a) * r - c.x;
  s.dy = Math.sin(a) * r * 0.85 - c.y;
  const sc = 1 - e * 0.8;
  s.sx = sc;
  s.sy = sc;
  s.rot = e * turn;
}

export const tangle: Preset = {
  id: 'tangle',
  name: '絡まり',
  hint: '行が中心へ巻き取られる。縛る、罠に',
  kind: 'special',
  sizeFactor: 1,
  particles: 1,

  state(c, L, s) {
    resetState(s);
    const inDur = Math.min(0.9 * L.sp, L.dur * 0.4);
    const outDur = Math.min(1.0 * L.sp, L.dur * 0.4);
    const stagger = (c.n > 1 ? Math.abs(c.i / (c.n - 1) - 0.5) * 2 : 0) * 0.35;
    const pIn = clamp01(L.t / inDur - stagger * 0.5);
    const pOut = clamp01((L.t - (L.dur - outDur)) / outDur - (0.35 - stagger) * 0.5);
    const turn = Math.PI * 2.2 * L.k;

    if (pIn < 1) {
      const e = 1 - ease('out', pIn);
      wind(c, L, e, -turn, s);
      s.alpha = clamp01(pIn * 3);
      s.blur = e * 0.5;
    } else if (pOut > 0) {
      const e = ease('in', pOut);
      wind(c, L, e, turn, s);
      s.alpha = 1 - Math.pow(e, 3);
      s.blur = e * 0.5;
    } else {
      // 出ている間は、締め付けられるようにわずかに中心へ寄る
      const squeeze = Math.sin(L.t * 1.6 + c.i * 0.4) * 0.012 * L.k;
      s.dx = -c.x * squeeze;
      s.rot = squeeze * 2;
    }
  },

  fx(L, out) {
    beatShake(L, 0.014, out);
  },
};
