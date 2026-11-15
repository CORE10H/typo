// 基本型の動き。文字ごとの「登場・保持・退場」を、
// 移動・拡大・回転・ぼかし・透明度・時間差の組み合わせ（データ）で決める。
// プログラムを書かずにデータだけで新しい動きを足せる（仕様書6章「素材パック」）。

import { clamp01, ease, hash, lerp, srand, type EaseName } from '../util';
import { beatShake, resetState, type CharBox, type CharState, type LineCtx, type LineFx, type Meta, type Preset } from './types';

/** 登場の出発点、または退場の行き先 */
export interface Xf {
  /** 行が進む向きへのずれ（文字の大きさを1とする） */
  du?: number;
  /** 行と直角の向きへのずれ（下が正） */
  dv?: number;
  scale?: number;
  scaleU?: number;
  scaleV?: number;
  /** 回転（度） */
  rot?: number;
  alpha?: number;
  /** ぼかし 0〜1 */
  blur?: number;
  /** 文字ごとのばらつき */
  randDu?: number;
  randDv?: number;
  randRot?: number;
}

export interface PhaseDef {
  xf: Xf;
  /** 1文字が動き終えるまでの秒数（速さ 0.5 のとき） */
  dur: number;
  /** 文字ごとの時間差（0 = 全部同時、1 = 順番にきっちりずらす） */
  stagger: number;
  ease: EaseName;
  order?: 'forward' | 'reverse' | 'center' | 'random';
}

export interface BasicPresetDef {
  id: string;
  name: string;
  hint: string;
  sizeFactor?: number;
  particles?: number;
  /** 自動提案のための手がかり（向いている気分・曲の場所・派手さ） */
  meta: Meta;
  /** 拡大縮小の基準を上端にする（滴りなど） */
  anchorTop?: boolean;
  enter: PhaseDef;
  exit: PhaseDef;
  hold?: {
    /** 拍に合わせて脈打つ大きさ */
    pulse?: number;
    /** ゆらめき */
    sway?: { du?: number; dv?: number; rot?: number; freq: number };
    /** 細かい震え */
    jitter?: { amount: number; rot?: number; freq: number };
    /** ゆっくり流れる（1秒あたり） */
    drift?: { du?: number; dv?: number };
    /** ちらつき 0〜1 */
    flicker?: number;
  };
  /** 強い拍での揺れ（共通の揺れに上乗せ） */
  shake?: number;
  /** 着地の瞬間の衝撃 */
  impact?: number;
  /** 光のフラッシュ。start = 出た瞬間、land = 着地の瞬間 */
  flash?: { amount: number; at: 'start' | 'land' };
}

const DEG = Math.PI / 180;
/** すべてのプリセットに入れる、強い拍での小さな揺れ */
const BASE_SHAKE = 0.014;

function orderFrac(order: PhaseDef['order'], c: CharBox): number {
  if (c.n <= 1) return 0;
  const f = c.i / (c.n - 1);
  switch (order) {
    case 'reverse':
      return 1 - f;
    case 'center':
      return Math.abs(f - 0.5) * 2;
    case 'random':
      return hash(c.seed, 77);
    default:
      return f;
  }
}

/** 登場・退場の1文字ぶんの時間 */
function phaseDur(p: PhaseDef, L: LineCtx, share: number): number {
  return Math.max(0.04, Math.min(p.dur * L.sp, (L.dur * share) / (1 + p.stagger)));
}

function applyXf(xf: Xf, q: number, c: CharBox, L: LineCtx, s: CharState): void {
  if (q <= 0) return;
  const em = L.em;
  const k = L.k;
  s.dx += ((xf.du ?? 0) + (xf.randDu ?? 0) * srand(c.seed, 1)) * em * k * q;
  s.dy += ((xf.dv ?? 0) + (xf.randDv ?? 0) * srand(c.seed, 2)) * em * k * q;
  s.rot += ((xf.rot ?? 0) + (xf.randRot ?? 0) * srand(c.seed, 3)) * DEG * k * q;
  const sc = (v: number | undefined): number => {
    if (v === undefined) return 1;
    return Math.max(0.02, lerp(1, 1 + (v - 1) * k, q));
  };
  const all = sc(xf.scale);
  s.sx *= all * sc(xf.scaleU);
  s.sy *= all * sc(xf.scaleV);
  if (xf.alpha !== undefined) s.alpha *= lerp(1, xf.alpha, q);
  if (xf.blur !== undefined) s.blur = Math.max(s.blur, xf.blur * q);
}

