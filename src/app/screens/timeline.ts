// 簡易タイムライン（仕様書3章・4章）。各行が時間軸の上に帯で並ぶ。帯は1段だけ。
//   帯を押すと選択。選んだ帯は、本体を引きずると移動、両端のつまみを引きずると開始・終了を直せる。
//   帯のない部分が、歌詞を出さない時間になる。

import { linesOf, lineText, resolveOverlaps, snapToBeat, waitsOf, type LineItem, type Project } from '../../core/model';
import { beatGrid } from '../../engine/renderer';
import { clear, formatClock, h } from '../dom';
import type { Player } from '../player';
import { app } from '../state';

const ZOOMS = [12, 24, 48, 96, 192]; // 1秒あたりのピクセル数
const MIN_LEN = 0.2;

export interface TimelineHost {
  player: Player;
  selectedId(): string | null;
  select(id: string | null, from: 'timeline'): void;
}

export class Timeline {
  readonly el: HTMLElement;
  private scroll: HTMLElement;
  private track: HTMLElement;
  private playhead: HTMLElement;
  private bars = new Map<string, HTMLElement>();
  private zoom = 2;
  private dragging = false;

  constructor(private host: TimelineHost) {
    this.playhead = h('div', { class: 'tl-playhead' });
    this.track = h('div', { class: 'tl-track', onclick: (e: MouseEvent) => this.onTrackClick(e) });
    this.scroll = h('div', { class: 'tl-scroll' }, this.track);
    const snap = h('input', {
      type: 'checkbox',
      checked: !!app.project?.snap,
      onchange: () => {
        if (!app.project) return;
        app.project.snap = snap.checked;
        app.commit();
      },
    });
    this.el = h(
      'div',
      { class: 'tl' },
      h(
        'div',
        { class: 'tl-tools' },
        h('button', { class: 'btn small', 'aria-label': '縮小', onclick: () => this.setZoom(this.zoom - 1) }, '－'),
        h('button', { class: 'btn small', 'aria-label': '拡大', onclick: () => this.setZoom(this.zoom + 1) }, '＋'),
        h('label', { class: 'check' }, snap, '拍に吸着'),
        h(
          'button',
          {
            class: 'btn small',
            title: '今の再生位置を、拍の頭（1拍目）として覚えます',
            onclick: () => {
              const p = app.project;
              if (!p) return;
              const { beatLen, barBeats } = beatGrid(p);
              const bar = beatLen * barBeats;
              p.beat.offset = Math.round((((host.player.time % bar) + bar) % bar) * 1000) / 1000;
              app.commit();
            },
          },
          '拍の頭を今の位置に',
        ),
      ),
      this.scroll,
    );
  }

  private get pps(): number {
    return ZOOMS[this.zoom];
  }

  private setZoom(z: number): void {
    const next = Math.min(ZOOMS.length - 1, Math.max(0, z));
    if (next === this.zoom) return;
    const center = (this.scroll.scrollLeft + this.scroll.clientWidth / 2) / this.pps;
    this.zoom = next;
    this.update();
    this.scroll.scrollLeft = center * this.pps - this.scroll.clientWidth / 2;
  }

  /** 作品の中身に合わせて、帯を作り直す */
  update(): void {
    const p = app.project;
    if (!p || this.dragging) return;
    const pps = this.pps;
    const duration = this.host.player.duration;
    const { beatLen, barBeats } = beatGrid(p);
    clear(this.track);
    this.bars.clear();
    this.track.style.width = `${Math.ceil(duration * pps) + 2}px`;
    // 拍と小節の目盛り
    const beatPx = beatLen * pps;
    const barPx = beatPx * barBeats;
    const offsetPx = p.beat.offset * pps;
    this.track.style.backgroundImage =
      beatPx >= 6
        ? `linear-gradient(90deg, var(--grid-strong) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)`
        : `linear-gradient(90deg, var(--grid-strong) 1px, transparent 1px)`;
    this.track.style.backgroundSize = beatPx >= 6 ? `${barPx}px 100%, ${beatPx}px 100%` : `${barPx}px 100%`;
    this.track.style.backgroundPosition = `${offsetPx}px 0, ${offsetPx}px 0`;

    // 秒の目盛り
    const step = pps >= 96 ? 1 : pps >= 48 ? 2 : pps >= 24 ? 5 : 10;
    for (let t = 0; t <= duration; t += step) {
      this.track.append(h('span', { class: 'tl-tick', style: `left:${t * pps}px` }, formatClock(t)));
    }
    for (const w of waitsOf(p)) {
      this.track.append(
        h(
          'div',
          { class: 'tl-wait', style: `left:${w.start * pps}px;width:${Math.max(2, (w.end - w.start) * pps)}px` },
          w.label || '待機',
        ),
      );
    }
    const selected = this.host.selectedId();
    for (const line of linesOf(p)) {
      const bar = h(
        'div',
        { class: `tl-bar ${line.id === selected ? 'sel' : ''} ${line.locked ? 'locked' : ''}`, 'data-id': line.id },
        h('span', { class: 'tl-label' }, lineText(line)),
      );
      if (line.id === selected) {
        bar.append(h('span', { class: 'tl-h l', 'data-edge': 'l' }), h('span', { class: 'tl-h r', 'data-edge': 'r' }));
        bar.addEventListener('pointerdown', (e) => this.startDrag(e, line, bar));
      }
      this.place(bar, line);
      this.bars.set(line.id, bar);
      this.track.append(bar);
    }
    this.track.append(this.playhead);
    this.setTime(this.host.player.time, false);
  }

