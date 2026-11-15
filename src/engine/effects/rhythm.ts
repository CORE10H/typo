// リズム（拍に合わせる）の効果。
// 今は BPM の目盛りだけを使う（音そのものの解析はしていない）。
// 小節の頭をキック、2拍目・4拍目をスネアに見立てている。

import { srand } from '../util';
import type { Effect } from './types';

export const beatpop: Effect = {
  id: 'beatpop',
  name: '拍で弾む',
  hint: '拍のたびに、文字がわずかに膨らむ。ノリのよい場面に',
  category: 'rhythm',
  slot: 'hold',
  cost: 1,
  legibility: 3,
  state(_c, L, s, a) {
    const sc = 1 + 0.11 * a * Math.exp(-L.beat.sinceBeat * 8) * (L.beat.strong ? 1 : 0.65);
    s.sx *= sc;
    s.sy *= sc;
  },
};

export const backflash: Effect = {
  id: 'backflash',
  name: '裏拍の光',
  hint: '2拍目と4拍目（スネアの位置）で光る。サビの盛り上がりに',
  category: 'rhythm',
  slot: 'accent',
  cost: 1,
  legibility: 3,
  fx(L, out, a) {
    if (L.beat.inBar % 2 !== 1) return;
    out.flash = Math.max(out.flash, Math.min(0.8, 0.45 * a) * Math.exp(-L.beat.sinceBeat / 0.1));
  },
};

export const barhit: Effect = {
  id: 'barhit',
  name: '小節頭の衝撃',
  hint: '小節の頭（キックの位置）で、行がぐっと寄って揺れる',
  category: 'rhythm',
  slot: 'accent',
  cost: 1,
  legibility: 3,
  fx(L, out, a) {
    if (!L.beat.strong) return;
    const d = Math.exp(-L.beat.sinceBeat * 9);
    if (d < 0.01) return;
    out.scale *= 1 + 0.07 * a * d;
    const step = Math.floor(L.beat.sinceBeat * 40) + L.beat.beatNo * 64;
    out.shakeX += srand(L.seed, step + 901) * 0.05 * L.em * a * d;
    out.shakeY += srand(L.seed, step + 902) * 0.05 * L.em * a * d;
  },
};

export const stutter: Effect = {
  id: 'stutter',
  name: '連打',
  hint: '出だしで、細かく点滅しながら刻む。焦り、畳みかけに',
  category: 'rhythm',
  slot: 'accent',
  cost: 1,
  legibility: 2,
  state(_c, L, s, a) {
    const span = Math.min(L.dur * 0.4, L.beat.beatLen * Math.min(2, a + 0.5));
    if (L.t >= span) return;
    const step = Math.floor(L.t / (L.beat.beatLen / 4)); // 16分音符きざみ
    if (step % 2 === 1) s.alpha *= 0.12;
    s.dx += (step % 4) * 0.035 * L.em * a * (1 - L.t / span);
  },
};
