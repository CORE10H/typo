// プレビュー再生。動画を1コマずつキャンバスに描き、その上に歌詞を重ねる。
// 歌詞は書き出しと同じ Renderer で描くので、プレビューと書き出し結果は同じ見た目になる。
// 動画をまだ選んでいないときは、背景色の上に歌詞だけを出す（時計は内蔵のものを使う）。

import type { Project } from '../core/model';
import { ensureThemeFont } from '../engine/fonts';
import { Renderer } from '../engine/renderer';
import { getTheme } from '../engine/themes';
import { computeLayout, type Layout } from '../layout';

/** プレビューの細かさ。画素数をこのくらいに抑えて、スマホでもなめらかに動かす */
const PREVIEW_PIXELS = 640 * 360;

export class Player {
  readonly video: HTMLVideoElement;
  private ctx: CanvasRenderingContext2D;
  private renderer: Renderer | null = null;
  private layout: Layout | null = null;
  private layoutSig = '';
  private project: Project | null = null;
  private raf = 0;
  private dirty = true;
  private hasVideo = false;
  private clock = 0; // 動画がないときの時計
  private clockPlaying = false;
  private lastTick = 0;
  private loop: { start: number; end: number } | null = null;
  private destroyed = false;

  /** 毎コマ呼ばれる（シークバーや再生位置の表示の更新に使う） */
  onTime: ((t: number) => void) | null = null;
  onPlayState: ((playing: boolean) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('プレビュー用のキャンバスを用意できませんでした');
    this.ctx = ctx;
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.className = 'player-video';
    canvas.insertAdjacentElement('afterend', this.video);
    this.video.addEventListener('play', () => this.onPlayState?.(true));
    this.video.addEventListener('pause', () => this.onPlayState?.(false));
    this.video.addEventListener('seeked', () => (this.dirty = true));
    this.video.addEventListener('loadeddata', () => (this.dirty = true));
    this.raf = requestAnimationFrame(this.tick);
  }

  setProject(p: Project): void {
    this.project = p;
    const sig = `${p.output.shape}|${p.video.width}|${p.video.height}`;
    if (sig !== this.layoutSig) {
      this.layoutSig = sig;
      this.layout = computeLayout(p.output.shape, p.video.width || 1920, p.video.height || 1080);
      const ps = Math.sqrt(PREVIEW_PIXELS / (this.layout.width * this.layout.height));
      this.canvas.width = Math.round(this.layout.width * ps);
      this.canvas.height = Math.round(this.layout.height * ps);
      this.renderer = new Renderer(this.layout, this.canvas.width / this.layout.width);
    }
    this.renderer!.setProject(p);
    const renderer = this.renderer!;
    void ensureThemeFont(getTheme(p.theme)).then(() => {
      if (this.destroyed || this.renderer !== renderer) return;
      if (!renderer.fontReady) {
        renderer.fontReady = true;
        renderer.invalidate();
      }
      this.dirty = true;
    });
    this.dirty = true;
  }

  setVideo(url: string | null): void {
    this.hasVideo = !!url;
    if (url) {
      if (this.video.src !== url) this.video.src = url;
    } else {
      this.video.removeAttribute('src');
      this.video.load();
    }
    this.clockPlaying = false;
    this.dirty = true;
  }

  get duration(): number {
    return this.project?.video.duration || (this.hasVideo ? this.video.duration || 0 : 0) || 180;
  }

  get time(): number {
    return this.hasVideo ? this.video.currentTime : this.clock;
  }

  get playing(): boolean {
    return this.hasVideo ? !this.video.paused && !this.video.ended : this.clockPlaying;
  }

  play(): void {
    if (this.hasVideo) {
      void this.video.play().catch(() => undefined);
    } else {
      this.clockPlaying = true;
      this.lastTick = performance.now();
      this.onPlayState?.(true);
    }
  }

  pause(): void {
    if (this.hasVideo) this.video.pause();
    else {
      this.clockPlaying = false;
      this.onPlayState?.(false);
    }
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number): void {
    const clamped = Math.max(0, Math.min(this.duration, t));
    if (this.hasVideo) this.video.currentTime = clamped;
    else this.clock = clamped;
    this.dirty = true;
  }

  /** 指定した範囲だけを繰り返し再生する。null で解除 */
  setLoop(range: { start: number; end: number } | null): void {
    this.loop = range;
  }

  /** 止まっているときに、今の位置を描き直す */
  refresh(): void {
    this.dirty = true;
  }

  private tick = (): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.tick);
    const now = performance.now();
    if (!this.hasVideo && this.clockPlaying) {
      this.clock += (now - this.lastTick) / 1000;
      if (this.clock >= this.duration) {
        this.clock = this.duration;
        this.clockPlaying = false;
        this.onPlayState?.(false);
      }
    }
    this.lastTick = now;

    const playing = this.playing;
    if (playing && this.loop && (this.time >= this.loop.end || this.time < this.loop.start - 0.05)) {
      this.seek(this.loop.start);
    }
    if (!playing && !this.dirty) return;
    this.dirty = false;
    this.paint();
    this.onTime?.(this.time);
  };

  private paint(): void {
    const { ctx, layout, renderer, project } = this;
    if (!layout || !renderer || !project) return;
    const ps = this.canvas.width / layout.width;
    const v = layout.video;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.hasVideo && this.video.readyState >= 2) {
      ctx.drawImage(this.video, v.x * ps, v.y * ps, v.width * ps, v.height * ps);
    } else {
      const theme = getTheme(project.theme);
      const grad = ctx.createLinearGradient(0, v.y * ps, 0, (v.y + v.height) * ps);
      grad.addColorStop(0, theme.backdrop[0]);
      grad.addColorStop(1, theme.backdrop[1]);
      ctx.fillStyle = grad;
      ctx.fillRect(v.x * ps, v.y * ps, v.width * ps, v.height * ps);
    }
    renderer.draw(ctx, this.time);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
  }
}
