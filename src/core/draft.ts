// 叩き台づくり（仕様書3章の4、4章「叩き台」）。
//   時間：待機区間を避けて均等割り。
//   動き：歌詞の言葉とテーマに沿って自動で選ぶ。固定の印が付いた行は上書きしない。

import { hash, hashString } from '../engine/util';
import type { ParsedLine } from './lyrics';
import { linesOf, newId, waitsOf, type LineItem, type Project } from './model';

/** 歌詞の言葉から、向いている動きを選ぶための手がかり（仕様書6章「向く歌詞」） */
const KEYWORD_RULES: [RegExp, string][] = [
  [/蜜|甘|溶|とろ|滴|雫|涙|濡|シロップ|液|毒/, 'drip'],
  [/壊|砕|裂|割|崩|破|散|千切|粉々/, 'shatter'],
  [/踊|舞|ワルツ|回|廻|輪|くるくる/, 'rondo'],
  [/縛|罠|絡|鎖|糸|囚|檻|捕|逃げられ/, 'tangle'],
  [/溺|眠|沈|深|底|堕|落ち/, 'sink'],
  [/狂|怖|震|叫|悲鳴|恐|痛|拷問|壊れそう/, 'tremble'],
  [/染|記憶|滲|霞|ぼやけ|思い出|面影|忘れ/, 'blur'],
  [/刹那|光|閃|瞬|煌|輝|稲妻/, 'flash'],
  [/心|鼓動|胸|脈|愛|熱|高鳴/, 'pulse'],
  [/！|!|叩|撃|殺|刺|奪|砕け/, 'impact'],
];

/** テーマごとの、よく使う動き */
const THEME_POOLS: Record<string, string[]> = {
  dokuringo: ['fall', 'pulse', 'impact', 'tremble', 'shatter', 'flash', 'rondo', 'drip'],
  seido: ['blur', 'fall', 'whisper', 'sink', 'flash', 'rondo', 'pulse'],
  mitsu: ['drip', 'sink', 'blur', 'pulse', 'rondo', 'fall', 'tangle'],
};
const OPENING = ['fall', 'blur', 'whisper'];
const CLOSING = ['sink', 'blur', 'shatter', 'tangle'];
const SHORT = ['impact', 'flash', 'pulse'];

function pickFrom(pool: string[], seed: number, avoid: string | null): string {
  for (let i = 0; i < 4; i++) {
    const choice = pool[Math.floor(hash(seed, i + 1) * pool.length) % pool.length];
    if (choice !== avoid) return choice;
  }
  return pool[0];
}

/**
 * 動きを自動で割り当てる。
 * @param seed 「おまかせで振り直す」のたびに変える番号
 */
export function assignPresets(p: Project, seed: number): void {
  const lines = linesOf(p);
  const pool = THEME_POOLS[p.theme] ?? THEME_POOLS.dokuringo;

  // 同じ文面の区間（2回目のサビなど）は、1回目と同じ割り当てにする
  const sections = new Map<string, LineItem[]>();
  for (const l of lines) {
    const list = sections.get(l.section) ?? [];
    list.push(l);
    sections.set(l.section, list);
  }
  const firstBySignature = new Map<string, LineItem[]>();

  let prev: string | null = null;
  for (const [, group] of sections) {
    const signature = group.map((l) => l.phrases.join('')).join('\n');
    const original = firstBySignature.get(signature);
    group.forEach((line, i) => {
      if (line.locked) {
        prev = line.preset;
        return;
      }
      if (original && original[i]) {
        line.preset = original[i].preset;
        line.strength = original[i].strength;
        line.speed = original[i].speed;
        prev = line.preset;
        return;
      }
      const text = line.phrases.join('');
      const s = (hashString(line.id) ^ Math.imul(seed + 1, 2654435761)) | 0;
      const len = Array.from(text).length;
      let choice: string | null = null;
      const rule = KEYWORD_RULES.find(([re]) => re.test(text));
      if (rule && hash(s, 20) < 0.75 && rule[1] !== prev) choice = rule[1];
      if (!choice) {
        if (i === 0 && group.length > 1) choice = pickFrom(OPENING, s, prev);
        else if (i === group.length - 1 && group.length > 2 && hash(s, 21) < 0.6) choice = pickFrom(CLOSING, s, prev);
        else if (len <= 5) choice = pickFrom(SHORT, s, prev);
        else choice = pickFrom(pool, s, prev);
      }
      line.preset = choice;
      prev = choice;
    });
    if (!original) firstBySignature.set(signature, group);
  }
}

