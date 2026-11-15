// 奥行き（疑似3D・カメラの動き）の効果。本物の3Dは使わず、大きさ・ぼかし・濃さの差で奥行きを見せる。

import { hash } from '../util';
import type { Effect } from './types';

const TUNNEL_COPIES = 5;

export const tunnel: Effect = {
  id: 'tunnel',
  name: '文字のトンネル',
  hint: '同じ言葉が次々にこちらへ迫ってくる。没入、間奏に',
  category: 'depth',
  slot: 'hold',
  cost: 3,
  legibility: 2,
  passes(L, a, add) {
    const speed = 0.42 / L.sp;
    for (let k = 0; k < TUNNEL_COPIES; k++) {
      const x = L.t * speed + k / TUNNEL_COPIES;
      const ph = x - Math.floor(x);
      // 本体と同じ大きさから始まり、こちらへ迫りながら大きく・薄くなる
      const p = add();
      p.scale = 1 + Math.pow(ph, 1.4) * 2.4 * Math.min(1.5, a);
      p.alpha = Math.pow(1 - ph, 1.3) * 0.5 * Math.min(1, ph * 8);
      p.blur = ph > 0.6 ? 0.5 : ph > 0.3 ? 0.25 : 0;
    }
  },
};

export const zoom: Effect = {
  id: 'zoom',
  name: 'ゆっくり寄る',
  hint: 'カメラが近づくように、少しずつ大きくなる。緊張、告白に',
  category: 'depth',
  slot: 'hold',
  cost: 1,
  legibility: 3,
  fx(L, out, a) {
    out.scale *= 1 + 0.13 * a * (L.t / L.dur);
  },
};

export const tilt: Effect = {
  id: 'tilt',
  name: '傾く',
  hint: '画面がゆっくり傾いていく。不安定、酔いに',
  category: 'depth',
  slot: 'hold',
  cost: 1,
  legibility: 3,
  fx(L, out, a) {
    const dir = hash(L.seed, 601) < 0.5 ? -1 : 1;
    out.rot += (L.t / L.dur - 0.5) * 0.09 * a * dir;
  },
};
