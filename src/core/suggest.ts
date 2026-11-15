// 演出の自動提案。歌詞の言葉・曲の中での場所・行の長さから、カタログにある演出を選ぶ。
//
// 考え方（mv_kinetic_typography_kit「04_AI演出選択ロジック」に沿う）：
//   1. 区間ごとに、曲の中での役割（イントロ・Aメロ・サビ前・サビ・間奏・アウトロ）を見立てる
//   2. 行ごとに、歌詞の言葉から気分（孤独・怒り・執着…）を読み取る
//   3. カタログの全候補に点を付ける（気分・役割・派手さの合い方、同じ演出の続きすぎ、読みやすさ）
//   4. 制約（行が短すぎる、文字が多すぎる）に合わない候補は外す
//   5. 選んだ理由と、別の候補も一緒に返す。決めるのは人。固定した行には触らない
//
// 実在する番号しか選ばない（候補はカタログから作るので、存在しない演出は出てこない）。
// 乱数は使わず、seed から決まる値だけを使う（同じ seed なら同じ提案になる）。

import { PRESETS } from '../engine/presets';
import type { Meta, Mood, Role } from '../engine/presets/types';
import { RECIPES, applyRecipe, getRecipe } from '../engine/recipes';
import { hash, hashString } from '../engine/util';
import { linesOf, type LayerRef, type LineItem, type Project } from './model';

export interface Candidate {
  id: string;
  kind: 'recipe' | 'motion';
  name: string;
  /** 土台の動き */
  preset: string;
  meta: Meta;
}

export interface Suggestion {
  lineId: string;
  choice: Candidate;
  /** 重ねる効果（レシピのときは、その中身。同じ区間の写しのときは、写し元の中身） */
  layers: LayerRef[];
  strength: number;
  speed: number;
  /** 選んだ理由（画面に出す） */
  reason: string;
  alternatives: Candidate[];
}

export const ROLE_LABELS: Record<Role, string> = {
  intro: 'イントロ',
  verse: 'Aメロ',
  pre: 'サビ前',
  chorus: 'サビ',
  bridge: '間奏・Cメロ',
  outro: 'アウトロ',
};

export const MOOD_LABELS: Record<Mood, string> = {
  lonely: '孤独・喪失',
  anger: '怒り・破壊',
  fear: '恐怖・不安',
  obsess: '執着・反復',
  hope: '解放・希望',
  sensual: '官能・陶酔',
  chaos: '混乱・狂気',
  secret: '告白・秘密',
  excite: '高揚',
  calm: '静けさ',
};

/** 区間の名前から役割を読む。上から順に試す（「ラストサビ」はサビ、のように先に当たったものを採る） */
const ROLE_NAMES: [RegExp, Role][] = [
  [/サビ|chorus|hook|コーラス|ドロップ|drop/i, 'chorus'],
  [/イントロ|intro|前奏|冒頭/i, 'intro'],
  [/アウトロ|outro|後奏|エンディング|終わり/i, 'outro'],
  [/ブリッジ|bridge|[CcＣ]メロ|間奏|ブレイク|break/i, 'bridge'],
  [/[BbＢ]メロ|pre|プレ|サビ前/i, 'pre'],
  [/[AaＡ]メロ|verse|ヴァース|バース|[0-9０-９]番/i, 'verse'],
];

/** 歌詞の言葉から気分を読むための手がかり */
const MOOD_WORDS: [Mood, RegExp][] = [
  ['lonely', /孤独|独り|ひとり|一人|寂|淋|喪|失|いない|居ない|さよなら|別れ|沈黙|空っぽ|涙|泣|遠ざか|置き去り/],
  ['anger', /怒|憎|壊|砕|裂|殺|刺|叩|撃|奪|許さ|拒|嫌い|破|燃や|黙れ|消えろ|！|!/],
  ['fear', /怖|恐|震|不安|疑|闇|影|悪夢|逃げ|悲鳴|痛|冷た|凍|息ができ/],
  ['obsess', /離さ|離れない|縛|絡|鎖|執着|依存|何度|ずっと|永遠|繰り返|囚|檻|罠|嫉妬|だけを|だけの|もっと|逃がさ/],
  ['hope', /光|希望|夢|明日|未来|空|翼|飛|自由|解き放|目覚|朝|生まれ|祈|救|歩き出/],
  ['sensual', /蜜|甘|溶|とろ|唇|肌|吐息|抱|口づけ|キス|酔|熱|濡|滴|香|毒|夜|触れ|指先/],
  ['chaos', /狂|混乱|崩|歪|壊れ|ぐちゃ|乱|眩暈|めまい|迷|ノイズ|わからない|分からない|バグ|嘘/],
  ['secret', /秘密|内緒|告白|囁|ささや|本当は|ほんとは|隠|誰にも|心の奥|言えな|打ち明け/],
  ['excite', /踊|舞|鼓動|高鳴|叫|走|ワルツ|歌|響|騒|跳|燃え|止まらない/],
  ['calm', /眠|静|沈|深|底|凪|そっと|ゆっくり|遠く|微睡|まどろ|揺れ|溺/],
];

