// 自動配色（仕様書6章）。
//   行ごとに、その行が出ている間の映像を数コマ調べ、文字を置く位置の明るさと主な色を取る。
//   テーマの配色の中から、その映像の上で最も目立つ色を選ぶ。色を自由には作らない（世界観を崩さないため）。
//   映像が明るい場面ほど、縁取りと影を濃くする。

import { BlobSource, CanvasSink, Input, MP4 } from 'mediabunny';
import { linesOf, type LineItem, type Position, type Project } from '../core/model';
import { getTheme, hexToRgb, luminance, type Theme } from '../engine/themes';

const SAMPLE_WIDTH = 96;

function signature(p: Project, line: LineItem): string {
  return `${line.start.toFixed(1)}|${line.end.toFixed(1)}|${line.position ?? p.position}|${p.theme}|${p.output.shape}`;
}

/** 文字を置く位置にあたる、映像の中の範囲（0〜1） */
function regionOf(position: Position): { y0: number; y1: number } | null {
  switch (position) {
    case 'top':
      return { y0: 0.06, y1: 0.36 };
    case 'middle':
      return { y0: 0.34, y1: 0.66 };
    case 'bottom':
      return { y0: 0.64, y1: 0.94 };
    default:
      return null; // 帯は黒一色なので調べない
  }
}

function chooseSwatch(theme: Theme, bg: [number, number, number]): number {
  const bgLum = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
  let best = 0;
  let bestScore = -Infinity;
  let leadScore = 0;
  theme.palette.forEach((sw, i) => {
    const a = hexToRgb(sw.fill[0]);
    const b = hexToRgb(sw.fill[1]);
    const fill: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const fillLum = (luminance(sw.fill[0]) + luminance(sw.fill[1])) / 2;
    const colorDist = Math.hypot(fill[0] - bg[0], fill[1] - bg[1], fill[2] - bg[2]) / 441;
    // 明るさの差を最も重く見る
    const score = Math.abs(fillLum - bgLum) * 1.0 + colorDist * 0.4;
    if (i === 0) leadScore = score;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  // 配色の先頭（テーマの主役の色）で十分に目立つなら、それを使う。
  // 場面ごとに色がころころ変わるのを防ぎ、世界観を保つため。
  return leadScore >= 0.55 || leadScore >= bestScore - 0.12 ? 0 : best;
}

export interface AutoColorJob {
  cancel(): void;
  done: Promise<void>;
}

/**
 * まだ調べていない行（時間や位置が変わった行）の配色を決める。
 * 行が1つ決まるたびに onUpdate を呼ぶ。
 */
export function runAutoColor(
  p: Project,
  file: File,
  onUpdate: (doneCount: number, total: number) => void,
): AutoColorJob {
  let canceled = false;
  const theme = getTheme(p.theme);

  const run = async (): Promise<void> => {
    const targets: LineItem[] = [];
    for (const line of linesOf(p)) {
      const sig = signature(p, line);
      if (line.auto?.sig === sig) continue;
      const position = line.position ?? p.position;
      const hasBand = p.output.shape === 'portrait-fit';
      if (!regionOf(position) && hasBand) {
        line.auto = { color: 0, bright: 0, sig }; // 帯の上は黒地。主役の色をそのまま使う
        continue;
      }
      targets.push(line);
    }
    if (targets.length === 0) {
      onUpdate(0, 0);
      return;
    }

    const input = new Input({ formats: [MP4], source: new BlobSource(file) });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) return;
      const sink = new CanvasSink(track, { width: SAMPLE_WIDTH });
      let done = 0;
      for (const line of targets) {
        if (canceled) return;
        const position = line.position ?? p.position;
        const region =
          regionOf(position) ?? regionOf(position === 'band-top' ? 'top' : 'bottom') ?? { y0: 0.34, y1: 0.66 };
        const len = line.end - line.start;
        const times = [line.start + len * 0.2, line.start + len * 0.7];
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for await (const wrapped of sink.canvasesAtTimestamps(times)) {
          if (canceled) return;
          if (!wrapped) continue;
          const c = wrapped.canvas;
          const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          if (!ctx) continue;
          const y0 = Math.floor(c.height * region.y0);
          const hgt = Math.max(1, Math.floor(c.height * (region.y1 - region.y0)));
          const x0 = Math.floor(c.width * 0.08);
          const wid = Math.max(1, Math.floor(c.width * 0.84));
          const data = ctx.getImageData(x0, y0, wid, hgt).data;
          for (let i = 0; i < data.length; i += 16) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }
        }
        if (count > 0) {
          const bg: [number, number, number] = [r / count, g / count, b / count];
          const bgLum = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
          line.auto = {
            color: chooseSwatch(theme, bg),
            bright: Math.min(1, Math.max(0, (bgLum - 0.3) / 0.45)),
            sig: signature(p, line),
          };
        }
        done++;
        onUpdate(done, targets.length);
      }
    } finally {
      input.dispose();
    }
  };

  return {
    cancel: () => {
      canceled = true;
    },
    done: run().catch(() => undefined),
  };
}
