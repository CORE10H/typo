// 文字組み（並べ方そのものを演出にする）の効果。

import { ease, hash } from '../util';
import { enterLen, inOutEnvelope, type Effect } from './types';

export const tracking: Effect = {
  id: 'tracking',
  name: '字間が開く',
  hint: '文字の間隔が、ゆっくり広がっていく。余韻、静けさに',
  category: 'type',
  slot: 'hold',
  cost: 1,
  legibility: 3,
  state(c, L, s, a) {
    s.dx += c.x * 0.13 * a * (L.t / L.dur);
  },
};

const ECHO_COPIES = 6;

export const echo: Effect = {
  id: 'echo',
  name: '増殖',
  hint: '同じ言葉が周りに増え、中心へ迫ってくる。執着、反復に',
  category: 'type',
  slot: 'hold',
  cost: 3,
  legibility: 2,
  passes(L, a, add) {
    const prog = L.t / L.dur;
    const env = inOutEnvelope(L, 0.5, 0.35);
    for (let k = 0; k < ECHO_COPIES; k++) {
      // 写しが1つずつ順に現れる
      const born = (k / ECHO_COPIES) * 0.45;
      if (prog < born) continue;
      const ang = (k / ECHO_COPIES) * Math.PI * 2 + hash(L.seed, k + 1700) * 0.9;
      const r = (2.6 - 1.5 * prog) * L.em * (0.8 + 0.4 * hash(L.seed, k + 1710));
      const p = add();
      p.dx = Math.cos(ang) * r * 1.9;
      p.dy = Math.sin(ang) * r * 0.85;
      p.scale = 0.42 + 0.2 * hash(L.seed, k + 1720);
      p.rot = (hash(L.seed, k + 1730) - 0.5) * 0.25;
      p.alpha = Math.min(0.55, 0.3 * a) * env * Math.min(1, (prog - born) * 6);
      p.blur = 0.2;
    }
  },
};

export const mirror: Effect = {
  id: 'mirror',
  name: '映り込み',
  hint: '文字の下に、水面のような映り込みが出る。耽美、二面性に',
  category: 'type',
  slot: 'hold',
  cost: 2,
  legibility: 3,
  passes(L, a, add) {
    const p = add();
    p.flipY = true;
    // 文字のすぐ下に、上下逆さの像を置く
    p.dy = L.height - L.em * 0.23;
    p.alpha = Math.min(0.5, 0.24 * a);
    p.blur = 0.3;
  },
};

export const reveal: Effect = {
  id: 'reveal',
  name: '幕が開く',
  hint: '左から右へ、幕を引くように現れる。告白、導入に',
  category: 'type',
  slot: 'enter',
  replaces: 'enter',
  cost: 1,
  legibility: 3,
  fx(L, out, a) {
    const len = enterLen(L, 0.8 / Math.max(0.5, a));
    out.reveal = Math.min(out.reveal, ease('inOut', L.t / len));
  },
};
