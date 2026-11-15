// 書き出し画面（仕様書7章）。進捗バー、残り時間の目安、中止、保存、共有。
// 歌詞はプレビューと同じ Renderer で描く。

import type { Project } from '../../core/model';
import { ensureThemeFont } from '../../engine/fonts';
import { Renderer } from '../../engine/renderer';
import { getTheme } from '../../engine/themes';
import { computeLayout } from '../../layout';
import {
  ExportCanceled,
  ExportError,
  checkBrowserSupport,
  clearPreviousOutput,
  startExport,
  type ExportHandle,
  type VideoInfo,
} from '../../video/exporter';
import { clear, confirmDialog, errorText, formatDuration, formatSize, h, toast } from '../dom';
import { go } from '../router';
import { app } from '../state';
import { attachVideo, chooseVideoFile } from '../video';

/** 圧縮の細かさ。解像度に見合った値にして、ファイルが大きくなりすぎないようにする */
function chooseBitrate(info: VideoInfo): number {
  const pixels = info.width * info.height;
  const target = pixels >= 1_900_000 ? 10_000_000 : pixels >= 850_000 ? 6_000_000 : 3_500_000;
  const source = info.videoBitrate ?? target;
  return Math.round(Math.min(target, Math.max(source, target * 0.5)));
}

function explain(e: unknown, stage: string): string {
  if (e instanceof ExportError) return e.message;
  const name = e instanceof Error ? e.name : '';
  const where = stage ? `「${stage}」の途中で失敗しました。` : '失敗しました。';
  if (name === 'QuotaExceededError') {
    return `${where}端末の空き容量が足りません。不要なファイルを消してから、もう一度試してください。`;
  }
  if (name === 'EncodingError' || name === 'NotSupportedError' || name === 'OperationError') {
    return `${where}動画の圧縮を、この端末のブラウザが受け付けませんでした。ほかのアプリを閉じてから、もう一度試してください。（${errorText(e)}）`;
  }
  return `${where}（${errorText(e)}）`;
}

