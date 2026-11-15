// 歌詞を描く本体。プレビューと書き出しで、必ずこの同じ Renderer を使う（CLAUDE.md の決まり）。
//
// しくみ：
//   1. 行ごとに、文字の置き場所を計算しておく（行の文面や位置が変わったときだけ計算し直す）
//   2. 1文字ずつの絵（縁取り・発光・影つき）を先に描いて取っておく
//   3. 毎コマ、「動き」が決めた位置・大きさ・濃さに「重ねた効果」を足して、取っておいた絵を貼る
// 3 が軽いので、スマホでも書き出しが遅くならない。
//
// 重ねた効果どうしがぶつかるときの決まりは effects/types.ts の冒頭に書いてある。

import { isLine, type LineItem, type Position, type Project } from '../core/model';
import type { Camera, Layout } from '../layout';
import { MAX_LAYERS, getEffect } from './effects';
import { amountToFactor, type DrawTools, type Effect, type Pass, type Tint } from './effects/types';
import { fontString } from './fonts';
import { getPreset } from './presets';
import {
  newFx,
  resetFx,
  type BeatInfo,
  type CharBox,
  type CharState,
  type DrawCtx,
  type LineCtx,
  type LineFx,
  type Preset,
  type Sprite,
} from './presets/types';
import { getTheme, type Swatch, type Theme } from './themes';
import { clamp01, hash, hashString } from './util';

const MEASURE_PX = 100;
const LETTER_SPACING = 0.05; // 文字の大きさに対する字間
const ROW_HEIGHT = 1.28; // 行の高さ
const BLUR_LEVELS = 4;
/** 取っておく文字の絵の上限（画素数の合計）。超えたら古いものから捨てる。約 64MB ぶん */
const SPRITE_PIXEL_BUDGET = 16_000_000;
const MAX_SPRITES = 600;
/** 1行に足せる写し（残像など）の上限 */
const MAX_PASSES = 10;
/** 1行に出す粒子の上限 */
const MAX_PARTICLES = 110;
/** 色づけした写しの色（赤・水色・白） */
const TINT_COLORS = ['', '#ff2d55', '#22e0ff', '#ffffff'];
/** 映像を寄せる倍率の上限 */
const MAX_CAM_SCALE = 1.22;

/** 行（またはフレーズ1つ）ぶんの、文字の置き場所 */
interface Block {
  chars: CharBox[];
  /** この行に出てくる文字（重複なし） */
  pool: string[];
  width: number;
  height: number;
  /** 行の時間のうち、このかたまりが出ている範囲（0〜1） */
  from: number;
  to: number;
}

interface LineLayout {
  sig: string;
  em: number;
  cx: number;
  cy: number;
  blocks: Block[];
  seed: number;
}

