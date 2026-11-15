// 画面全体にかかる効果（光・暗転・黒帯・映像そのものの動き）。

import { srand } from '../util';
import { inOutEnvelope, type Effect } from './types';

export const flashcut: Effect = {
  id: 'flashcut',
  name: '閃光カット',
  hint: '出た瞬間、画面全体が白く光る。場面の切り替え、サビの頭に',
  category: 'scene',
  slot: 'accent',
  cost: 1,
  legibility: 3,
  fx(L, out, a) {
    out.screenFlash = Math.max(out.screenFlash, Math.min(0.9, 0.6 * a) * Math.exp(-L.t / 0.12));
  },
};

export const veil: Effect = {
  id: 'veil',
  name: '映像を暗く',
  hint: '映像を暗く落として、文字を主役にする。決めの一言、静かな場面に',
  category: 'scene',
  slot: 'hold',
  cost: 1,
  legibility: 3,
  fx(L, out, a) {
    out.veil = Math.max(out.veil, Math.min(0.8, 0.45 * a) * inOutEnvelope(L, 0.3, 0.35));
  },
};

export const bars: Effect = {
  id: 'bars',
  name: '映画の黒帯',
  hint: '上下に黒い帯が入り、映画のような画面になる。語り、間に',
  category: 'scene',
  slot: 'hold',
  cost: 1,
  legibility: 3,
  fx(L, out, a) {
    out.bars = Math.max(out.bars, Math.min(1.4, a) * inOutEnvelope(L, 0.35, 0.35));
  },
};

export const punch: Effect = {
  id: 'punch',
  name: '映像ごと寄る',
  hint: '拍のたびに、映像がぐっと寄る。サビ、ドロップに',
  category: 'scene',
  slot: 'accent',
  cost: 1,
  legibility: 3,
  fx(L, out, a) {
    const d = Math.exp(-L.beat.sinceBeat * 7) * (L.beat.strong ? 1 : 0.55);
    out.camScale *= 1 + 0.05 * a * d;
  },
};

export const quake: Effect = {
  id: 'quake',
  name: '画面が揺れる',
  hint: '小節の頭で、映像と文字が一緒に揺れる。衝撃、怒りに',
  category: 'scene',
  slot: 'accent',
  cost: 1,
  legibility: 3,
  fx(L, out, a) {
    // 出た瞬間と、小節の頭で揺れる
    let d = Math.exp(-L.t * 8);
    if (L.beat.strong) d = Math.max(d, Math.exp(-L.beat.sinceBeat * 9));
    if (d < 0.01) return;
    const step = Math.floor(L.t * 40);
    const x = srand(L.seed, step + 1801) * 0.1 * a * d;
    const y = srand(L.seed, step + 1802) * 0.1 * a * d;
    out.camX += x;
    out.camY += y;
    out.shakeX += x * L.em;
    out.shakeY += y * L.em;
    // 揺れた分だけ映像の端が見えないよう、わずかに寄せる
    out.camScale *= 1 + 0.035 * Math.min(1.6, a) * d;
  },
};