export function makeBasicPreset(def: BasicPresetDef): Preset {
  return {
    id: def.id,
    name: def.name,
    hint: def.hint,
    kind: 'basic',
    sizeFactor: def.sizeFactor ?? 1,
    particles: def.particles ?? 1,
    meta: def.meta,

    state(c, L, s) {
      resetState(s);
      if (def.anchorTop) s.originY = -0.5;

      // 登場
      const inDur = phaseDur(def.enter, L, 0.45);
      const inDelay = orderFrac(def.enter.order, c) * def.enter.stagger * inDur;
      // 重ねた効果が登場・退場を受け持つときは、こちらの動きを省く
      const pIn = L.noEnter ? 1 : (L.t - inDelay) / inDur;
      if (pIn < 1) applyXf(def.enter.xf, 1 - ease(def.enter.ease, pIn), c, L, s);
      if (pIn <= 0 && def.enter.xf.alpha === undefined) s.alpha = 0;

      // 退場
      const outDur = phaseDur(def.exit, L, 0.4);
      const outStart = L.dur - outDur * (1 + def.exit.stagger);
      const outDelay = orderFrac(def.exit.order, c) * def.exit.stagger * outDur;
      const pOut = L.noExit ? 0 : (L.t - outStart - outDelay) / outDur;
      if (pOut > 0) applyXf(def.exit.xf, ease(def.exit.ease, pOut), c, L, s);
      if (pOut >= 1 && def.exit.xf.alpha === undefined) s.alpha = 0;

      // 保持（出ている間ずっと続く動き）
      const h = def.hold;
      if (h) {
        const present = clamp01(pIn) * (1 - clamp01(pOut));
        if (h.pulse) {
          const beat = Math.exp(-L.beat.sinceBeat * 7) * (L.beat.strong ? 1 : 0.6);
          const sc = 1 + h.pulse * L.k * beat * present;
          s.sx *= sc;
          s.sy *= sc;
        }
        if (h.sway) {
          const ph = L.t * h.sway.freq * Math.PI * 2 + c.i * 0.7 + hash(c.seed, 5) * 6.28;
          s.dx += Math.sin(ph * 0.8) * (h.sway.du ?? 0) * L.em * L.k;
          s.dy += Math.sin(ph) * (h.sway.dv ?? 0) * L.em * L.k;
          s.rot += Math.sin(ph * 1.1) * (h.sway.rot ?? 0) * DEG * L.k;
        }
        if (h.jitter) {
          const step = Math.floor(L.t * h.jitter.freq);
          const boost = 1 + clamp01(pOut) * 2;
          s.dx += srand(c.seed, step * 3 + 11) * h.jitter.amount * L.em * L.k * boost;
          s.dy += srand(c.seed, step * 3 + 12) * h.jitter.amount * L.em * L.k * boost;
          s.rot += srand(c.seed, step * 3 + 13) * (h.jitter.rot ?? 0) * DEG * L.k * boost;
        }
        if (h.drift) {
          s.dx += (h.drift.du ?? 0) * L.t * L.em * L.k;
          s.dy += (h.drift.dv ?? 0) * L.t * L.em * L.k;
        }
        if (h.flicker) {
          const step = Math.floor(L.t * 24);
          if (hash(c.seed, step + 900) < h.flicker * (0.25 + (1 - clamp01(pIn)) * 0.75)) s.alpha *= 0.25;
        }
      }
    },

    fx(L: LineCtx, out: LineFx) {
      beatShake(L, BASE_SHAKE + (def.shake ?? 0), out);
      const inDur = phaseDur(def.enter, L, 0.45);
      if (def.impact) {
        const since = L.t - inDur * 0.9;
        if (since >= 0) {
          const a = def.impact * L.em * L.k * Math.exp(-since * 11);
          const step = Math.floor(since * 40);
          out.shakeX += srand(L.seed, step + 31) * a;
          out.shakeY += srand(L.seed, step + 32) * a;
        }
      }
      if (def.flash) {
        const since = def.flash.at === 'land' ? L.t - inDur * 0.85 : L.t;
        if (since >= 0) out.flash = Math.max(out.flash, def.flash.amount * Math.exp(-since / 0.16));
      }
    },
  };
}

