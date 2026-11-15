// 貼り付けた歌詞を、区間・行・フレーズに分ける（仕様書3章・6章）。
//   改行 = 1行、空行 = 区間の切れ目、行の中の空白や「/」= フレーズの区切り。
//   区切りのない長い行は、文節の切れ目を自動で探す（BudouX）。

import { loadDefaultJapaneseParser } from 'budoux';

export interface ParsedLine {
  section: string;
  phrases: string[];
}

const SECTION_HEADER = /^[[【［(（〔]\s*(.+?)\s*[\]】］)）〕]$/;
const DELIMITER = /[\s　]*[/／|｜][\s　]*|[\s　]+/;

/** この文字数を超える行は、自動で2つに分ける */
const AUTO_SPLIT_OVER = 13;
const AUTO_SPLIT_3_OVER = 30;

let parser: ReturnType<typeof loadDefaultJapaneseParser> | null = null;

function charLen(s: string): number {
  return Array.from(s).length;
}

/** 文節のかたまりを、長さがなるべく揃うように n 個へまとめる */
function balance(chunks: string[], n: number): string[] {
  if (chunks.length <= n) return chunks.filter((c) => c.length > 0);
  const total = chunks.reduce((a, c) => a + charLen(c), 0);
  const out: string[] = [];
  let current = '';
  let consumed = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const target = (total * (out.length + 1)) / n;
    const before = consumed;
    const after = consumed + charLen(c);
    // このかたまりを入れた方が目標に近いなら入れる
    if (current && out.length < n - 1 && Math.abs(before - target) <= Math.abs(after - target)) {
      out.push(current);
      current = '';
    }
    current += c;
    consumed = after;
  }
  if (current) out.push(current);
  return out;
}

/** 1行の文字列をフレーズに分ける。手で入れた区切りを優先し、無ければ自動で探す */
export function splitPhrases(text: string): string[] {
  const manual = text
    .split(DELIMITER)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (manual.length !== 1) return manual;
  const only = manual[0];
  const len = charLen(only);
  if (len <= AUTO_SPLIT_OVER) return manual;
  try {
    parser ??= loadDefaultJapaneseParser();
    const chunks = parser.parse(only);
    const parts = balance(chunks, len > AUTO_SPLIT_3_OVER ? 3 : 2);
    return parts.length > 0 ? parts : manual;
  } catch {
    return manual;
  }
}

/** 手で直したフレーズ欄（「/」区切り）を読む。自動分割はしない */
export function parsePhraseInput(text: string): string[] {
  return text
    .split(/[\s　]*[/／|｜\n][\s　]*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseLyrics(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  let sectionIndex = 0;
  let sectionName = '';
  let pendingName: string | null = null;
  let needNewSection = true;
  const used = new Map<string, number>();

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (line === '') {
      needNewSection = true;
      continue;
    }
    const header = SECTION_HEADER.exec(line);
    if (header) {
      pendingName = header[1];
      needNewSection = true;
      continue;
    }
    if (needNewSection) {
      sectionIndex++;
      const base = pendingName ?? `区間${sectionIndex}`;
      // 同じ名前の区間（2回目のサビなど）は、番号を付けて区別する
      const count = (used.get(base) ?? 0) + 1;
      used.set(base, count);
      sectionName = count > 1 ? `${base}（${count}回目）` : base;
      pendingName = null;
      needNewSection = false;
    }
    const phrases = splitPhrases(line);
    if (phrases.length > 0) out.push({ section: sectionName, phrases });
  }
  return out;
}
