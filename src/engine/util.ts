// 描画まわりの小さな道具。

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export type EaseName = 'linear' | 'in' | 'out' | 'inOut' | 'outBack' | 'outBounce' | 'outExpo' | 'inExpo';

export function ease(name: EaseName | undefined, t: number): number {
  const x = clamp01(t);
  switch (name) {
    case 'in':
      return x * x * x;
    case 'out':
      return 1 - Math.pow(1 - x, 3);
    case 'inOut':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'outBack': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }
    case 'outBounce': {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (x < 1 / d1) return n1 * x * x;
      if (x < 2 / d1) return n1 * (x - 1.5 / d1) * (x - 1.5 / d1) + 0.75;
      if (x < 2.5 / d1) return n1 * (x - 2.25 / d1) * (x - 2.25 / d1) + 0.9375;
      return n1 * (x - 2.625 / d1) * (x - 2.625 / d1) + 0.984375;
    }
    case 'outExpo':
      return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
    case 'inExpo':
      return x <= 0 ? 0 : Math.pow(2, 10 * x - 10);
    default:
      return x;
  }
}

/**
 * 番号から決まる乱数（0〜1）。同じ番号なら必ず同じ値になる。
 * プレビューと書き出しで見た目を一致させるため、Math.random は使わない。
 */
export function hash(a: number, b = 0): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** 文字列から決まる番号 */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** -1〜1 の乱数 */
export const srand = (a: number, b = 0): number => hash(a, b) * 2 - 1;