/** 歌詞の言葉に、特に合う動き（仕様書6章「向く歌詞」） */
const MOTION_WORDS: [RegExp, string][] = [
  [/蜜|甘|溶|とろ|滴|雫|涙|濡|シロップ|液|毒/, 'drip'],
  [/壊|砕|裂|割|崩|破|散|千切|粉々/, 'shatter'],
  [/踊|舞|ワルツ|回|廻|輪|くるくる/, 'rondo'],
  [/縛|罠|絡|鎖|糸|囚|檻|捕|逃げられ/, 'tangle'],
  [/溺|眠|沈|深|底|堕|落ち/, 'sink'],
  [/狂|怖|震|悲鳴|恐|痛|拷問|壊れそう/, 'tremble'],
  [/染|記憶|滲|霞|ぼやけ|思い出|面影|忘れ/, 'blur'],
  [/刹那|閃|瞬|煌|輝|稲妻/, 'flash'],
  [/心|鼓動|胸|脈|愛|高鳴/, 'pulse'],
  [/叩|撃|殺|刺|奪/, 'impact'],
  [/昇|翼|飛|空へ|祈/, 'rise'],
  [/走|駆|疾|追いかけ|逃げ/, 'slide'],
  [/近づ|迫|来る|覗/, 'approach'],
  [/押し潰|潰|息苦し|重い|圧/, 'crush'],
  [/集ま|ひとつに|一つに|散らば|ばらばら/, 'scatter'],
  [/裏|表|反対|逆さ|鏡|もう一人/, 'flip'],
];

/** テーマごとの、よく合う動き */
const THEME_POOLS: Record<string, string[]> = {
  dokuringo: ['fall', 'pulse', 'impact', 'tremble', 'shatter', 'flash', 'rondo', 'drip', 'slide', 'crush'],
  seido: ['blur', 'fall', 'whisper', 'sink', 'flash', 'rondo', 'pulse', 'rise', 'approach', 'still'],
  mitsu: ['drip', 'sink', 'blur', 'pulse', 'rondo', 'fall', 'tangle', 'rise', 'bounce'],
};

/** 役割ごとの、目安にする派手さ */
const ROLE_ENERGY: Record<Role, number> = { intro: 0.25, verse: 0.35, pre: 0.6, chorus: 0.82, bridge: 0.3, outro: 0.25 };

const CANDIDATES: Candidate[] = [
  ...RECIPES.map((r): Candidate => ({ id: r.id, kind: 'recipe', name: r.name, preset: r.preset, meta: r.meta })),
  ...PRESETS.map((m): Candidate => ({ id: m.id, kind: 'motion', name: m.name, preset: m.id, meta: m.meta })),
];

function baseName(section: string): string {
  return section.replace(/（\d+回目）$/, '');
}

/** 区間ごとの役割を見立てる。名前から分かればそれを使い、分からなければ歌詞の繰り返しと並び順から推し量る */
export function sectionRoles(p: Project): Map<string, Role> {
  const order: string[] = [];
  const texts = new Map<string, string[]>();
  for (const l of linesOf(p)) {
    if (!texts.has(l.section)) {
      texts.set(l.section, []);
      order.push(l.section);
    }
    texts.get(l.section)!.push(l.phrases.join(''));
  }
  const signature = (name: string): string => texts.get(name)!.join('\n');
  const sigCount = new Map<string, number>();
  for (const name of order) sigCount.set(signature(name), (sigCount.get(signature(name)) ?? 0) + 1);

  const roles = new Map<string, Role>();
  const named = new Set<string>();
  for (const name of order) {
    const hit = ROLE_NAMES.find(([re]) => re.test(baseName(name)));
    if (hit) {
      roles.set(name, hit[1]);
      named.add(name);
    } else if ((sigCount.get(signature(name)) ?? 0) >= 2) {
      roles.set(name, 'chorus'); // 同じ歌詞が繰り返される区間は、サビとみなす
    }
  }

  // 手がかりが何もないときは、「A・B・サビ」の並びを仮に当てはめる
  const anyChorus = order.some((n) => roles.get(n) === 'chorus');
  if (!anyChorus && named.size === 0) {
    if (order.length >= 3) order.forEach((n, i) => i % 3 === 2 && roles.set(n, 'chorus'));
    else if (order.length === 2) roles.set(order[1], 'chorus');
  }

  let chorusSeen = 0;
  order.forEach((name, i) => {
    if (roles.has(name)) {
      if (roles.get(name) === 'chorus') chorusSeen++;
      return;
    }
    const count = texts.get(name)!.length;
    const next = order[i + 1];
    const prev = order[i - 1];
    let role: Role = 'verse';
    if (i === 0 && order.length > 1 && count <= 2) role = 'intro';
    else if (i === order.length - 1 && order.length > 2 && count <= 3) role = 'outro';
    else if (next && roles.get(next) === 'chorus' && prev && roles.get(prev) !== 'chorus' && i > 0) role = 'pre';
    else if (chorusSeen >= 2 && i < order.length - 1) role = 'bridge';
    roles.set(name, role);
  });
  return roles;
}