export function mountExport(root: HTMLElement): () => void {
  const p = app.project as Project;
  let shape: Project['output']['shape'] = p.output.shape;
  let running: ExportHandle | null = null;
  let resultUrl: string | null = null;
  let resultFile: File | null = null;
  let wakeLock: WakeLockSentinel | null = null;
  let timer = 0;
  let stage = '';

  const shapeBox = h('div', { class: 'choices' });
  const videoNote = h('p', { class: 'note' });
  const startBtn = h('button', { class: 'btn primary wide', onclick: () => void start() }, '書き出しを始める');
  const cancelBtn = h('button', { class: 'btn wide', hidden: true, onclick: () => void cancel() }, '中止する');
  const errorBox = h('div', { class: 'box error', hidden: true });
  const fill = h('div', { class: 'bar-fill' });
  const percent = h('span', null, '0');
  const elapsedEl = h('dd', null, '0秒');
  const remainEl = h('dd', null, '計算中');
  const stageEl = h('dd', null, '-');
  const preview = h('canvas', { class: 'export-preview', width: 320, height: 180 });
  const progressBox = h(
    'div',
    { class: 'box', hidden: true },
    h('div', { class: 'progress' }, fill),
    h('p', { class: 'big' }, percent, '%'),
    h('dl', { class: 'info' }, h('dt', null, '経過時間'), elapsedEl, h('dt', null, '残りの目安'), remainEl, h('dt', null, '今の作業'), stageEl),
    preview,
  );
  const resultBox = h('section', { hidden: true });
  const support = checkBrowserSupport();

  const acquireWakeLock = async (): Promise<void> => {
    try {
      wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      toast('画面を点けたままにする設定ができませんでした。画面が消えないようにしてください');
    }
  };
  const onVisibility = (): void => {
    if (running && document.visibilityState === 'visible') void acquireWakeLock();
  };
  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (running) e.preventDefault();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('beforeunload', onBeforeUnload);

  const render = (): void => {
    const v = app.video;
    videoNote.textContent = v
      ? `${v.info.fileName}（${v.info.width}×${v.info.height}、${formatDuration(v.info.duration)}）`
      : `動画「${p.video.name || '未選択'}」を選び直してください。書き出しには元の動画が必要です。`;
    const portraitSource = p.video.height > p.video.width;
    clear(shapeBox);
    const options: { value: Project['output']['shape']; label: string }[] = [
      { value: 'landscape', label: '横のまま' },
      { value: 'portrait-fit', label: '縦にはめ込み' },
    ];
    for (const o of options) {
      const layout = computeLayout(o.value, p.video.width || 1920, p.video.height || 1080);
      const disabled = !!running || (o.value === 'portrait-fit' && portraitSource);
      shapeBox.append(
        h(
          'button',
          {
            class: `choice ${shape === o.value ? 'on' : ''}`,
            disabled,
            'aria-pressed': String(shape === o.value),
            onclick: () => {
              shape = o.value;
              render();
            },
          },
          h('strong', null, o.label),
          h('small', null, `${layout.width}×${layout.height}`),
        ),
      );
    }
    startBtn.disabled = !!running || !v || support.length > 0;
    startBtn.hidden = !!running;
    cancelBtn.hidden = !running;
  };

  const resetResult = (): void => {
    resultBox.hidden = true;
    clear(resultBox);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null;
    resultFile = null;
  };

  async function pickVideo(): Promise<void> {
    const file = await chooseVideoFile();
    if (!file) return;
    try {
      await attachVideo(file);
    } catch (e) {
      toast(e instanceof ExportError ? e.message : `動画を読み込めませんでした。（${errorText(e)}）`, 'error');
    }
    render();
  }

  async function start(): Promise<void> {
    const v = app.video;
    if (running || !v) return; // 二重実行の防止
    app.flush();
    errorBox.hidden = true;
    resetResult();
    await clearPreviousOutput();

    // 書き出し中に編集内容が変わっても影響しないよう、今の状態を写し取って使う
    const snapshot: Project = JSON.parse(JSON.stringify(p));
    const layout = computeLayout(shape, v.info.width, v.info.height);
    const renderer = new Renderer(layout, 1);
    stage = '書体の読み込み';
    await ensureThemeFont(getTheme(snapshot.theme));
    renderer.setProject(snapshot);

    progressBox.hidden = false;
    fill.style.width = '0%';
    percent.textContent = '0';
    remainEl.textContent = '計算中';
    preview.width = 320;
    preview.height = Math.round((320 * layout.height) / layout.width);
    const previewCtx = preview.getContext('2d');
    const startedAt = performance.now();
    let progress = 0;
    let lastPreview = 0;
    timer = window.setInterval(() => {
      const sec = (performance.now() - startedAt) / 1000;
      elapsedEl.textContent = formatDuration(sec);
      if (progress > 0.02 && progress < 1) remainEl.textContent = `約 ${formatDuration((sec / progress) * (1 - progress))}`;
    }, 250);
    await acquireWakeLock();

    const handle = startExport(
      v.file,
      v.info,
      shape,
      {
        draw: (ctx, _layout, t) => renderer.draw(ctx, t),
        camera: (t) => renderer.camera(t),
        bitrate: chooseBitrate(v.info),
      },
      {
        onProgress: (value) => {
          progress = value;
          const pct = Math.min(100, Math.floor(value * 100));
          percent.textContent = String(pct);
          fill.style.width = `${pct}%`;
        },
        onStage: (s) => {
          stage = s;
          stageEl.textContent = s;
        },
        onFrame: (canvas) => {
          const now = performance.now();
          if (!previewCtx || now - lastPreview < 700) return;
          lastPreview = now;
          previewCtx.drawImage(canvas, 0, 0, preview.width, preview.height);
        },
        log: () => undefined,
      },
    );
    running = handle;
    render();

    try {
      const result = await handle.done;
      percent.textContent = '100';
      fill.style.width = '100%';
      remainEl.textContent = '0秒';
      stageEl.textContent = '完了';
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
      const base = (snapshot.title || v.info.fileName.replace(/\.[^.]+$/, '')).replace(/[\\/:*?"<>|]/g, '_');
      const name = `${base}_${shape === 'landscape' ? 'yoko' : 'tate'}_${stamp}.mp4`;
      resultFile = new File([result.blob], name, { type: 'video/mp4' });
      resultUrl = URL.createObjectURL(resultFile);
      const elapsed = result.elapsedMs / 1000;
      const canShare = !!navigator.canShare && navigator.canShare({ files: [resultFile] });
      resultBox.append(
        h('h2', null, '書き出しが終わりました'),
        h(
          'p',
          { class: 'note' },
          `所要時間 ${formatDuration(elapsed)}（動画の長さの ${(elapsed / v.info.duration).toFixed(2)} 倍）、ファイルの大きさ ${formatSize(result.blob.size)}、${result.layout.width}×${result.layout.height}`,
        ),
        h('video', { src: resultUrl, controls: true, playsInline: true, preload: 'metadata' }),
        h(
          'div',
          { class: 'row' },
          h('a', { class: 'btn primary', href: resultUrl, download: name }, '端末に保存する'),
          canShare
            ? h(
                'button',
                {
                  class: 'btn',
                  onclick: async () => {
                    try {
                      if (resultFile) await navigator.share({ files: [resultFile] });
                    } catch (e) {
                      if (e instanceof Error && e.name !== 'AbortError') toast('共有できませんでした。「端末に保存する」を使ってください', 'error');
                    }
                  },
                },
                '共有する',
              )
            : null,
        ),
      );
      resultBox.hidden = false;
      resultBox.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (e) {
      if (e instanceof ExportCanceled) {
        stageEl.textContent = '中止しました';
      } else {
        stageEl.textContent = '失敗しました';
        errorBox.textContent = `${explain(e, stage)}\n（進み具合 ${Math.floor(progress * 100)}% の時点）`;
        errorBox.hidden = false;
        errorBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } finally {
      window.clearInterval(timer);
      running = null;
      void wakeLock?.release().catch(() => undefined);
      wakeLock = null;
      render();
    }
  }

  async function cancel(): Promise<void> {
    if (!running) return;
    if (await confirmDialog('書き出しを中止しますか？ 途中までの結果は残りません。', '中止する', true)) running?.cancel();
  }

  if (support.length > 0) {
    errorBox.textContent = support.join('\n');
    errorBox.hidden = false;
  }

  root.append(
    h(
      'div',
      { class: 'page' },
      h(
        'header',
        { class: 'bar' },
        h(
          'button',
          {
            class: 'btn small',
            onclick: async () => {
              if (running && !(await confirmDialog('書き出しの途中です。中止して編集へ戻りますか？', '中止して戻る', true))) return;
              running?.cancel();
              go('edit', p.id);
            },
          },
          '← 編集へ',
        ),
        h('h1', null, '書き出し'),
      ),
      h('h2', null, '動画'),
      videoNote,
      h('button', { class: 'btn small', onclick: () => void pickVideo() }, app.video ? '別の動画を選ぶ' : '動画を選ぶ'),
      h('h2', null, '出力の形'),
      shapeBox,
      h('p', { class: 'note' }, '同じ作品から、横と縦の両方を書き出せます。'),
      h(
        'p',
        { class: 'box warn' },
        '書き出し中は、この画面を前面に表示したままにしてください。ほかのアプリに切り替えたり画面を消したりすると、止まることがあります。',
      ),
      startBtn,
      cancelBtn,
      progressBox,
      errorBox,
      resultBox,
    ),
  );
  const unsubscribe = app.subscribe((kind) => kind === 'video' && render());
  render();

  return () => {
    unsubscribe();
    running?.cancel();
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('beforeunload', onBeforeUnload);
    void wakeLock?.release().catch(() => undefined);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    document.querySelectorAll('.modal').forEach((el) => el.remove());
  };
}
