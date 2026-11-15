// タップ同期（仕様書3章）。曲を再生し、その行が歌われている間だけ画面を押さえる。
//   押した瞬間が行の開始、離した瞬間が終了になる。
//   指を離している間は何も表示されないので、イントロや間奏は「押さないでおく」だけで空く。

import { linesOf, lineText, resolveOverlaps, snapToBeat, type Project } from '../../core/model';
import { formatClock, h } from '../dom';
import type { Player } from '../player';
import { app } from '../state';

export function openTapSync(player: Player, startIndex: number, onClose: () => void): void {
  const p = app.project as Project;
  const lines = linesOf(p);
  if (lines.length === 0) return;
  const first = Math.min(Math.max(0, startIndex), lines.length - 1);
  const records = new Map<string, { start: number; end: number }>();
  let index = first;
  let holding = false;
  let holdStart = 0;
  let closed = false;

  const nowText = h('div', { class: 'tap-now' });
  const nextText = h('div', { class: 'tap-next' });
  const status = h('span', { class: 'tap-status' });
  const zone = h(
    'div',
    { class: 'tap-zone' },
    h('p', { class: 'tap-hint' }, '歌っている間だけ、画面を押さえてください'),
    nowText,
    nextText,
  );

  const startTimeFor = (i: number): number => {
    if (i <= 0) return 0;
    const prev = records.get(lines[i - 1].id) ?? lines[i - 1];
    return Math.max(0, prev.end - 2);
  };

  const render = (): void => {
    const cur = lines[index];
    nowText.textContent = cur ? lineText(cur) : '（最後まで合わせました）';
    nextText.textContent = lines[index + 1] ? `次：${lineText(lines[index + 1])}` : '';
    status.textContent = `${Math.min(index + 1, lines.length)} / ${lines.length} 行　${formatClock(player.time)}`;
    zone.classList.toggle('holding', holding);
  };

  const down = (): void => {
    if (holding || index >= lines.length) return;
    holding = true;
    holdStart = player.time;
    if (!player.playing) player.play();
    render();
  };
  const up = (): void => {
    if (!holding) return;
    holding = false;
    const end = player.time;
    records.set(lines[index].id, { start: holdStart, end: Math.max(end, holdStart + 0.15) });
    index++;
    render();
    if (index >= lines.length) finish(true);
  };

  const back = (): void => {
    holding = false;
    if (index > first) index--;
    records.delete(lines[index].id);
    player.seek(startTimeFor(index));
    player.play();
    render();
  };

  const finish = (apply: boolean): void => {
    if (closed) return;
    closed = true;
    player.pause();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.clearInterval(timer);
    overlay.remove();
    if (apply && records.size > 0) {
      for (const line of lines) {
        const r = records.get(line.id);
        if (!r) continue;
        line.start = p.snap ? snapToBeat(p, r.start) : Math.round(r.start * 100) / 100;
        line.end = p.snap ? snapToBeat(p, r.end) : Math.round(r.end * 100) / 100;
        if (line.end < line.start + 0.15) line.end = line.start + 0.15;
      }
      resolveOverlaps(p);
      app.commit();
    }
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      down();
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      e.preventDefault();
      up();
    }
  };

  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    zone.setPointerCapture(e.pointerId);
    down();
  });
  zone.addEventListener('pointerup', up);
  zone.addEventListener('pointercancel', up);
  zone.addEventListener('contextmenu', (e) => e.preventDefault());

  const overlay = h(
    'div',
    { class: 'tap-overlay' },
    h(
      'div',
      { class: 'tap-bar' },
      h('button', { class: 'btn small', onclick: () => finish(false) }, 'やめる'),
      status,
      h('button', { class: 'btn small', onclick: back }, '1行戻る'),
      h('button', { class: 'btn small primary', onclick: () => finish(true) }, '完了'),
    ),
    zone,
  );
  document.body.appendChild(overlay);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  const timer = window.setInterval(render, 250);

  player.setLoop(null);
  player.seek(startTimeFor(first));
  player.play();
  render();
}
