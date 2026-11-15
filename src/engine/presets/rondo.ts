// 輪舞：文字が円を描いて回りながら、行の位置に収まる。ワルツ、踊る歌詞に。

import { clamp01, ease } from '../util';
import { beatShake, resetState, type Preset } from './types';

function circle(c: { i: number; n: number; x: number; y: number }, L: { width: number; em: number; k: number }, spin: number) {
  const radius = Math.max(L.width * 0.3, L.em * 1.8) * (0.7 + 0.3 * L.k);
  const angle = (c.i / Math.max(1, c.n)) * Math.PI * 2 + spin;
  // 楕円にして、奥（上）は小さく手前（下）は大きく見せる
  const depth = Math.sin(angle);
  return { x: Math.cos(angle) * radius, y: depth * radius * 0.42, scale: 1 + depth * 0.28, angle };
}

export const rondo: Preset = {
  id: 'rondo',
  name: '輪舞',
  hint: '文字が円を描いて回る。ワルツ、踊るに',
  kind: 'special',
  sizeFactor: 1,
  particles: 1.1,
  meta: { moods: ['excite', 'sensual'], roles: ['chorus', 'verse', 'bridge'], energy: 0.6, legibility: 2, minDur: 1.8 },

  state(c, L, s) {
    resetState(s);
    const inDur = Math.min(1.2 * L.sp, L.dur * 0.45);
    const outDur = Math.min(0.9 * L.sp, L.dur * 0.35);
    const pIn = L.noEnter ? 1 : clamp01(L.t / inDur);
    const pOut = L.noExit ? 0 : clamp01((L.t - (L.dur - outDur)) / outDur);

    if (pIn < 1) {
      const e = ease('inOut', pIn);
      const p = circle(c, L, (1 - e) * Math.PI * 2.5 * L.k);
      const mix = Math.pow(e, 1.6);
      s.dx = (p.x - c.x) * (1 - mix);
      s.dy = (p.y - c.y) * (1 - mix);
      const sc = 1 + (p.scale - 1) * (1 - mix);
      s.sx = sc;
      s.sy = sc;
      s.rot = Math.sin(p.angle) * 0.5 * (1 - mix);
      s.alpha = clamp01(pIn * 4 - c.i / Math.max(1, c.n));
    } else if (pOut > 0) {
      const e = ease('in', pOut);
      const p = circle(c, L, -e * Math.PI * 2 * L.k);
      s.dx = (p.x - c.x) * e;
      s.dy = (p.y - c.y) * e;
      const sc = (1 + (p.scale - 1) * e) * (1 - e * 0.5);
      s.sx = sc;
      s.sy = sc;
      s.rot = -Math.sin(p.angle) * 0.5 * e;
      s.alpha = 1 - e * e;
      s.blur = e * 0.4;
    } else {
      // 出ている間は、小節に合わせてゆったり揺れる
      const ph = (L.beat.sinceBar / L.beat.barLen) * Math.PI * 2 + c.i * 0.55;
      s.dy = Math.sin(ph) * 0.07 * L.em * L.k;
      s.rot = Math.sin(ph + 1) * 0.045 * L.k;
    }
  },

  fx(L, out) {
    beatShake(L, 0.014, out);
  },
};
