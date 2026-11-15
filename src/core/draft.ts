// 叩き台づくり（仕様書3章の4、4章「叩き台」）。
//   時間：待機区間を避けて均等割り。
//   演出：歌詞の言葉・曲の中での場所・テーマに沿って自動で選ぶ（suggest.ts）。固定の印が付いた行は上書きしない。

import type { ParsedLine } from './lyrics';
import { linesOf, newId, waitsOf, type LineItem, type Project } from './model';
import { applySuggestions, suggest } from './suggest';

/**
 * 演出を自動で割り当てる。選び方の中身は suggest.ts にある。
 * 固定の印が付いた行は上書きしない。同じ歌詞の区間（2回目のサビなど）は、1回目と同じ割り当てになる。
 * @param seed 「おまかせで振り直す」のたびに変える番号
 */
export function assignPresets(p: Project, seed: number): number {
  return applySuggestions(p, suggest(p, seed));
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
    layers: [],
    recipe: null,
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

/** 区間の設定（動き・重ねた効果・強さ・速さ・並べ方・位置・色）を、別の区間へ行の順に写す（2回目のサビ用） */
export function copySectionSettings(p: Project, from: string, to: string): number {
  const lines = linesOf(p);
  const src = lines.filter((l) => l.section === from);
  const dst = lines.filter((l) => l.section === to);
  let n = 0;
  dst.forEach((line, i) => {
    const s = src[i];
    if (!s) return;
    line.preset = s.preset;
    line.layers = s.layers.map((l) => ({ ...l }));
    line.recipe = s.recipe;
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
