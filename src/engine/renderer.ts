// 歌詞を描く本体。プレビューと書き出しで、必ずこの同じ Renderer を使う（CLAUDE.md の決まり）。
//
// しくみ：
//   1. 行ごとに、文字の置き場所を計算しておく（行の文面や位置が変わったときだけ計算し直す）
//   2. 1文字ずつの絵（縁取り・発光・影つき）を先に描いて取っておく
//   3. 毎コマ、プリセットが決めた位置・大きさ・濃さで、取っておいた絵を貼るだけにする
// 3 が軽いので、スマホでも書き出しが遅くならない。

import { isLine, type LineItem, type Position, type Project } from '../core/model';
import type { Layout } from '../layout';
import { fontString } from './fonts';
import { getPreset } from './presets';
import type { BeatInfo, CharBox, CharState, LineCtx, LineFx, Preset, Sprite } from './presets/types';
import { getTheme, type Swatch, type Theme } from './themes';
import { clamp01, hash, hashString } from './util';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const MEASURE_PX = 100;
const LETTER_SPACING = 0.05; // 文字の大きさに対する字間
const ROW_HEIGHT = 1.28; // 行の高さ
const BLUR_LEVELS = 4;
const MAX_SPRITES = 480;

/** 行（またはフレーズ1つ）ぶんの、文字の置き場所 */
interface Block {
  chars: CharBox[];
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

export class Renderer {
  private project: Project | null = null;
  private theme: Theme = getTheme('');
  private styleSig = '';
  private layouts = new Map<string, LineLayout>();
  private sprites = new Map<string, Sprite>();
  private dots = new Map<string, HTMLCanvasElement>();
  private measureCtx: CanvasRenderingContext2D;
  private widthCache = new Map<string, number>();
  private state: CharState = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, alpha: 1, blur: 0, originY: 0 };
  private fx: LineFx = { shakeX: 0, shakeY: 0, flash: 0 };
  private canBlur: boolean;
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
    return { chars: out, width, height, from: 0, to: 1 };
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

  private sprite(ch: string, em: number, swatchIndex: number, bright: number, blurLevel: number): Sprite {
    const ps = this.pixelScale;
    const px = Math.max(4, Math.round(em * ps));
    const key = `${ch}|${px}|${swatchIndex}|${bright}|${blurLevel}`;
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

    let canvas = sharp;
    if (blurLevel > 0 && this.canBlur) {
      canvas = makeCanvas(w, h);
      const b = canvas.getContext('2d')!;
      b.filter = `blur(${blurPx.toFixed(2)}px)`;
      b.drawImage(sharp, 0, 0);
    }

    const sprite: Sprite = { canvas, w: w / ps, h: h / ps };
    this.sprites.set(key, sprite);
    if (this.sprites.size > MAX_SPRITES) this.sprites.delete(this.sprites.keys().next().value!);
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

  // ---- 毎コマの描画 --------------------------------------------------------

  private beatAt(t: number): BeatInfo {
    const p = this.project!;
    const { beatLen, barBeats } = beatGrid(p);
    const pos = (t - p.beat.offset) / beatLen;
    const beatNo = Math.floor(pos);
    const barLen = beatLen * barBeats;
    const inBar = ((pos % barBeats) + barBeats) % barBeats;
    return {
      sinceBeat: (pos - beatNo) * beatLen,
      sinceBar: inBar * beatLen,
      beatLen,
      barLen,
      beatNo,
      strong: Math.floor(inBar + 1e-6) === 0,
    };
  }

  /** 時刻 t（秒）の歌詞を描く。映像はすでに描いてある前提で、その上に重ねる */
  draw(ctx: Ctx, t: number): void {
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

  private drawLine(ctx: Ctx, line: LineItem, t: number, beat: BeatInfo): void {
    const p = this.project!;
    const preset = getPreset(line.preset);
    const lay = this.layoutLine(line, preset);
    const lineDur = Math.max(0.05, line.end - line.start);
    const frac = (t - line.start) / lineDur;
    const swatch = line.color ?? (p.autoColor ? line.auto?.color : undefined) ?? 0;
    const bright = Math.round(clamp01(line.auto?.bright ?? 0) * 2);
    const ps = this.pixelScale;

    for (let bi = 0; bi < lay.blocks.length; bi++) {
      const block = lay.blocks[bi];
      if (frac < block.from || frac >= block.to) continue;
      const dur = Math.max(0.05, (block.to - block.from) * lineDur);
      const L: LineCtx = {
        t: (frac - block.from) * lineDur,
        dur,
        k: 0.35 + 1.3 * line.strength,
        sp: Math.pow(2, 1 - 2 * line.speed),
        em: lay.em,
        width: block.width,
        height: block.height,
        n: block.chars.length,
        seed: (lay.seed + bi * 101) | 0,
        beat,
      };
      const fx = this.fx;
      fx.shakeX = 0;
      fx.shakeY = 0;
      fx.flash = 0;
      preset.fx(L, fx);
      const ox = lay.cx + fx.shakeX;
      const oy = lay.cy + fx.shakeY;

      this.drawParticles(ctx, L, preset, line, ox, oy, 0);

      const s = this.state;
      for (const c of block.chars) {
        preset.state(c, L, s);
        if (s.alpha <= 0.004) continue;
        const level = Math.round(clamp01(s.blur) * BLUR_LEVELS);
        const sprite = this.sprite(c.ch, lay.em, swatch, bright, level);
        ctx.setTransform(ps, 0, 0, ps, 0, 0);
        ctx.translate(ox + c.x + s.dx, oy + c.y + s.dy + s.originY * lay.em);
        if (s.rot !== 0) ctx.rotate(s.rot);
        if (s.sx !== 1 || s.sy !== 1) ctx.scale(s.sx, s.sy);
        if (s.originY !== 0) ctx.translate(0, -s.originY * lay.em);
        ctx.globalAlpha = Math.min(1, s.alpha);
        if (preset.draw && preset.draw(ctx, sprite, c, L, s)) continue;
        ctx.drawImage(sprite.canvas, -sprite.w / 2, -sprite.h / 2, sprite.w, sprite.h);
      }

      this.drawParticles(ctx, L, preset, line, ox, oy, 1);

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
    }
  }

  /** 火の粉・塵・滴。layer 0 は文字の後ろ、1 は文字の前に描く */
  private drawParticles(ctx: Ctx, L: LineCtx, preset: Preset, line: LineItem, ox: number, oy: number, layer: number): void {
    const style = this.theme.particles;
    const count = Math.round(style.count * preset.particles * (0.4 + line.strength * 1.2));
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