  private place(bar: HTMLElement, line: LineItem): void {
    bar.style.left = `${line.start * this.pps}px`;
    bar.style.width = `${Math.max(4, (line.end - line.start) * this.pps)}px`;
  }

  /** 再生位置の線を動かす。再生中は線が見える範囲に入るよう、横に送る */
  setTime(t: number, follow: boolean): void {
    const x = t * this.pps;
    this.playhead.style.transform = `translateX(${x}px)`;
    if (follow && !this.dragging) {
      const left = this.scroll.scrollLeft;
      const width = this.scroll.clientWidth;
      if (x < left + 16 || x > left + width - 40) this.scroll.scrollLeft = Math.max(0, x - width * 0.25);
    }
  }

  /** 選んだ行の帯が見える位置へ送る */
  reveal(id: string): void {
    const p = app.project;
    const line = p && linesOf(p).find((l) => l.id === id);
    if (!line) return;
    const x = line.start * this.pps;
    const width = this.scroll.clientWidth;
    if (x < this.scroll.scrollLeft || x > this.scroll.scrollLeft + width - 60) {
      this.scroll.scrollLeft = Math.max(0, x - width * 0.2);
    }
  }

  private onTrackClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const bar = target.closest<HTMLElement>('.tl-bar');
    if (bar) {
      const id = bar.dataset.id ?? null;
      if (id && id !== this.host.selectedId()) this.host.select(id, 'timeline');
      return;
    }
    const rect = this.track.getBoundingClientRect();
    this.host.player.seek((e.clientX - rect.left) / this.pps);
  }

  private startDrag(e: PointerEvent, line: LineItem, bar: HTMLElement): void {
    const p = app.project as Project;
    const edge = (e.target as HTMLElement).dataset.edge as 'l' | 'r' | undefined;
    const lines = linesOf(p);
    const index = lines.indexOf(line);
    const min = index > 0 ? lines[index - 1].end : 0;
    const max = index < lines.length - 1 ? lines[index + 1].start : this.host.player.duration;
    const startX = e.clientX;
    const start0 = line.start;
    const end0 = line.end;
    const len = end0 - start0;
    let moved = false;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const snap = (t: number): number => (p.snap ? snapToBeat(p, t) : Math.round(t * 100) / 100);

    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 4) return;
      moved = true;
      this.dragging = true;
      const dt = dx / this.pps;
      if (edge === 'l') {
        line.start = Math.min(end0 - MIN_LEN, Math.max(min, snap(start0 + dt)));
      } else if (edge === 'r') {
        line.end = Math.max(start0 + MIN_LEN, Math.min(max, snap(end0 + dt)));
      } else {
        const s = Math.min(Math.max(min, max - len), Math.max(min, snap(start0 + dt)));
        line.start = s;
        line.end = Math.min(max, s + len);
      }
      this.place(bar, line);
      this.host.player.refresh();
      app.emit('live');
    };
    const onUp = (): void => {
      bar.removeEventListener('pointermove', onMove);
      bar.removeEventListener('pointerup', onUp);
      bar.removeEventListener('pointercancel', onUp);
      this.dragging = false;
      if (moved) {
        resolveOverlaps(p);
        app.commit();
      }
    };
    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerup', onUp);
    bar.addEventListener('pointercancel', onUp);
  }
}
