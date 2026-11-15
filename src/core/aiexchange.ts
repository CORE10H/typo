// AI（Claude や ChatGPT などの対話AI）に演出を相談するための、依頼文づくりと、返事の読み取り。
//
// このアプリ自身は AI に接続しない（費用も鍵も要らない）。
//   1. 依頼文（歌詞とカタログ入り）を作って、利用者が自分で AI に貼る
//   2. AI の返事（JSON）を貼り戻してもらい、ここで検査してから当てはめる
//
// 誤作動防止：返事は「信用しないデータ」として扱う。
//   - カタログに実在する番号だけを受け付ける。無い番号は捨てて、その旨を報告する
//   - 数値は範囲内に丸める。効果の数には上限を設ける。登場・退場を受け持つ効果は各1つまで
//   - 固定した行には当てはめない

import { EFFECTS, MAX_LAYERS, getEffect } from '../engine/effects';
import { CATEGORY_LABELS } from '../engine/effects/types';
import { PRESETS, hasPreset } from '../engine/presets';
import { RECIPES, applyRecipe, getRecipe } from '../engine/recipes';
import { getTheme } from '../engine/themes';
import { linesOf, lineText, type LayerRef, type LineItem, type Project } from './model';
import { ROLE_LABELS, sectionRoles } from './suggest';

const MAX_REPLY_CHARS = 300_000;

/** AI に貼る依頼文を作る */
export function buildAiPrompt(p: Project): string {
  const theme = getTheme(p.theme);
  const roles = sectionRoles(p);
  const lines = linesOf(p);
  const out: string[] = [];
  out.push(
    'あなたは、ミュージックビデオの歌詞演出（キネティックタイポグラフィ）の演出家です。',
    '下の歌詞の1行ごとに、カタログの中から演出を選んでください。',
    '',
    '# 決まり',
    '- 使えるのは、下のカタログにある番号（id）だけです。カタログに無い番号は作らないでください。',
    '- 1行につき、「レシピ」を1つ選ぶか、「動き」を1つ選んで「効果」を0〜3個重ねます。',
    '- 歌詞の意味・感情と、曲の中での場所（サビか、静かな場面か）に合わせて選びます。単語だけで機械的に決めないでください。',
    '- 同じ演出、特に派手な演出を続けないでください。歌詞を読ませたい行は控えめにします。',
    '- サビの頭など、いちばん見せたい行をはっきり決めてください。静止や余白も演出として使えます。',
    '- 同じ歌詞が繰り返される区間（2回目のサビなど）は、1回目を土台にして少し発展させます。',
    '- 行の長さ（秒）が短い行に、読みにくくなる演出は使わないでください。',
    '',
    '# 返事の形',
    '説明の文章は書かず、次の形の JSON だけを返してください。line は歌詞の番号です。',
    '```json',
    '[',
    '  {"line": 1, "recipe": "レシピのid", "strength": 0.6, "reason": "選んだ理由を短く"},',
    '  {"line": 2, "motion": "動きのid", "layers": [{"fx": "効果のid", "amount": 0.5}], "strength": 0.4, "speed": 0.5, "reason": "…"}',
    ']',
    '```',
    '- strength（強さ）、speed（速さ）、amount（効かせる量）は 0〜1。0.5 が標準です。省いてもかまいません。',
    '',
    '# 曲の情報',
    `- 題名：${p.title || '（無題）'}`,
    `- 見た目のテーマ：${theme.name}（${theme.description}）`,
    `- テンポ：BPM ${Math.round(p.beat.bpm)}、${p.beat.perBar}/${p.beat.unit} 拍子`,
    '',
    '# カタログ',
    '## レシピ（動きと効果を組み合わせた完成形）',
    ...RECIPES.map((r) => `- ${r.id}：${r.name} — ${r.hint}`),
    '',
    '## 動き',
    ...PRESETS.map((m) => `- ${m.id}：${m.name} — ${m.hint}`),
    '',
    '## 効果（動きの上に重ねる）',
    ...EFFECTS.map((e) => `- ${e.id}：${e.name}［${CATEGORY_LABELS[e.category]}］ — ${e.hint}`),
    '',
    '# 歌詞',
    '番号｜区間（見立てた役割）｜長さ（秒）｜歌詞',
    ...lines.map((l, i) => {
      const role = roles.get(l.section);
      return `${i + 1}｜${l.section}${role ? `（${ROLE_LABELS[role]}）` : ''}｜${(l.end - l.start).toFixed(1)}｜${lineText(l)}`;
    }),
  );
  return out.join('\n');
}

