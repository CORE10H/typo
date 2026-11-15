// 回転扉：行全体が、縦の軸を中心に扉のように回って現れる。奥行きのある見せ方。
// 本物の3Dは使わず、遠近（手前は大きく、奥は小さく）を計算して疑似的に見せる。

import { clamp01, ease } from '../util';
import { beatShake, resetState, type CharBox, type CharState, type LineCtx, type Preset } from './types';

/** 行を角度 theta（ラジアン）だけ縦軸まわりに回したときの、1文字の見え方 */
function turn(c: CharBox, L: LineCtx, theta: number, s: CharState): void {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // 視点までの距離。小さいほど遠近が強く出る
  const dist = Math.max(L.width, L.em * 6) * 1.4;
  const z = c.x * sin; // 奥行き（正が奥）
  const persp = dist / (dist + z);
  s.dx = c.x * cos * persp - c.x;
  s.dy = c.y * persp - c.y;
  s.sx = Math.max(0.02, Math.abs(cos)) * persp;
  s.sy = persp;
}

export const flip: Preset = {
  id: 'flip',
  name: '回転扉',
  hint: '行が扉のように回って現れる。場面の切り替え、反転に',
  kind: 'special',
  sizeFactor: 1,
  particles: 1,
  meta: { moods: ['secret', 'chaos', 'excite'], roles: ['verse', 'bridge', 'pre'], energy: 0.55, legibility: 3, minDur: 1.4 },

  state(c, L, s) {
    resetState(s);
    const inDur = Math.min(0.7 * L.sp, L.dur * 0.4);
    const outDur = Math.min(0.55 * L.sp, L.dur * 0.35);
    const pIn = L.noEnter ? 1 : clamp01(L.t / inDur);
    const pOut = L.noExit ? 0 : clamp01((L.t - (L.dur - outDur)) / outDur);
    const quarter = (Math.PI / 2) * Math.min(1.25, 0.7 + 0.3 * L.k);

    if (pIn < 1) {
      const e = 1 - ease('out', pIn);
      turn(c, L, -quarter * e, s);
      s.alpha = clamp01(pIn * 3);
      s.blur = e * 0.35;
    } else if (pOut > 0) {
      const e = ease('in', pOut);
      turn(c, L, quarter * e, s);
      s.alpha = 1 - Math.pow(e, 2.5);
      s.blur = e * 0.35;
    } else {
      // 出ている間は、ごくわずかに揺れ続ける（止まった絵にしない）
      turn(c, L, Math.sin(L.t * 0.9) * 0.07 * L.k, s);
    }
  },

  fx(L, out) {
    beatShake(L, 0.014, out);
  },
};