/** 基本型で表せる動き。データを1件足すだけで、新しい動きが増える */
export const BASIC_PRESET_DEFS: BasicPresetDef[] = [
  {
    id: 'fall',
    name: '降下',
    hint: '上から1文字ずつ舞い降りる。静かな歌い出しに',
    meta: { moods: ['calm', 'lonely', 'hope'], roles: ['intro', 'verse'], energy: 0.3, legibility: 3 },
    enter: {
      xf: { dv: -1.5, scale: 1.25, alpha: 0, rot: 0, randRot: 28, randDu: 0.25 },
      dur: 0.7,
      stagger: 1.1,
      ease: 'outBack',
    },
    exit: { xf: { dv: 0.45, alpha: 0, scale: 0.92, blur: 0.4 }, dur: 0.45, stagger: 0.5, ease: 'in' },
    hold: { sway: { dv: 0.025, rot: 1.2, freq: 0.35 } },
  },
  {
    id: 'drip',
    name: '滴り',
    hint: '文字が下へ伸びて溶ける。蜜、液体、甘さに',
    meta: { moods: ['sensual', 'lonely'], roles: ['verse', 'bridge', 'outro'], energy: 0.35, legibility: 2, minDur: 1.4 },
    anchorTop: true,
    particles: 1.4,
    enter: { xf: { dv: -0.35, scaleV: 0.35, alpha: 0 }, dur: 0.6, stagger: 0.7, ease: 'out' },
    exit: {
      xf: { scaleV: 3.2, scaleU: 0.78, dv: 0.5, alpha: 0, blur: 0.5, randDv: 0.5 },
      dur: 0.9,
      stagger: 0.9,
      ease: 'in',
      order: 'random',
    },
    hold: { sway: { dv: 0.02, freq: 0.25 } },
  },
  {
    id: 'pulse',
    name: '鼓動',
    hint: '拍に合わせて脈打つ。感情の高まりに',
    meta: { moods: ['excite', 'sensual', 'obsess'], roles: ['pre', 'chorus', 'verse'], energy: 0.55, legibility: 3 },
    enter: { xf: { scale: 0.45, alpha: 0 }, dur: 0.4, stagger: 0.25, ease: 'outBack', order: 'center' },
    exit: { xf: { scale: 1.25, alpha: 0, blur: 0.35 }, dur: 0.4, stagger: 0.1, ease: 'in' },
    hold: { pulse: 0.16 },
    shake: 0.02,
  },
  {
    id: 'impact',
    name: '打撃',
    hint: '奥から手前へ叩きつける。サビの頭、強い言葉に',
    meta: { moods: ['anger', 'excite'], roles: ['chorus', 'pre'], energy: 0.85, legibility: 3 },
    particles: 1.3,
    enter: { xf: { scale: 4.2, alpha: 0, blur: 0.6, randRot: 10 }, dur: 0.28, stagger: 0.25, ease: 'in' },
    exit: { xf: { scale: 1.35, alpha: 0, blur: 0.3 }, dur: 0.3, stagger: 0, ease: 'in' },
    shake: 0.03,
    impact: 0.16,
    flash: { amount: 0.55, at: 'land' },
  },
  {
    id: 'blur',
    name: '滲み',
    hint: 'ぼけた状態から浮かび上がる。染み込む、記憶に',
    meta: { moods: ['lonely', 'calm', 'secret'], roles: ['intro', 'verse', 'bridge', 'outro'], energy: 0.2, legibility: 3, minDur: 1.6 },
    enter: { xf: { blur: 1, alpha: 0, scale: 1.12 }, dur: 1.1, stagger: 0.35, ease: 'out' },
    exit: { xf: { blur: 1, alpha: 0, scale: 1.08 }, dur: 0.9, stagger: 0.3, ease: 'in' },
  },
  {
    id: 'whisper',
    name: '囁き',
    hint: '小さく現れて消える。静かな行、独白に',
    meta: { moods: ['secret', 'lonely', 'calm'], roles: ['intro', 'verse', 'bridge'], energy: 0.1, legibility: 2, minDur: 1.4 },
    sizeFactor: 0.68,
    particles: 0.4,
    enter: { xf: { alpha: 0, scale: 0.86, dv: 0.12 }, dur: 0.9, stagger: 0.5, ease: 'out' },
    exit: { xf: { alpha: 0, dv: -0.1, blur: 0.3 }, dur: 0.8, stagger: 0.4, ease: 'in' },
    hold: { drift: { dv: -0.012 } },
  },
  {
    id: 'tremble',
    name: '震え',
    hint: '細かく揺れて歪む。狂気、恐怖に',
    meta: { moods: ['fear', 'chaos'], roles: ['verse', 'pre', 'bridge'], energy: 0.6, legibility: 2 },
    enter: { xf: { alpha: 0, scaleU: 1.5, randDu: 0.5, randDv: 0.3 }, dur: 0.3, stagger: 0.4, ease: 'out', order: 'random' },
    exit: { xf: { alpha: 0, scaleV: 1.7, scaleU: 0.7, randDu: 0.7, randDv: 0.5, randRot: 25 }, dur: 0.4, stagger: 0.3, ease: 'in', order: 'random' },
    hold: { jitter: { amount: 0.035, rot: 3.5, freq: 22 }, flicker: 0.12 },
    shake: 0.02,
  },
  {
    id: 'sink',
    name: '沈降',
    hint: 'ゆらめきながら沈む。溺れる、眠るに',
    meta: { moods: ['lonely', 'calm', 'sensual'], roles: ['verse', 'bridge', 'outro'], energy: 0.25, legibility: 2, minDur: 1.8 },
    enter: { xf: { dv: -0.5, alpha: 0, blur: 0.5 }, dur: 0.9, stagger: 0.5, ease: 'out' },
    exit: { xf: { dv: 1.6, alpha: 0, blur: 0.8, randRot: 18, scale: 0.9 }, dur: 1.1, stagger: 0.6, ease: 'in' },
    hold: { sway: { du: 0.05, dv: 0.035, rot: 3, freq: 0.3 }, drift: { dv: 0.045 } },
  },
  {
    id: 'flash',
    name: '閃光',
    hint: '光とともに一瞬で現れる。刹那、転換点に',
    meta: { moods: ['excite', 'hope'], roles: ['chorus', 'pre', 'bridge'], energy: 0.75, legibility: 3 },
    particles: 1.5,
    enter: { xf: { scale: 1.5, scaleU: 1.6, alpha: 0, blur: 0.7 }, dur: 0.16, stagger: 0, ease: 'outExpo' },
    exit: { xf: { scaleU: 1.8, scaleV: 0.2, alpha: 0, blur: 0.5 }, dur: 0.22, stagger: 0, ease: 'in' },
    flash: { amount: 0.9, at: 'start' },
    impact: 0.05,
  },

  // ---- ここから下は、演出拡張（2026-11）で足した動き ----
  {
    id: 'slide',
    name: '疾走',
    hint: '横から鋭く滑り込み、反対側へ抜ける。速い展開に',
    meta: { moods: ['excite', 'anger'], roles: ['pre', 'chorus', 'verse'], energy: 0.7, legibility: 3 },
    enter: { xf: { du: -5, alpha: 0, scaleU: 1.6, blur: 0.5 }, dur: 0.3, stagger: 0.25, ease: 'outExpo' },
    exit: { xf: { du: 5, alpha: 0, scaleU: 1.6, blur: 0.5 }, dur: 0.26, stagger: 0.2, ease: 'inExpo' },
    hold: { drift: { du: 0.03 } },
  },
  {
    id: 'rise',
    name: '上昇',
    hint: '下からふわりと昇る。希望、祈りに',
    meta: { moods: ['hope', 'calm'], roles: ['verse', 'chorus', 'outro'], energy: 0.4, legibility: 3 },
    particles: 1.2,
    enter: { xf: { dv: 1.1, alpha: 0, blur: 0.4, scale: 0.94 }, dur: 0.8, stagger: 0.7, ease: 'out' },
    exit: { xf: { dv: -1.3, alpha: 0, blur: 0.5 }, dur: 0.9, stagger: 0.6, ease: 'in' },
    hold: { drift: { dv: -0.03 }, sway: { dv: 0.02, freq: 0.3 } },
  },
  {
    id: 'approach',
    name: '接近',
    hint: '遠くから迫り、目の前を通り抜ける。奥行き、没入に',
    meta: { moods: ['fear', 'obsess', 'calm'], roles: ['intro', 'bridge', 'pre'], energy: 0.5, legibility: 3, minDur: 1.6 },
    enter: { xf: { scale: 0.2, alpha: 0, blur: 0.7 }, dur: 1.2, stagger: 0.1, ease: 'out', order: 'center' },
    exit: { xf: { scale: 3.4, alpha: 0, blur: 0.9 }, dur: 0.5, stagger: 0.05, ease: 'in', order: 'center' },
  },
  {
    id: 'type',
    name: '打鍵',
    hint: '1文字ずつ、打ち込むように現れる。語り、宣告に',
    meta: { moods: ['secret', 'fear', 'chaos'], roles: ['verse', 'pre', 'intro'], energy: 0.35, legibility: 3 },
    particles: 0.5,
    enter: { xf: { alpha: 0, dv: -0.06 }, dur: 0.07, stagger: 14, ease: 'linear' },
    exit: { xf: { alpha: 0 }, dur: 0.12, stagger: 0, ease: 'linear' },
  },
  {
    id: 'bounce',
    name: '弾み',
    hint: '落ちてきて跳ねる。軽やかな言葉、皮肉に',
    meta: { moods: ['excite', 'hope'], roles: ['verse', 'pre', 'chorus'], energy: 0.55, legibility: 3 },
    enter: { xf: { dv: -2.4, alpha: 0 }, dur: 0.75, stagger: 0.6, ease: 'outBounce' },
    exit: { xf: { dv: 0.9, alpha: 0, scaleV: 0.7, randRot: 14 }, dur: 0.35, stagger: 0.4, ease: 'in' },
    hold: { pulse: 0.06 },
  },
  {
    id: 'crush',
    name: '圧迫',
    hint: '押し潰されて平たくなる。抑圧、息苦しさに',
    meta: { moods: ['fear', 'obsess', 'anger'], roles: ['pre', 'bridge', 'verse'], energy: 0.6, legibility: 2 },
    enter: { xf: { scaleV: 3.2, scaleU: 0.7, alpha: 0, dv: -0.5 }, dur: 0.4, stagger: 0.15, ease: 'out' },
    exit: { xf: { scaleV: 0.06, scaleU: 1.5, dv: 0.5, alpha: 0 }, dur: 0.5, stagger: 0.1, ease: 'in' },
    hold: { jitter: { amount: 0.008, freq: 14 } },
    impact: 0.05,
  },
  {
    id: 'scatter',
    name: '集結',
    hint: 'ばらばらの文字が集まり、また散る。解放、再生に',
    meta: { moods: ['hope', 'chaos', 'excite'], roles: ['chorus', 'bridge', 'intro'], energy: 0.6, legibility: 2, minDur: 1.4 },
    particles: 1.3,
    enter: {
      xf: { randDu: 4.5, randDv: 2.6, randRot: 160, scale: 0.5, alpha: 0, blur: 0.6 },
      dur: 0.8,
      stagger: 0.3,
      ease: 'outExpo',
      order: 'random',
    },
    exit: {
      xf: { randDu: 5, randDv: 3, randRot: 200, scale: 0.4, alpha: 0, blur: 0.7 },
      dur: 0.7,
      stagger: 0.2,
      ease: 'in',
      order: 'random',
    },
  },
  {
    id: 'still',
    name: '静止',
    hint: '動かずに、ただそこにある。決定的な一語、無音に',
    meta: { moods: ['secret', 'lonely', 'fear'], roles: ['bridge', 'outro', 'intro'], energy: 0.15, legibility: 3 },
    particles: 0.2,
    enter: { xf: { alpha: 0 }, dur: 0.08, stagger: 0, ease: 'linear' },
    exit: { xf: { alpha: 0 }, dur: 0.1, stagger: 0, ease: 'linear' },
  },
];
