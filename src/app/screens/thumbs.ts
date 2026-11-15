// プリセット一覧。名前ではなく、その行の歌詞で実際に動く小さな見本で並べる（仕様書7章）。

import type { LineItem, Project } from '../../core/model';
import { ensureThemeFont } from '../../engine/fonts';
import { PRESETS } from '../../engine/presets';
import { Renderer } from '../../engine/renderer';
import { getTheme } from '../../engine/themes';
import type { Layout } from '../../layout';
import { h } from '../dom';

const W = 480;
const H = 270;
const CANVAS_W = 168;
const LAYOUT: Layout = { shape: 'landscape', width: W, height: H, video: { x: 0, y: 0, width: W, height: H } };

interface Thumb {
  id: string;
  button: HTMLButtonElement;
  ctx: CanvasRenderingContext2D;
  renderer: Renderer;
}

export class PresetThumbs {
  readonly el: HTMLElement;
  private thumbs: Thumb[] = [];
  private raf = 0;
  private running = false;
  private startedAt = 0;
  private lastPaint = 0;
  private duration = 2.4;
  private backdrop: [string, string] = ['#222', '#000'];

  constructor(onPick: (presetId: string) => void) {
    this.el = h('div', { class: 'thumbs' });
    for (const preset of PRESETS) {
      const canvas = h('canvas', { width: CANVAS_W, height: Math.round((CANVAS_W * H) / W) });
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) continue;
      const button = h(
        'button',
        { class: 'thumb', title: preset.hint, onclick: () => onPick(preset.id) },
        canvas,
        h('span', null, preset.name),
      );
      this.thumbs.push({ id: preset.id, button, ctx, renderer: new Renderer(LAYOUT, CANVAS_W / W) });
      this.el.append(button);
    }
  }

  /** 見本に使う行を入れ替える */
  setLine(p: Project, line: LineItem): void {
    this.duration = Math.min(3.6, Math.max(1.8, line.end - line.start));
    const theme = getTheme(p.theme);
    this.backdrop = theme.backdrop;
    for (const t of this.thumbs) {
      const mini: Project = {
        ...p,
        output: { shape: 'landscape', band: 'black' },
        video: { name: '', duration: this.duration, width: W, height: H },
        position: 'middle',
        textScale: Math.min(2, p.textScale * 1.45),
        beat: { ...p.beat, offset: 0 },
        items: [
          {
            ...line,
            id: `thumb-${t.id}`,
            preset: t.id,
            start: 0,
            end: this.duration,
            position: null,
            phrases: line.phrases.slice(0, 2),
          },
        ],
      };
      t.renderer.setProject(mini);
      t.renderer.invalidate();
      t.button.classList.toggle('on', t.id === line.preset);
    }
    void ensureThemeFont(theme).then(() => {
      for (const t of this.thumbs) t.renderer.invalidate();
    });
    this.startedAt = performance.now();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const now = performance.now();
    if (now - this.lastPaint < 40) return; // 毎秒25コマほどで十分
    this.lastPaint = now;
    if (!this.el.isConnected || this.el.offsetParent === null) return;
    const t = ((now - this.startedAt) / 1000) % (this.duration + 0.5);
    for (const th of this.thumbs) {
      const { ctx } = th;
      const cw = ctx.canvas.width;
      const ch = ctx.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const grad = ctx.createLinearGradient(0, 0, 0, ch);
      grad.addColorStop(0, this.backdrop[0]);
      grad.addColorStop(1, this.backdrop[1]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, cw, ch);
      th.renderer.draw(ctx, t);
    }
  };
}