export interface AiChoice {
  /** 行の番号（0 始まり） */
  index: number;
  recipe: string | null;
  motion: string | null;
  layers: LayerRef[];
  strength: number | null;
  speed: number | null;
  reason: string;
}

export interface AiReply {
  choices: AiChoice[];
  /** 受け付けなかった内容の説明（画面に出す） */
  problems: string[];
}

function unit(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
}

/** AI の返事から JSON の部分を取り出して読む。読めなければ理由を返す */
export function parseAiReply(text: string, lineCount: number): AiReply {
  const problems: string[] = [];
  if (text.length > MAX_REPLY_CHARS) return { choices: [], problems: ['貼り付けた文章が長すぎます。AIの返事の JSON の部分だけを貼ってください。'] };
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return { choices: [], problems: ['JSON（[ から ] まで）が見つかりません。AIの返事をそのまま貼ってください。'] };
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { choices: [], problems: ['JSON として読めませんでした。AIに「JSONだけを返して」と頼み直してください。'] };
  }
  if (!Array.isArray(data)) return { choices: [], problems: ['返事の形が違います（配列ではありません）。'] };

  const seen = new Set<number>();
  const choices: AiChoice[] = [];
  for (const raw of data.slice(0, 2000)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const no = typeof r.line === 'number' ? Math.round(r.line) : NaN;
    if (!(no >= 1 && no <= lineCount)) {
      problems.push(`行 ${String(r.line)}：その番号の行はありません`);
      continue;
    }
    if (seen.has(no)) continue; // 同じ行が2回出てきたら、最初のものを採る
    seen.add(no);

    const recipe = typeof r.recipe === 'string' && getRecipe(r.recipe) ? r.recipe : null;
    const motion = typeof r.motion === 'string' && hasPreset(r.motion) ? r.motion : null;
    if (typeof r.recipe === 'string' && !recipe) problems.push(`行 ${no}：レシピ「${r.recipe.slice(0, 30)}」はカタログにありません`);
    if (typeof r.motion === 'string' && !motion) problems.push(`行 ${no}：動き「${r.motion.slice(0, 30)}」はカタログにありません`);
    if (!recipe && !motion) continue;

    const layers: LayerRef[] = [];
    let hasEnter = false;
    let hasExit = false;
    if (!recipe && Array.isArray(r.layers)) {
      for (const lr of r.layers) {
        const fx = lr && typeof lr === 'object' ? (lr as Record<string, unknown>).fx : lr;
        if (typeof fx !== 'string') continue;
        const e = getEffect(fx);
        if (!e) {
          problems.push(`行 ${no}：効果「${fx.slice(0, 30)}」はカタログにありません`);
          continue;
        }
        if (layers.some((l) => l.fx === fx) || layers.length >= MAX_LAYERS) continue;
        if (e.replaces === 'enter') {
          if (hasEnter) continue;
          hasEnter = true;
        }
        if (e.replaces === 'exit') {
          if (hasExit) continue;
          hasExit = true;
        }
        const amount = lr && typeof lr === 'object' ? unit((lr as Record<string, unknown>).amount) : null;
        layers.push({ fx, amount: amount ?? 0.5 });
      }
    }
    choices.push({
      index: no - 1,
      recipe,
      motion,
      layers,
      strength: unit(r.strength),
      speed: unit(r.speed),
      reason: typeof r.reason === 'string' ? r.reason.slice(0, 200) : '',
    });
  }
  if (choices.length === 0 && problems.length === 0) problems.push('当てはめられる行がありませんでした。');
  return { choices, problems };
}

/** 読み取った返事を作品に当てはめる。固定した行は飛ばす。当てはめた行数と、飛ばした行数を返す */
export function applyAiReply(p: Project, reply: AiReply): { applied: number; skippedLocked: number } {
  const lines = linesOf(p);
  let applied = 0;
  let skippedLocked = 0;
  for (const c of reply.choices) {
    const line: LineItem | undefined = lines[c.index];
    if (!line) continue;
    if (line.locked) {
      skippedLocked++;
      continue;
    }
    const recipe = getRecipe(c.recipe);
    if (recipe) {
      applyRecipe(line, recipe);
    } else if (c.motion) {
      line.preset = c.motion;
      line.layers = c.layers.map((l) => ({ ...l }));
      line.recipe = null;
    } else {
      continue;
    }
    if (c.strength !== null) line.strength = c.strength;
    if (c.speed !== null) line.speed = c.speed;
    applied++;
  }
  return { applied, skippedLocked };
}
