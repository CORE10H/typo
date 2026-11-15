// テーマ（見た目）の定義。色・書体・縁取り・発光・粒子をデータで持つ（仕様書6章）。
// プログラムを含まない設定データなので、あとから素材パックとして足せる形になっている。

export interface Swatch {
  /** 文字の塗り（上の色、下の色） */
  fill: [string, string];
  /** 縁取りの色 */
  stroke: string;
  /** 文字の外側の光の色 */
  glow: string;
}

export interface ParticleStyle {
  /** spark = 火の粉（上へ昇る）、dust = 塵（漂う）、drop = 滴（落ちる） */
  kind: 'spark' | 'dust' | 'drop';
  colors: string[];
  /** 1行あたりの粒の数の目安 */
  count: number;
  /** 粒の大きさ（文字の大きさに対する割合） */
  size: number;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  font: { family: string; weight: number };
  /** 配色（自動配色はこの中から選ぶ） */
  palette: Swatch[];
  /** 縁取りの太さ（文字の大きさに対する割合） */
  outline: number;
  /** 発光の広がりと強さ */
  glow: { blur: number; alpha: number };
  /** 影の位置・ぼかし・濃さ */
  shadow: { dy: number; blur: number; alpha: number };
  particles: ParticleStyle;
  /** 閃光などで使う光の色 */
  flash: string;
  /** 画面の見本に使う背景色 */
  backdrop: [string, string];
}

export const THEMES: Theme[] = [
  {
    id: 'dokuringo',
    name: '毒林檎',
    description: '深紅と金。蝋燭の火と火の粉',
    font: { family: 'Shippori Mincho', weight: 800 },
    palette: [
      { fill: ['#fff3c4', '#d9a441'], stroke: '#2a0508', glow: '#ff3a2a' },
      { fill: ['#ff7a5c', '#a80f1c'], stroke: '#1a0204', glow: '#ffb347' },
      { fill: ['#ffe0a6', '#ff8a2a'], stroke: '#2a0a04', glow: '#ff5a1a' },
      { fill: ['#fff8ea', '#e6cfae'], stroke: '#3a0810', glow: '#ff2a3a' },
    ],
    outline: 0.085,
    glow: { blur: 0.32, alpha: 0.9 },
    shadow: { dy: 0.07, blur: 0.1, alpha: 0.85 },
    particles: { kind: 'spark', colors: ['#ffd27a', '#ff8a2a', '#ff4a2a'], count: 26, size: 0.05 },
    flash: '#ffe2b0',
    backdrop: ['#3a0810', '#0a0204'],
  },
  {
    id: 'seido',
    name: '聖堂',
    description: '青黒と銀。月の光と漂う塵',
    font: { family: 'Zen Old Mincho', weight: 700 },
    palette: [
      { fill: ['#ffffff', '#c4d2e8'], stroke: '#0a1024', glow: '#8fb4ff' },
      { fill: ['#d6e8ff', '#6f9ae0'], stroke: '#060b1c', glow: '#bcd6ff' },
      { fill: ['#1c2748', '#080d20'], stroke: '#e3ebf7', glow: '#ffffff' },
      { fill: ['#b9c6d9', '#5c6c88'], stroke: '#050814', glow: '#9fc0ff' },
    ],
    outline: 0.05,
    glow: { blur: 0.4, alpha: 0.75 },
    shadow: { dy: 0.05, blur: 0.14, alpha: 0.8 },
    particles: { kind: 'dust', colors: ['#ffffff', '#cfe0ff', '#9fc0ff'], count: 30, size: 0.035 },
    flash: '#e8f1ff',
    backdrop: ['#141e3c', '#04060e'],
  },
  {
    id: 'mitsu',
    name: '蜜',
    description: '琥珀と乳白。とろみのある輝きと滴',
    font: { family: 'Kaisei Decol', weight: 700 },
    palette: [
      { fill: ['#ffe6a8', '#e08a1a'], stroke: '#2a1500', glow: '#ffb030' },
      { fill: ['#fffaf0', '#f0dcc0'], stroke: '#3a2208', glow: '#ffc860' },
      { fill: ['#2e1c0a', '#080400'], stroke: '#ffcf70', glow: '#fff0d0' },
      { fill: ['#ffc060', '#b35a00'], stroke: '#1e0e00', glow: '#ffe2a0' },
    ],
    outline: 0.075,
    glow: { blur: 0.3, alpha: 0.8 },
    shadow: { dy: 0.08, blur: 0.08, alpha: 0.8 },
    particles: { kind: 'drop', colors: ['#ffd27a', '#ffb030', '#fff0c8'], count: 18, size: 0.06 },
    flash: '#fff0c8',
    backdrop: ['#4a2a08', '#0c0600'],
  },
];

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** "#rrggbb" の明るさ（0〜1） */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
