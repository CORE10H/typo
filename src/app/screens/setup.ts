// 取り込み画面（仕様書7章）。動画の選択、歌詞の貼り付け、出力の形、BPMと拍子、テーマ、待機区間。
// 「叩き台を作る」を押すと、全行に時間と動きを割り振って編集画面へ進む。

import { buildDraft } from '../../core/draft';
import { parseLyrics } from '../../core/lyrics';
import { TIME_SIGNATURES, linesOf, newId, waitsOf, type Project, type WaitItem } from '../../core/model';
import { THEMES } from '../../engine/themes';
import { ExportError } from '../../video/exporter';
import { clear, confirmDialog, errorText, formatClock, h, toast } from '../dom';
import { go } from '../router';
import { app } from '../state';
import { deleteProject } from '../store';
import { attachVideo, chooseVideoFile } from '../video';

function numberValue(input: HTMLInputElement, fallback: number): number {
  const n = parseFloat(input.value.replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

export function mountSetup(root: HTMLElement): () => void {
  const p = app.project as Project;
  const videoInfo = h('p', { class: 'note' });
  const shapeBox = h('div', { class: 'choices' });
  const themeBox = h('div', { class: 'choices' });
  const waitBox = h('div', { class: 'waits' });
  const actions = h('div', { class: 'row' });
  const errorBox = h('div', { class: 'box error', hidden: true });

  const showError = (message: string): void => {
    errorBox.textContent = message;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const titleInput = h('input', {
    type: 'text',
    value: p.title,
    placeholder: '曲名など',
    maxLength: 80,
    onchange: () => {
      p.title = titleInput.value.trim();
      app.commit();
    },
  });

  const lyricsInput = h('textarea', {
    rows: 10,
    value: p.lyrics,
    placeholder: '歌詞をここに貼り付け\n\n改行で1行、空行で区間が分かれます',
    onchange: () => {
      p.lyrics = lyricsInput.value;
      app.commit();
    },
  });

  // ---- 動画 ----
  const pickVideo = async (): Promise<void> => {
    const file = await chooseVideoFile();
    if (!file) return;
    errorBox.hidden = true;
    videoInfo.textContent = '動画を読み込んでいます…';
    try {
      await attachVideo(file);
      titleInput.value = p.title;
    } catch (e) {
      showError(e instanceof ExportError ? e.message : `動画を読み込めませんでした。（${errorText(e)}）`);
    }
    render();
  };

  // ---- BPM ----
  const bpmInput = h('input', {
    type: 'text',
    inputMode: 'decimal',
    value: String(p.beat.bpm),
    class: 'num',
    onchange: () => {
      p.beat.bpm = Math.min(400, Math.max(20, numberValue(bpmInput, p.beat.bpm)));
      bpmInput.value = String(p.beat.bpm);
      app.commit();
    },
  });
  let taps: number[] = [];
  const tapButton = h(
    'button',
    {
      class: 'btn tap',
      onpointerdown: (e: Event) => {
        e.preventDefault();
        const now = performance.now();
        if (taps.length > 0 && now - taps[taps.length - 1] > 2500) taps = [];
        taps.push(now);
        if (taps.length > 8) taps.shift();
        if (taps.length >= 3) {
          const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
          p.beat.bpm = Math.round((60000 / avg) * 10) / 10;
          bpmInput.value = String(p.beat.bpm);
          app.commit();
        }
        tapButton.textContent = taps.length < 3 ? `TAP（あと${3 - taps.length}回）` : 'TAP';
      },
    },
    'TAP',
  );
  const signature = h(
    'select',
    {
      onchange: () => {
        const s = TIME_SIGNATURES[signature.selectedIndex];
        p.beat.perBar = s.perBar;
        p.beat.unit = s.unit;
        app.commit();
      },
    },
    TIME_SIGNATURES.map((s) =>
      h('option', { selected: s.perBar === p.beat.perBar && s.unit === p.beat.unit }, s.label),
    ),
  );

  // ---- 待機区間 ----
  const renderWaits = (): void => {
    clear(waitBox);
    const waits = waitsOf(p);
    if (waits.length === 0) waitBox.append(h('p', { class: 'note' }, '待機区間はありません。'));
    for (const w of waits) {
      const field = (key: 'start' | 'end'): HTMLInputElement => {
        const input = h('input', {
          type: 'text',
          inputMode: 'decimal',
          class: 'num',
          value: String(w[key]),
          'aria-label': key === 'start' ? '開始（秒）' : '終了（秒）',
          onchange: () => {
            const max = p.video.duration > 0 ? p.video.duration : 600;
            w[key] = Math.min(max, Math.max(0, Math.round(numberValue(input, w[key]) * 100) / 100));
            if (w.end < w.start) [w.start, w.end] = [w.end, w.start];
            app.commit();
            renderWaits();
          },
        });
        return input;
      };
      const label = h('input', {
        type: 'text',
        value: w.label,
        placeholder: 'イントロなど',
        maxLength: 20,
        onchange: () => {
          w.label = label.value.trim();
          app.commit();
        },
      });
      waitBox.append(
        h(
          'div',
          { class: 'wait' },
          field('start'),
          h('span', null, '秒〜'),
          field('end'),
          h('span', null, '秒'),
          label,
          h(
            'button',
            {
              class: 'btn small danger-text',
              'aria-label': 'この待機区間を消す',
              onclick: () => {
                p.items = p.items.filter((i) => i !== w);
                app.commit();
                renderWaits();
              },
            },
            '消す',
          ),
        ),
      );
    }
  };
  const addWait = (): void => {
    const waits = waitsOf(p);
    const last = waits[waits.length - 1];
    const start = last ? Math.min(last.end + 30, Math.max(0, (p.video.duration || 180) - 10)) : 0;
    const w: WaitItem = { type: 'wait', id: newId('w'), start, end: start + 10, label: last ? '間奏' : 'イントロ' };
    p.items.push(w);
    app.commit();
    renderWaits();
  };

  // ---- 叩き台 ----
  const makeDraft = async (): Promise<void> => {
    errorBox.hidden = true;
    p.lyrics = lyricsInput.value;
    p.title = titleInput.value.trim();
    const parsed = parseLyrics(p.lyrics);
    if (parsed.length === 0) {
      showError('歌詞が入っていません。歌詞を貼り付けてから押してください。');
      return;
    }
    if (parsed.length > 400) {
      showError(`歌詞が ${parsed.length} 行あります。400行までにしてください。`);
      return;
    }
    if (linesOf(p).length > 0) {
      const ok = await confirmDialog(
        '叩き台を作り直すと、いま合わせてあるタイミングや動きの設定がすべて作り直されます。（「元に戻す」で戻せます）',
        '作り直す',
      );
      if (!ok) return;
    }
    buildDraft(p, parsed);
    app.commit();
    if (!app.video) toast('動画を選ぶと、映像の上で確かめられます');
    go('edit', p.id);
  };

  const render = (): void => {
    const v = app.video;
    if (v) {
      videoInfo.textContent = `${v.info.fileName}（${v.info.width}×${v.info.height}、${formatClock(v.info.duration)}）`;
    } else if (p.video.name) {
      videoInfo.textContent = `前回の動画：${p.video.name}（${formatClock(p.video.duration)}）。開き直したので、もう一度選んでください。`;
    } else {
      videoInfo.textContent = '曲の入った mp4 動画（480p・720p・1080p、5分まで）を選んでください。';
    }

    const portraitSource = p.video.height > p.video.width;
    clear(shapeBox);
    const shapes: { value: Project['output']['shape']; label: string; sub: string }[] = [
      { value: 'landscape', label: '横のまま', sub: '元の動画と同じ形' },
      { value: 'portrait-fit', label: '縦にはめ込み', sub: '9:16 の枠。上下は黒地' },
    ];
    for (const s of shapes) {
      const disabled = s.value === 'portrait-fit' && portraitSource;
      shapeBox.append(
        h(
          'button',
          {
            class: `choice ${p.output.shape === s.value ? 'on' : ''}`,
            disabled,
            'aria-pressed': String(p.output.shape === s.value),
            onclick: () => {
              p.output.shape = s.value;
              app.commit();
              render();
            },
          },
          h('strong', null, s.label),
          h('small', null, disabled ? '縦長の動画では選べません' : s.sub),
        ),
      );
    }

    clear(themeBox);
    for (const t of THEMES) {
      themeBox.append(
        h(
          'button',
          {
            class: `choice ${p.theme === t.id ? 'on' : ''}`,
            'aria-pressed': String(p.theme === t.id),
            onclick: () => {
              p.theme = t.id;
              app.commit();
              render();
            },
          },
          h('span', {
            class: 'swatch',
            style: `background:linear-gradient(${t.palette[0].fill[0]},${t.palette[0].fill[1]});border-color:${t.palette[0].glow}`,
          }),
          h('strong', null, t.name),
          h('small', null, t.description),
        ),
      );
    }

    clear(actions);
    const hasLines = linesOf(p).length > 0;
    actions.append(
      h('button', { class: 'btn primary wide', onclick: () => void makeDraft() }, hasLines ? '叩き台を作り直す' : '叩き台を作る'),
      hasLines ? h('button', { class: 'btn wide', onclick: () => go('edit', p.id) }, '編集へ進む（今のまま）') : '',
    );
  };

  root.append(
    h(
      'div',
      { class: 'page' },
      h(
        'header',
        { class: 'bar' },
        h('button', { class: 'btn small', onclick: () => go('list') }, '← 一覧'),
        h('h1', null, '取り込み'),
      ),
      h('label', { class: 'field' }, h('span', null, '題名'), titleInput),
      h('h2', null, '1. 動画'),
      h('button', { class: 'btn', onclick: () => void pickVideo() }, 'mp4 動画を選ぶ'),
      videoInfo,
      h('h2', null, '2. 歌詞'),
      lyricsInput,
      h(
        'p',
        { class: 'note' },
        '改行で1行、空行で区間（Aメロ、サビなど）に分かれます。行の中の空白や「/」はフレーズの区切りです。区間に名前を付けるときは、区間の前に【サビ】のように書きます。',
      ),
      h('h2', null, '3. 出力の形'),
      shapeBox,
      h('h2', null, '4. テーマ'),
      themeBox,
      h('h2', null, '5. 拍'),
      h(
        'div',
        { class: 'row middle' },
        h('label', { class: 'field inline' }, h('span', null, 'BPM'), bpmInput),
        tapButton,
        h('label', { class: 'field inline' }, h('span', null, '拍子'), signature),
      ),
      h('p', { class: 'note' }, 'BPM がわからないときは、曲を聴きながら拍に合わせて TAP を押してください。あとから直せます。'),
      h('h2', null, '6. 待機区間（歌詞を出さない時間）'),
      waitBox,
      h('button', { class: 'btn small', onclick: addWait }, '＋ 待機区間を足す'),
      h('p', { class: 'note' }, 'イントロや間奏を入れておくと、叩き台がその時間を避けて歌詞を並べます。'),
      errorBox,
      actions,
    ),
  );
  renderWaits();
  render();

  return () => {
    // 何も入れずに戻った空の作品は、一覧に残さない
    const empty = !p.title && !p.lyrics.trim() && p.items.length === 0 && !p.video.name;
    if (empty && app.project === p) {
      app.close();
      void deleteProject(p.id).catch(() => undefined);
    }
  };
}
