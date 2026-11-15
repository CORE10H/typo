// 作品のデータ形式（仕様書5章）。1つの作品を1つの JSON で表す。
// 時間は「秒」で持つ。BPM は吸着用の目盛りとしてだけ使う。

export type Shape = 'landscape' | 'portrait-fit';
export type Position = 'top' | 'middle' | 'bottom' | 'band-top' | 'band-bottom';
export type PhraseLayout = 'stack' | 'sequence';

export interface WaitItem {
  type: 'wait';
  id: string;
  start: number;
  end: number;
  label: string;
}

export interface LineItem {
  type: 'line';
  id: string;
  /** 区間の名前（Aメロ、サビなど） */
  section: string;
  phrases: string[];
  layout: PhraseLayout;
  start: number;
  end: number;
  preset: string;
  /** 強さ 0〜1 */
  strength: number;
  /** 速さ 0〜1 */
  speed: number;
  /** 行の位置。null なら作品全体の標準位置を使う */
  position: Position | null;
  /** 手で直した行の印。「おまかせで振り直す」から守る */
  locked: boolean;
  /** 手で選んだ色（テーマの配色の番号）。null なら自動 */
  color: number | null;
  /** 自動配色の結果（映像を調べて決めた配色の番号と、場面の明るさ 0〜1） */
  auto?: { color: number; bright: number; sig: string };
}

export type Item = WaitItem | LineItem;

export interface Project {
  version: 1;
  id: string;
  title: string;
  video: { name: string; duration: number; width: number; height: number };
  output: { shape: Shape; band: 'black' };
  beat: { bpm: number; perBar: number; unit: number; offset: number };
  writing: 'horizontal' | 'vertical';
  theme: string;
  autoColor: boolean;
  /** 作品全体の標準位置 */
  position: Position;
  /** 文字サイズの倍率（1 が標準） */
  textScale: number;
  /** 縁取りの太さの倍率（1 が標準） */
  outline: number;
  /** 影を付けるか */
  shadow: boolean;
  /** 拍への吸着 */
  snap: boolean;
  /** 取り込み画面に貼った歌詞の原文 */
  lyrics: string;
  items: Item[];
  createdAt: number;
  updatedAt: number;
}

export const POSITION_LABELS: Record<Position, string> = {
  top: '映像の上',
  middle: '映像の中央',
  bottom: '映像の下',
  'band-top': '上の帯',
  'band-bottom': '下の帯',
};