/** 歌詞を出せる時間帯（待機区間を除いた部分）を求める */
function freeSegments(p: Project): { start: number; end: number }[] {
  const duration = p.video.duration > 0 ? p.video.duration : 180;
  const waits = waitsOf(p)
    .map((w) => ({ start: Math.max(0, w.start), end: Math.min(duration, w.end) }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const w of waits) {
    if (w.start > cursor) out.push({ start: cursor, end: w.start });
    cursor = Math.max(cursor, w.end);
  }
  if (cursor < duration) out.push({ start: cursor, end: duration });
  return out.filter((s) => s.end - s.start >= 0.5);
}

/** 行の時間を、待機区間を避けて均等に割り振る */
export function distributeTimes(p: Project): void {
  const lines = linesOf(p);
  if (lines.length === 0) return;
  let segments = freeSegments(p);
  if (segments.length === 0) segments = [{ start: 0, end: Math.max(1, p.video.duration || 180) }];
  const total = segments.reduce((a, s) => a + (s.end - s.start), 0);

  // 各時間帯に、長さに比例した行数を割り当てる（端数は余りの大きい順に配る）
  const exact = segments.map((s) => ((s.end - s.start) / total) * lines.length);
  const counts = exact.map((x) => Math.floor(x));
  let rest = lines.length - counts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0; k++, rest--) counts[order[k % order.length].i]++;

  let index = 0;
  segments.forEach((seg, si) => {
    const m = counts[si];
    if (m === 0) return;
    const slot = (seg.end - seg.start) / m;
    const gap = Math.min(0.25, slot * 0.1);
    for (let j = 0; j < m; j++) {
      const line = lines[index++];
      line.start = Math.round((seg.start + j * slot + gap / 2) * 100) / 100;
      line.end = Math.round((seg.start + (j + 1) * slot - gap / 2) * 100) / 100;
    }
  });
}

/** 歌詞から叩き台を作る。待機区間はそのまま残し、行はすべて作り直す */
export function buildDraft(p: Project, parsed: ParsedLine[]): void {
  const waits = waitsOf(p);
  const lines: LineItem[] = parsed.map((pl) => ({
    type: 'line',
    id: newId('l'),
    section: pl.section,
    phrases: pl.phrases,
    layout: 'stack',
    start: 0,
    end: 0,
    preset: 'fall',
    strength: 0.5,
    speed: 0.5,
    position: null,
    locked: false,
    color: null,
  }));
  p.items = [...waits, ...lines];
  distributeTimes(p);
  assignPresets(p, 0);
  sortItems(p);
}

/** 待機区間と行を、時間の順に並べる（行どうしの順番は歌詞の順のまま） */
export function sortItems(p: Project): void {
  const lines = linesOf(p);
  const waits = waitsOf(p).sort((a, b) => a.start - b.start);
  const out: Project['items'] = [];
  let wi = 0;
  for (const line of lines) {
    while (wi < waits.length && waits[wi].start <= line.start) out.push(waits[wi++]);
    out.push(line);
  }
  while (wi < waits.length) out.push(waits[wi++]);
  p.items = out;
}

/** 区間の設定（動き・強さ・速さ・並べ方・位置・色）を、別の区間へ行の順に写す（2回目のサビ用） */
export function copySectionSettings(p: Project, from: string, to: string): number {
  const lines = linesOf(p);
  const src = lines.filter((l) => l.section === from);
  const dst = lines.filter((l) => l.section === to);
  let n = 0;
  dst.forEach((line, i) => {
    const s = src[i];
    if (!s) return;
    line.preset = s.preset;
    line.strength = s.strength;
    line.speed = s.speed;
    line.position = s.position;
    line.color = s.color;
    if (line.phrases.length === s.phrases.length) line.layout = s.layout;
    line.locked = true;
    n++;
  });
  return n;
}

export function sectionNames(p: Project): string[] {
  return Array.from(new Set(linesOf(p).map((l) => l.section)));
}