/** 歌詞の言葉から気分を読み取る。当たった言葉も一緒に返す（理由の表示用） */
export function detectMoods(text: string): { mood: Mood; word: string }[] {
  const out: { mood: Mood; word: string }[] = [];
  for (const [mood, re] of MOOD_WORDS) {
    const m = re.exec(text);
    if (m) out.push({ mood, word: m[0] });
  }
  return out;
}

interface Scored {
  cand: Candidate;
  score: number;
}

/**
 * 固定していない行すべてに、演出の案を出す。
 * @param seed 「別の案」を出すたびに変える番号
 */
export function suggest(p: Project, seed: number): Suggestion[] {
  const lines = linesOf(p);
  const roles = sectionRoles(p);
  const themePool = THEME_POOLS[p.theme] ?? THEME_POOLS.dokuringo;
  const out: Suggestion[] = [];

  const groups = new Map<string, LineItem[]>();
  for (const l of lines) {
    const g = groups.get(l.section) ?? [];
    g.push(l);
    groups.set(l.section, g);
  }
  // 同じ歌詞の区間（2回目のサビなど）は、1回目と同じ演出にして、少しだけ強める（モチーフの発展）
  const firstBySignature = new Map<string, { name: string; picks: Map<number, Suggestion | LineItem>; repeats: number }>();

  const usage = new Map<string, number>();
  const recent: string[] = [];
  let prev: Candidate | null = null;
  const remember = (c: Candidate): void => {
    usage.set(c.id, (usage.get(c.id) ?? 0) + 1);
    recent.push(c.id);
    if (recent.length > 3) recent.shift();
    prev = c;
  };
  const candidateOf = (line: LineItem): Candidate =>
    CANDIDATES.find((c) => c.id === (getRecipe(line.recipe) ? line.recipe : line.preset)) ?? CANDIDATES[CANDIDATES.length - 1];

  for (const [section, group] of groups) {
    const role = roles.get(section) ?? 'verse';
    const signature = group.map((l) => l.phrases.join('')).join('\n');
    const original = firstBySignature.get(signature);
    if (original) original.repeats++;
    const picks = new Map<number, Suggestion | LineItem>();

    group.forEach((line, i) => {
      if (line.locked) {
        picks.set(i, line);
        remember(candidateOf(line));
        return;
      }
      const source = original?.picks.get(i);
      if (original && source) {
        const isLineItem = 'type' in source;
        const choice = isLineItem ? candidateOf(source) : source.choice;
        const s: Suggestion = {
          lineId: line.id,
          choice,
          layers: (isLineItem ? source.layers : source.layers).map((l) => ({ ...l })),
          strength: Math.round(Math.min(0.9, source.strength + 0.08 * original.repeats) * 100) / 100,
          speed: source.speed,
          reason: `「${original.name}」と同じ歌詞なので同じ演出。${original.repeats + 1}回目なので少し強め`,
          alternatives: [],
        };
        out.push(s);
        picks.set(i, s);
        remember(choice);
        return;
      }

      const text = line.phrases.join('');
      const chars = Array.from(text).length;
      const dur = Math.max(0.05, line.end - line.start);
      const moods = detectMoods(text);
      const moodSet = new Set(moods.map((m) => m.mood));
      const motionWord = MOTION_WORDS.find(([re]) => re.test(text));
      const motionHit = motionWord ? motionWord[0].exec(text)?.[0] ?? '' : '';

      // この行で狙う派手さ
      let target = ROLE_ENERGY[role];
      const pos = group.length > 1 ? i / (group.length - 1) : 0;
      if (role === 'chorus') target = i === 0 ? 1 : i === group.length - 1 ? 0.85 : 0.72;
      if (role === 'pre') target = 0.5 + 0.28 * pos; // サビへ向けて、だんだん上げる
      if (role === 'outro') target = 0.3 - 0.12 * pos;
      if (/[！!]/.test(text)) target = Math.min(1, target + 0.15);
      if (role === 'chorus' && chars <= 4) target = Math.min(1, target + 0.08);

      const lineSeed = (hashString(line.id) ^ Math.imul(seed + 1, 2654435761)) | 0;
      const scored: Scored[] = [];
      CANDIDATES.forEach((cand, ci) => {
        const m = cand.meta;
        // 制約：合わない候補は、点数にかかわらず外す
        if (m.minDur !== undefined && dur < m.minDur) return;
        if (m.maxChars !== undefined && chars > m.maxChars) return;
        if (dur < 1.3 && m.legibility === 1) return;
        if (prev && cand.id === prev.id) return;

        let score = 0;
        const hits = m.moods.filter((x) => moodSet.has(x)).length;
        score += Math.min(2, hits) * 2.6;
        score += m.roles.includes(role) ? 1.8 : -1.2;
        score -= Math.abs(m.energy - target) * 4.5;
        if (motionWord && cand.preset === motionWord[1]) score += 2.2;
        if (themePool.includes(cand.preset)) score += 0.7;
        // 同じ演出の使いすぎ・続きすぎを避ける
        score -= (usage.get(cand.id) ?? 0) * (cand.kind === 'recipe' ? 1.1 : 0.5);
        if (recent.includes(cand.id)) score -= 1.5;
        if (prev && prev.preset === cand.preset) score -= 1.2;
        if (prev && prev.meta.energy >= 0.75 && m.energy >= 0.75 && role !== 'chorus') score -= 2;
        // 歌詞を読ませたい場所では、凝ったレシピより素直な動きを優先する
        if (cand.kind === 'recipe') score += role === 'chorus' ? 0.8 : role === 'verse' ? -0.9 : 0;
        score += hash(lineSeed, ci + 1) * 1.4;
        scored.push({ cand, score });
      });
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0]?.cand ?? CANDIDATES[CANDIDATES.length - 1];
      const recipe = best.kind === 'recipe' ? getRecipe(best.id) : undefined;

      // 選んだ理由
      const parts: string[] = [];
      parts.push(
        role === 'chorus' && i === 0 ? 'サビの頭なので強く' : role === 'pre' ? 'サビへ向けて高める' : `${ROLE_LABELS[role]}の行`,
      );
      const mood = moods.find((x) => best.meta.moods.includes(x.mood));
      if (mood) parts.push(`「${mood.word}」→ ${MOOD_LABELS[mood.mood]}`);
      else if (motionWord && best.preset === motionWord[1] && motionHit) parts.push(`「${motionHit}」の言葉に合う動き`);
      if (dur < 1.6) parts.push('短い行なので読みやすさ優先');

      const baseStrength = recipe?.strength ?? 0.3 + 0.45 * target;
      const s: Suggestion = {
        lineId: line.id,
        choice: best,
        layers: recipe ? recipe.layers.map((l) => ({ ...l })) : [],
        strength: Math.round(Math.min(0.9, Math.max(0.2, baseStrength + (target - best.meta.energy) * 0.15)) * 100) / 100,
        speed: line.speed,
        reason: parts.join('／'),
        alternatives: scored.slice(1, 3).map((x) => x.cand),
      };
      out.push(s);
      picks.set(i, s);
      remember(best);
    });

    if (!original) firstBySignature.set(signature, { name: section, picks, repeats: 0 });
  }
  return out;
}

/** 提案を行に当てはめる */
export function applySuggestion(line: LineItem, s: Suggestion, choice: Candidate = s.choice): void {
  const recipe = choice.kind === 'recipe' ? getRecipe(choice.id) : undefined;
  if (recipe) {
    applyRecipe(line, recipe);
    if (choice === s.choice) line.layers = s.layers.map((l) => ({ ...l }));
  } else {
    line.preset = choice.preset;
    line.layers = choice === s.choice ? s.layers.map((l) => ({ ...l })) : [];
    line.recipe = null;
  }
  line.strength = s.strength;
  line.speed = s.speed;
}

/** 提案を一括で当てはめる。当てはめた行数を返す */
export function applySuggestions(p: Project, list: Suggestion[]): number {
  const byId = new Map(linesOf(p).map((l) => [l.id, l]));
  let n = 0;
  for (const s of list) {
    const line = byId.get(s.lineId);
    if (!line || line.locked) continue; // 固定した行は守る
    applySuggestion(line, s);
    n++;
  }
  return n;
}