export const TIME_SIGNATURES: { label: string; perBar: number; unit: number }[] = [
  { label: '4/4', perBar: 4, unit: 4 },
  { label: '3/4', perBar: 3, unit: 4 },
  { label: '6/8', perBar: 6, unit: 8 },
];

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter++;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function newProject(): Project {
  const now = Date.now();
  return {
    version: 1,
    id: newId('p'),
    title: '',
    video: { name: '', duration: 0, width: 1920, height: 1080 },
    output: { shape: 'landscape', band: 'black' },
    beat: { bpm: 120, perBar: 4, unit: 4, offset: 0 },
    writing: 'horizontal',
    theme: 'dokuringo',
    autoColor: true,
    position: 'bottom',
    textScale: 1,
    outline: 1,
    shadow: true,
    snap: false,
    lyrics: '',
    items: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function isLine(item: Item): item is LineItem {
  return item.type === 'line';
}

export function linesOf(p: Project): LineItem[] {
  return p.items.filter(isLine);
}

export function waitsOf(p: Project): WaitItem[] {
  return p.items.filter((i): i is WaitItem => i.type === 'wait');
}

export function lineText(line: LineItem): string {
  return line.phrases.join(' ');
}

const POSITIONS: Position[] = ['top', 'middle', 'bottom', 'band-top', 'band-bottom'];

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 保存データを読み込むときに、欠けた項目を補い、おかしな値を直す。
 * 将来データ形式を変えたときは、ここで version を見て古い作品を変換する。
 */
export function normalizeProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  if (r.version !== 1 || typeof r.id !== 'string') return null;
  const base = newProject();
  const p: Project = {
    ...base,
    id: r.id,
    title: typeof r.title === 'string' ? r.title : '',
    video: {
      name: typeof r.video?.name === 'string' ? r.video.name : '',
      duration: num(r.video?.duration, 0, 0),
      width: num(r.video?.width, 1920, 2),
      height: num(r.video?.height, 1080, 2),
    },
    output: { shape: r.output?.shape === 'portrait-fit' ? 'portrait-fit' : 'landscape', band: 'black' },
    beat: {
      bpm: num(r.beat?.bpm, 120, 20, 400),
      perBar: num(r.beat?.perBar, 4, 1, 12),
      unit: num(r.beat?.unit, 4, 1, 16),
      offset: num(r.beat?.offset, 0, 0),
    },
    writing: 'horizontal',
    theme: typeof r.theme === 'string' ? r.theme : base.theme,
    autoColor: r.autoColor !== false,
    position: POSITIONS.includes(r.position) ? r.position : base.position,
    textScale: num(r.textScale, 1, 0.5, 2),
    outline: num(r.outline, 1, 0, 2.5),
    shadow: r.shadow !== false,
    snap: r.snap === true,
    lyrics: typeof r.lyrics === 'string' ? r.lyrics : '',
    items: [],
    createdAt: num(r.createdAt, Date.now()),
    updatedAt: num(r.updatedAt, Date.now()),
  };
  const items: unknown[] = Array.isArray(r.items) ? r.items : [];
  for (const it of items) {
    const i = it as Record<string, any>;
    if (!i || typeof i.id !== 'string') continue;
    const start = num(i.start, 0, 0);
    const end = Math.max(start, num(i.end, start, 0));
    if (i.type === 'wait') {
      p.items.push({ type: 'wait', id: i.id, start, end, label: typeof i.label === 'string' ? i.label : '' });
    } else if (i.type === 'line' && Array.isArray(i.phrases)) {
      const phrases = i.phrases.filter((s: unknown): s is string => typeof s === 'string' && s.length > 0);
      if (phrases.length === 0) continue;
      p.items.push({
        type: 'line',
        id: i.id,
        section: typeof i.section === 'string' ? i.section : '',
        phrases,
        layout: i.layout === 'sequence' ? 'sequence' : 'stack',
        start,
        end,
        preset: typeof i.preset === 'string' ? i.preset : 'fall',
        strength: num(i.strength, 0.5, 0, 1),
        speed: num(i.speed, 0.5, 0, 1),
        position: POSITIONS.includes(i.position) ? i.position : null,
        locked: i.locked === true,
        color: typeof i.color === 'number' ? Math.max(0, Math.floor(i.color)) : null,
        auto:
          i.auto && typeof i.auto.color === 'number'
            ? { color: i.auto.color, bright: num(i.auto.bright, 0, 0, 1), sig: String(i.auto.sig ?? '') }
            : undefined,
      });
    }
  }
  return p;
}

/** 行どうしが重ならないように整える（行の順番は歌詞の順のまま変えない） */
export function resolveOverlaps(p: Project, minLen = 0.15): void {
  const lines = linesOf(p);
  const dur = p.video.duration > 0 ? p.video.duration : Infinity;
  let prevEnd = 0;
  for (const line of lines) {
    line.start = Math.max(0, Math.min(line.start, dur - minLen));
    line.end = Math.min(dur, Math.max(line.end, line.start + minLen));
    if (line.start < prevEnd) {
      line.start = prevEnd;
      if (line.end < line.start + minLen) line.end = Math.min(dur, line.start + minLen);
    }
    prevEnd = line.end;
  }
}

/** 秒を、拍の目盛り（半拍きざみ）のいちばん近い位置に寄せる */
export function snapToBeat(p: Project, t: number): number {
  // 6/8 拍子は 1拍を3つに、それ以外は2つに割った位置へ寄せる
  const beat = 60 / p.beat.bpm / (p.beat.unit === 8 ? 3 : 2);
  if (!(beat > 0)) return t;
  const k = Math.round((t - p.beat.offset) / beat);
  return Math.max(0, p.beat.offset + k * beat);
}

export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