/** 拍の長さなど。6/8 拍子は「3つで1拍」と数える（体で感じる拍に合わせる） */
export function beatGrid(p: Project): { beatLen: number; barBeats: number } {
  const beatLen = 60 / Math.max(20, p.beat.bpm);
  const barBeats = p.beat.unit === 8 ? Math.max(1, p.beat.perBar / 3) : Math.max(1, p.beat.perBar);
  return { beatLen, barBeats };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function newPass(): Pass {
  return { dx: 0, dy: 0, scale: 1, flipY: false, rot: 0, alpha: 1, blur: 0, tint: 0, dt: 0, front: false };
}

export class Renderer {
  private project: Project | null = null;
  private theme: Theme = getTheme('');
  private styleSig = '';
  private layouts = new Map<string, LineLayout>();
  private sprites = new Map<string, Sprite>();
  private spritePixels = 0;
  private dots = new Map<string, HTMLCanvasElement>();
  private measureCtx: CanvasRenderingContext2D;
  private widthCache = new Map<string, number>();
  private state: CharState = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, alpha: 1, blur: 0, originY: 0 };
  private fx: LineFx = newFx();
  private canBlur: boolean;

  // 毎コマ使い回す入れ物（描くたびに新しく作ると、スマホで引っかかりの原因になる）
  private effs: Effect[] = [];
  private amts: number[] = [];
  private passPool: Pass[] = [];
  private passCount = 0;
  private spare: Pass = newPass();
  private L: LineCtx = {
    t: 0,
    dur: 1,
    k: 1,
    sp: 1,
    em: 1,
    width: 0,
    height: 0,
    n: 0,
    seed: 0,
    beat: { sinceBeat: 0, sinceBar: 0, beatLen: 0.5, barLen: 2, beatNo: 0, inBar: 0, strong: true },
    noEnter: false,
    noExit: false,
  };
  private cam: Camera = { scale: 1, dx: 0, dy: 0 };
  // 「文字化け」の効果が別の文字の絵を取り出すときに使う、今描いている行の情報
  private cur = { em: 1, swatch: 0, bright: 0, tint: 0 as Tint };
  private tools: DrawTools = {
    glyph: (ch) => this.sprite(ch, this.cur.em, this.cur.swatch, this.cur.bright, 0, this.cur.tint),
    pool: [],
  };
  private addPass = (): Pass => {
    // 上限を超えた分は、描かれない予備の入れ物に書かせて捨てる
    if (this.passCount >= MAX_PASSES) return this.spare;
    let p = this.passPool[this.passCount];
    if (!p) {
      p = newPass();
      this.passPool[this.passCount] = p;
    }
    this.passCount++;
    p.dx = 0;
    p.dy = 0;
    p.scale = 1;
    p.flipY = false;
    p.rot = 0;
    p.alpha = 1;
    p.blur = 0;
    p.tint = 0;
    p.dt = 0;
    p.front = false;
    return p;
  };

  /** テーマの書体を読み込んだあとに作り直したかどうか（呼び出し側が印として使う） */
  fontReady = false;

  /**
   * @param layout 出力の寸法と、映像を置く場所
   * @param pixelScale 実際に描くキャンバスが、出力の何倍の細かさか（プレビューは 1 未満）
   */
  constructor(
    readonly layout: Layout,
    readonly pixelScale = 1,
  ) {
    const c = makeCanvas(8, 8);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('描画用のキャンバスを用意できませんでした');
    this.measureCtx = ctx;
    this.canBlur = 'filter' in ctx;
  }

  setProject(p: Project): void {
    this.project = p;
    const sig = `${p.theme}|${p.textScale}|${p.outline}|${p.shadow}|${p.position}`;
    if (sig !== this.styleSig) {
      this.styleSig = sig;
      this.theme = getTheme(p.theme);
      this.invalidate();
    }
  }

  /** 書体が読み込まれたあとなど、取っておいた計算結果と絵を捨てて作り直させる */
  invalidate(): void {
    this.layouts.clear();
    this.sprites.clear();
    this.spritePixels = 0;
    this.widthCache.clear();
  }

  // ---- 文字の置き場所 ------------------------------------------------------

  private charWidth(ch: string): number {
    let w = this.widthCache.get(ch);
    if (w === undefined) {
      this.measureCtx.font = fontString(this.theme, MEASURE_PX);
      w = this.measureCtx.measureText(ch).width / MEASURE_PX;
      this.widthCache.set(ch, w);
    }
    return w;
  }

  /** 行の位置（中心の座標）を決める */
  private anchor(position: Position): { cx: number; cy: number; band: boolean } {
    const { width, height, video: v } = this.layout;
    const cx = width / 2;
    const hasBand = this.layout.shape !== 'landscape' && v.y > height * 0.05;
    let pos = position;
    if (!hasBand) {
      if (pos === 'band-top') pos = 'top';
      if (pos === 'band-bottom') pos = 'bottom';
    }
    switch (pos) {
      case 'top':
        return { cx, cy: v.y + v.height * 0.2, band: false };
      case 'middle':
        return { cx, cy: v.y + v.height * 0.5, band: false };
      case 'bottom':
        return { cx, cy: v.y + v.height * 0.8, band: false };
      case 'band-top':
        return { cx, cy: v.y * 0.55, band: true };
      case 'band-bottom': {
        // 最下部はショート動画の操作ボタンで隠れるので、下 18% には置かない（仕様書6章）
        const top = v.y + v.height;
        const bottom = height * 0.82;
        return { cx, cy: (top + bottom) / 2, band: true };
      }
    }
  }

  private buildBlock(phrases: string[], em: number): Block {
    const rows = phrases.map((text) => {
      const chars = Array.from(text);
      let w = 0;
      const items = chars.map((ch) => {
        const cw = this.charWidth(ch) * em;
        const item = { ch, x: w + cw / 2, w: cw };
        w += cw + LETTER_SPACING * em;
        return item;
      });
      return { items, width: Math.max(0, w - LETTER_SPACING * em) };
    });
    const width = Math.max(...rows.map((r) => r.width), 0);
    const height = rows.length * ROW_HEIGHT * em;
    const out: CharBox[] = [];
    rows.forEach((row, r) => {
      const y = (r - (rows.length - 1) / 2) * ROW_HEIGHT * em;
      for (const item of row.items) {
        if (item.ch.trim() === '') continue;
        out.push({ ch: item.ch, x: item.x - row.width / 2, y, w: item.w, i: 0, n: 0, seed: 0 });
      }
    });
    out.forEach((c, i) => {
      c.i = i;
      c.n = out.length;
      c.seed = (hashString(c.ch) + i * 7919) | 0;
    });
    return { chars: out, pool: Array.from(new Set(out.map((c) => c.ch))), width, height, from: 0, to: 1 };
  }

  private layoutLine(line: LineItem, preset: Preset): LineLayout {
    const p = this.project!;
    const position = line.position ?? p.position;
    const sig = `${line.phrases.join('\u0001')}|${line.layout}|${position}|${preset.sizeFactor}`;
    const cached = this.layouts.get(line.id);
    if (cached && cached.sig === sig) return cached;

    const { width: W, video: v } = this.layout;
    const a = this.anchor(position);
    const maxWidth = W * 0.9;
    let em = v.width * 0.062 * p.textScale * preset.sizeFactor * (a.band ? 1.12 : 1);

    const groups = line.layout === 'sequence' ? line.phrases.map((ph) => [ph]) : [line.phrases];
    let blocks = groups.map((g) => this.buildBlock(g, em));
    const widest = Math.max(...blocks.map((b) => b.width), 1);
    if (widest > maxWidth) {
      em *= maxWidth / widest;
      blocks = groups.map((g) => this.buildBlock(g, em));
    }

    // 順番に出すときは、文字数に応じて時間を割り振る
    if (blocks.length > 1) {
      const weights = blocks.map((b) => b.chars.length + 2);
      const total = weights.reduce((x, y) => x + y, 0);
      let acc = 0;
      blocks.forEach((b, i) => {
        b.from = acc / total;
        acc += weights[i];
        b.to = acc / total;
      });
    }

    // 画面からはみ出さないように、上下の位置を収める
    const tallest = Math.max(...blocks.map((b) => b.height));
    const margin = em * 0.5;
    const cy = Math.min(this.layout.height - tallest / 2 - margin, Math.max(tallest / 2 + margin, a.cy));

    const result: LineLayout = { sig, em, cx: a.cx, cy, blocks, seed: hashString(line.id) | 0 };
    this.layouts.set(line.id, result);
    if (this.layouts.size > 600) this.layouts.delete(this.layouts.keys().next().value!);
    return result;
  }

  // ---- 文字の絵 ------------------------------------------------------------

  private sprite(ch: string, em: number, swatchIndex: number, bright: number, blurLevel: number, tint: Tint = 0): Sprite {
    const ps = this.pixelScale;
    const px = Math.max(4, Math.round(em * ps));
    const key = `${ch}|${px}|${swatchIndex}|${bright}|${blurLevel}|${tint}`;
    const hit = this.sprites.get(key);
    if (hit) {
      // 最近使ったものを後ろへ回す（古いものから捨てるため）
      this.sprites.delete(key);
      this.sprites.set(key, hit);
      return hit;
    }

    const theme = this.theme;
    const p = this.project!;
    const sw: Swatch = theme.palette[swatchIndex % theme.palette.length];
    // 映像が明るい場面ほど、縁取りと影を濃くする（仕様書6章「自動配色」）
    const boost = 1 + bright * 0.35;
    const outline = theme.outline * p.outline * boost * px;
    const glowBlur = theme.glow.blur * px;
    const shadowDy = p.shadow ? theme.shadow.dy * px : 0;
    const shadowBlur = p.shadow ? theme.shadow.blur * px * boost : 0;
    const blurPx = (blurLevel / BLUR_LEVELS) * 0.3 * px;
    const pad = Math.ceil(outline + Math.max(glowBlur * 1.6, shadowBlur * 1.6 + shadowDy) + blurPx * 2.5 + 2);

    const cw = this.charWidth(ch) * px;
    const w = Math.ceil(cw + pad * 2);
    const h = Math.ceil(px * 1.3 + pad * 2);
    const sharp = makeCanvas(w, h);
    const g = sharp.getContext('2d')!;
    g.font = fontString(theme, px);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    const x = w / 2;
    const y = h / 2;

    if (tint === 0) {
      // 1. 外側の光
      g.save();
      g.shadowColor = sw.glow;
      g.shadowBlur = glowBlur;
      g.globalAlpha = theme.glow.alpha;
      g.fillStyle = sw.glow;
      g.lineWidth = outline * 2;
      g.strokeStyle = sw.glow;
      if (outline > 0) g.strokeText(ch, x, y);
      g.fillText(ch, x, y);
      g.restore();

      // 2. 下に落ちる影と、縁取り
      g.save();
      if (p.shadow) {
        g.shadowColor = `rgba(0,0,0,${Math.min(1, theme.shadow.alpha * boost)})`;
        g.shadowBlur = shadowBlur;
        g.shadowOffsetY = shadowDy;
      }
      g.strokeStyle = sw.stroke;
      g.fillStyle = sw.stroke;
      g.lineWidth = Math.max(1, outline * 2);
      if (outline > 0) g.strokeText(ch, x, y);
      else g.fillText(ch, x, y);
      g.restore();

      // 3. 文字の塗り（上から下へのグラデーション）
      const grad = g.createLinearGradient(0, y - px * 0.5, 0, y + px * 0.5);
      grad.addColorStop(0, sw.fill[0]);
      grad.addColorStop(1, sw.fill[1]);
      g.fillStyle = grad;
      g.fillText(ch, x, y);
    } else {
      // 色ずれ用：光や影のない、1色だけの文字（寸法は通常の絵と揃える）
      g.fillStyle = TINT_COLORS[tint];
      g.strokeStyle = TINT_COLORS[tint];
      g.lineWidth = outline;
      if (outline > 0) g.strokeText(ch, x, y);
      g.fillText(ch, x, y);
    }

    let canvas = sharp;
    if (blurLevel > 0 && this.canBlur) {
      canvas = makeCanvas(w, h);
      const b = canvas.getContext('2d')!;
      b.filter = `blur(${blurPx.toFixed(2)}px)`;
      b.drawImage(sharp, 0, 0);
    }

    const sprite: Sprite = { canvas, w: w / ps, h: h / ps };
    this.sprites.set(key, sprite);
    this.spritePixels += w * h;
    // 取っておく量が増えすぎたら、古いものから捨てる（メモリの使いすぎを防ぐ）
    while ((this.spritePixels > SPRITE_PIXEL_BUDGET || this.sprites.size > MAX_SPRITES) && this.sprites.size > 1) {
      const oldestKey = this.sprites.keys().next().value!;
      const oldest = this.sprites.get(oldestKey)!;
      this.spritePixels -= oldest.canvas.width * oldest.canvas.height;
      this.sprites.delete(oldestKey);
    }
    return sprite;
  }

  /** 粒子用の、ふちがぼけた光の点 */
  private dot(color: string): HTMLCanvasElement {
    let d = this.dots.get(color);
    if (!d) {
      d = makeCanvas(32, 32);
      const g = d.getContext('2d')!;
      const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.25, color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
      this.dots.set(color, d);
    }
    return d;
  }

  // ---- 毎コマの準備 --------------------------------------------------------

  private beatAt(t: number): BeatInfo {
    const p = this.project!;
    const { beatLen, barBeats } = beatGrid(p);
    const pos = (t - p.beat.offset) / beatLen;
    const beatNo = Math.floor(pos);
    const barLen = beatLen * barBeats;
    const inBarPos = ((pos % barBeats) + barBeats) % barBeats;
    const inBar = Math.floor(inBarPos + 1e-6);
    return {
      sinceBeat: (pos - beatNo) * beatLen,
      sinceBar: inBarPos * beatLen,
      beatLen,
      barLen,
      beatNo,
      inBar,
      strong: inBar === 0,
    };
  }

  /** 行に重ねた効果を、使える形に並べる。知らない番号の効果は無視する（古い版・壊れたデータ対策） */
  private collectEffects(line: LineItem): void {
    const effs = this.effs;
    const amts = this.amts;
    effs.length = 0;
    amts.length = 0;
    const L = this.L;
    L.noEnter = false;
    L.noExit = false;
    const layers = line.layers;
    if (!layers) return;
    for (let i = 0; i < layers.length && effs.length < MAX_LAYERS; i++) {
      const e = getEffect(layers[i].fx);
      if (!e) continue;
      effs.push(e);
      amts.push(amountToFactor(layers[i].amount));
      if (e.replaces === 'enter') L.noEnter = true;
      if (e.replaces === 'exit') L.noExit = true;
    }
  }

  /** あるかたまり（フレーズ）について、その瞬間の状況と、行全体にかかる効果を求める */
  private prepare(line: LineItem, lay: LineLayout, block: Block, bi: number, frac: number, lineDur: number, beat: BeatInfo, preset: Preset): void {
    const L = this.L;
    L.dur = Math.max(0.05, (block.to - block.from) * lineDur);
    L.t = (frac - block.from) * lineDur;
    L.k = 0.35 + 1.3 * line.strength;
    L.sp = Math.pow(2, 1 - 2 * line.speed);
    L.em = lay.em;
    L.width = block.width;
    L.height = block.height;
    L.n = block.chars.length;
    L.seed = (lay.seed + bi * 101) | 0;
    L.beat = beat;
    const fx = this.fx;
    resetFx(fx);
    preset.fx(L, fx);
    for (let i = 0; i < this.effs.length; i++) this.effs[i].fx?.(L, fx, this.amts[i]);
  }

  /**
   * 時刻 t（秒）の、映像そのものの動き（寄り・揺れ）を返す。動きがなければ null。
   * 呼び出し側は、映像を描く前にこれを確かめて、映像の描き方に反映する。
   */
  camera(t: number): Camera | null {
    const p = this.project;
    if (!p) return null;
    let scale = 1;
    let dx = 0;
    let dy = 0;
    let beat: BeatInfo | null = null;
    for (const item of p.items) {
      if (!isLine(item) || t < item.start || t >= item.end) continue;
      if (!item.layers || item.layers.length === 0) continue; // 映像を動かすのは重ねた効果だけ
      const preset = getPreset(item.preset);
      const lay = this.layoutLine(item, preset);
      const lineDur = Math.max(0.05, item.end - item.start);
      const frac = (t - item.start) / lineDur;
      beat ??= this.beatAt(t);
      this.collectEffects(item);
      for (let bi = 0; bi < lay.blocks.length; bi++) {
        const block = lay.blocks[bi];
        if (frac < block.from || frac >= block.to) continue;
        this.prepare(item, lay, block, bi, frac, lineDur, beat, preset);
        scale *= this.fx.camScale;
        dx += this.fx.camX * lay.em;
        dy += this.fx.camY * lay.em;
      }
    }
    if (scale <= 1.0005 && dx === 0 && dy === 0) return null;
    const v = this.layout.video;
    scale = Math.min(MAX_CAM_SCALE, Math.max(1, scale));
    // 映像の端（黒い部分）が見えない範囲に、ずれを収める
    const maxX = ((scale - 1) * v.width) / 2;
    const maxY = ((scale - 1) * v.height) / 2;
    const cam = this.cam;
    cam.scale = scale;
    cam.dx = Math.min(maxX, Math.max(-maxX, dx));
    cam.dy = Math.min(maxY, Math.max(-maxY, dy));
    return cam;
  }

  // ---- 毎コマの描画 --------------------------------------------------------

  /** 時刻 t（秒）の歌詞を描く。映像はすでに描いてある前提で、その上に重ねる */
  draw(ctx: DrawCtx, t: number): void {
    const p = this.project;
    if (!p) return;
    let beat: BeatInfo | null = null;
    for (const item of p.items) {
      if (!isLine(item) || t < item.start || t >= item.end) continue;
      beat ??= this.beatAt(t);
      this.drawLine(ctx, item, t, beat);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawLine(ctx: DrawCtx, line: LineItem, t: number, beat: BeatInfo): void {
    const p = this.project!;
    const preset = getPreset(line.preset);
    const lay = this.layoutLine(line, preset);
    const lineDur = Math.max(0.05, line.end - line.start);
    const frac = (t - line.start) / lineDur;
    const swatch = line.color ?? (p.autoColor ? line.auto?.color : undefined) ?? 0;
    const bright = Math.round(clamp01(line.auto?.bright ?? 0) * 2);
    const ps = this.pixelScale;
    const L = this.L;
    const fx = this.fx;
    this.collectEffects(line);
    this.cur.em = lay.em;
    this.cur.swatch = swatch;
    this.cur.bright = bright;

    for (let bi = 0; bi < lay.blocks.length; bi++) {
      const block = lay.blocks[bi];
      if (frac < block.from || frac >= block.to) continue;
      this.prepare(line, lay, block, bi, frac, lineDur, beat, preset);
      const ox = lay.cx + fx.shakeX;
      const oy = lay.cy + fx.shakeY;

      this.drawBackdrop(ctx, fx);
      this.drawParticles(ctx, L, preset, line, ox, oy, 0, fx.particles);

      // 行の写し（残像・色ずれ・奥行きの複製など）を集める
      this.passCount = 0;
      for (let i = 0; i < this.effs.length; i++) this.effs[i].passes?.(L, this.amts[i], this.addPass);

      // 「幕が開く」：左から右へ、見える範囲を広げる
      const clipped = fx.reveal < 0.999;
      if (clipped) {
        const pad = lay.em * 1.2;
        ctx.save();
        ctx.setTransform(ps, 0, 0, ps, 0, 0);
        ctx.beginPath();
        ctx.rect(ox - block.width / 2 - pad, oy - block.height / 2 - pad, (block.width + pad * 2) * clamp01(fx.reveal), block.height + pad * 2);
        ctx.clip();
      }

      this.tools.pool = block.pool;
      for (let i = 0; i < this.passCount; i++) {
        if (!this.passPool[i].front) this.drawPass(ctx, block, lay, preset, ox, oy, swatch, bright, this.passPool[i]);
      }
      this.drawPass(ctx, block, lay, preset, ox, oy, swatch, bright, null);
      for (let i = 0; i < this.passCount; i++) {
        if (this.passPool[i].front) this.drawPass(ctx, block, lay, preset, ox, oy, swatch, bright, this.passPool[i]);
      }

      if (clipped) ctx.restore();
      ctx.globalCompositeOperation = 'source-over';

      this.drawParticles(ctx, L, preset, line, ox, oy, 1, fx.particles);

      if (fx.flash > 0.01) {
        ctx.setTransform(ps, 0, 0, ps, 0, 0);
        const r = block.width * 0.65 + lay.em * 2.2;
        const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
        grad.addColorStop(0, this.theme.flash);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, fx.flash);
        ctx.fillStyle = grad;
        ctx.fillRect(ox - r, oy - r, r * 2, r * 2);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (fx.screenFlash > 0.01) {
        ctx.setTransform(ps, 0, 0, ps, 0, 0);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, fx.screenFlash);
        ctx.fillStyle = this.theme.flash;
        // 光らせるのは映像の範囲だけ（縦はめ込みの黒い帯は、黒いまま保つ）
        const v = this.layout.video;
        ctx.fillRect(v.x, v.y, v.width, v.height);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  /** 文字の後ろに敷くもの：映像を暗くする幕と、映画風の黒帯 */
  private drawBackdrop(ctx: DrawCtx, fx: LineFx): void {
    if (fx.veil <= 0.01 && fx.bars <= 0.01) return;
    const ps = this.pixelScale;
    const v = this.layout.video;
    ctx.setTransform(ps, 0, 0, ps, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000000';
    if (fx.veil > 0.01) {
      ctx.globalAlpha = Math.min(0.85, fx.veil);
      ctx.fillRect(v.x, v.y, v.width, v.height);
    }
    if (fx.bars > 0.01) {
      const h = v.height * 0.11 * Math.min(1.4, fx.bars);
      ctx.globalAlpha = 1;
      ctx.fillRect(v.x, v.y, v.width, h);
      ctx.fillRect(v.x, v.y + v.height - h, v.width, h);
    }
    ctx.globalAlpha = 1;
  }

  /** かたまり1つを描く。pass が null なら本体、そうでなければ写し */
  private drawPass(
    ctx: DrawCtx,
    block: Block,
    lay: LineLayout,
    preset: Preset,
    ox: number,
    oy: number,
    swatch: number,
    bright: number,
    pass: Pass | null,
  ): void {
    const L = this.L;
    const fx = this.fx;
    const ps = this.pixelScale;
    const effs = this.effs;
    const amts = this.amts;
    const s = this.state;

    const realT = L.t;
    let passAlpha = 1;
    let passBlur = 0;
    let tint: Tint = 0;
    let sc = fx.scale;
    let rot = fx.rot;
    let flip = 1;
    let px = ox;
    let py = oy;
    if (pass) {
      if (pass.alpha <= 0.004) return;
      if (pass.dt !== 0) {
        if (realT + pass.dt < 0) return; // まだ出ていない時刻の姿は描かない
        L.t = realT + pass.dt;
      }
      passAlpha = pass.alpha;
      passBlur = pass.blur;
      tint = pass.tint;
      sc *= pass.scale;
      rot += pass.rot;
      flip = pass.flipY ? -1 : 1;
      px += pass.dx;
      py += pass.dy;
    }
    this.cur.tint = tint;

    // 行の中心を基準に、寄り・回転（カメラの動き）と、写しのずれをかける
    const cos = Math.cos(rot) * sc * ps;
    const sin = Math.sin(rot) * sc * ps;
    const ma = cos;
    const mb = sin;
    const mc = -sin * flip;
    const md = cos * flip;
    const me = px * ps;
    const mf = py * ps;

    ctx.globalCompositeOperation = tint === 0 ? 'source-over' : 'lighter';

    for (const c of block.chars) {
      preset.state(c, L, s);
      for (let i = 0; i < effs.length; i++) effs[i].state?.(c, L, s, amts[i]);
      const alpha = Math.min(1, s.alpha) * passAlpha;
      if (alpha <= 0.004) continue;
      const level = Math.round(clamp01(Math.max(s.blur, passBlur)) * BLUR_LEVELS);
      const sprite = this.sprite(c.ch, lay.em, swatch, bright, level, tint);
      ctx.setTransform(ma, mb, mc, md, me, mf);
      ctx.translate(c.x + s.dx, c.y + s.dy + s.originY * lay.em);
      if (s.rot !== 0) ctx.rotate(s.rot);
      if (s.sx !== 1 || s.sy !== 1) ctx.scale(s.sx, s.sy);
      if (s.originY !== 0) ctx.translate(0, -s.originY * lay.em);
      ctx.globalAlpha = alpha;

      // 文字の切り方を変える効果は、後ろに重ねたものから順に試す。どれも該当しなければ通常どおり描く
      let done = false;
      for (let i = effs.length - 1; i >= 0 && !done; i--) {
        const e = effs[i];
        if (e.draw) done = e.draw(ctx, sprite, c, L, s, amts[i], this.tools);
      }
      if (!done && preset.draw) done = preset.draw(ctx, sprite, c, L, s);
      if (!done) ctx.drawImage(sprite.canvas, -sprite.w / 2, -sprite.h / 2, sprite.w, sprite.h);
    }
    L.t = realT;
  }

  /** 火の粉・塵・滴。layer 0 は文字の後ろ、1 は文字の前に描く */
  private drawParticles(ctx: DrawCtx, L: LineCtx, preset: Preset, line: LineItem, ox: number, oy: number, layer: number, boost: number): void {
    const style = this.theme.particles;
    const count = Math.min(MAX_PARTICLES, Math.round(style.count * preset.particles * (0.4 + line.strength * 1.2) * boost));
    if (count <= 0) return;
    const envelope = clamp01(L.t / 0.35) * clamp01((L.dur - L.t) / 0.45);
    if (envelope <= 0.01) return;
    const ps = this.pixelScale;
    const em = L.em;
    ctx.setTransform(ps, 0, 0, ps, 0, 0);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = layer; i < count; i += 2) {
      const seed = L.seed + i * 131;
      const period = 1.1 + hash(seed, 1) * 1.9;
      const pos = L.t / period + hash(seed, 2);
      const cycle = Math.floor(pos);
      const ph = pos - cycle;
      const cs = seed + cycle * 977;
      let x = (hash(cs, 3) - 0.5) * (L.width + em * 2.4);
      let y = (hash(cs, 4) - 0.5) * (L.height + em * 0.8);
      let sy = 1;
      const size = style.size * em * (0.5 + hash(cs, 5) * 1.1);

      if (style.kind === 'spark') {
        y -= ph * (0.8 + hash(cs, 6) * 1.6) * em;
        x += Math.sin(ph * 7 + hash(cs, 7) * 6.28) * 0.18 * em + ph * (hash(cs, 8) - 0.5) * em * 0.6;
      } else if (style.kind === 'dust') {
        const a = hash(cs, 6) * 6.28;
        x += Math.cos(a + ph * 1.5) * 0.35 * em * ph;
        y += Math.sin(a + ph * 1.5) * 0.25 * em * ph - ph * 0.15 * em;
      } else {
        y += L.height * 0.25 + ph * ph * (1.2 + hash(cs, 6) * 1.4) * em;
        sy = 1 + ph * 1.8;
      }

      const alpha = Math.pow(Math.sin(Math.PI * ph), 1.4) * envelope * (0.45 + hash(cs, 9) * 0.55);
      if (alpha <= 0.02) continue;
      const color = style.colors[Math.floor(hash(seed, 10) * style.colors.length) % style.colors.length];
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.dot(color), ox + x - size, oy + y - size * sy, size * 2, size * 2 * sy);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
