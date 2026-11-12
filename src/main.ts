// 書き出し検証ページの画面まわり。

import {
  ExportCanceled,
  ExportError,
  checkBrowserSupport,
  clearPreviousOutput,
  inspectVideo,
  startExport,
  verifyOutput,
  type ExportHandle,
  type ExportResult,
  type Verification,
  type VideoInfo,
} from './exporter';
import { computeLayout, shapeLabel, type Shape } from './layout';

declare const __BUILD_TIME__: string;

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
}

const el = {
  support: $('support'),
  file: $<HTMLInputElement>('file'),
  info: $('info'),
  shapeNote: $('shape-note'),
  start: $<HTMLButtonElement>('start'),
  cancel: $<HTMLButtonElement>('cancel'),
  progress: $('progress'),
  barFill: $('bar-fill'),
  percent: $('percent'),
  elapsed: $('elapsed'),
  remaining: $('remaining'),
  speed: $('speed'),
  stage: $('stage'),
  preview: $<HTMLCanvasElement>('preview'),
  error: $('error'),
  result: $('result'),
  verdict: $('verdict'),
  resultInfo: $('result-info'),
  player: $<HTMLVideoElement>('player'),
  save: $<HTMLAnchorElement>('save'),
  share: $<HTMLButtonElement>('share'),
  copy: $<HTMLButtonElement>('copy'),
  log: $('log'),
  build: $('build'),
};
const shapeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="shape"]'));

// ---- 状態 -----------------------------------------------------------------

let currentFile: File | null = null;
let currentInfo: VideoInfo | null = null;
let running: ExportHandle | null = null;
let resultUrl: string | null = null;
let resultFile: File | null = null;
let summaryText = '';
let wakeLock: WakeLockSentinel | null = null;
let hiddenCount = 0;
let currentStage = '';
const supportProblems = checkBrowserSupport();

// ---- 小さな道具 -----------------------------------------------------------

function log(message: string): void {
  const t = new Date().toLocaleTimeString('ja-JP', { hour12: false });
  el.log.textContent += `[${t}] ${message}\n`;
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}分${String(s % 60).padStart(2, '0')}秒` : `${s}秒`;
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function formatMs(ms: number | null): string {
  return ms === null ? '-' : `${ms >= 0 ? '+' : ''}${ms.toFixed(0)} ミリ秒`;
}

function setRows(dl: HTMLElement, rows: [string, string][]): void {
  dl.replaceChildren();
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
}

function showError(message: string, detail?: string): void {
  el.error.replaceChildren(document.createTextNode(message));
  if (detail) {
    const small = document.createElement('small');
    small.textContent = `技術的な詳細：${detail}`;
    el.error.append(small);
  }
  el.error.hidden = false;
  el.error.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  log(`エラー：${message}${detail ? ` ／ ${detail}` : ''}`);
}

function clearError(): void {
  el.error.hidden = true;
  el.error.replaceChildren();
}

/** エラーを、原因がわかる日本語の文にする */
function explainError(e: unknown): { message: string; detail?: string } {
  if (e instanceof ExportError) return { message: e.message, detail: e.detail };
  const name = e instanceof Error ? e.name : '';
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const where = currentStage ? `「${currentStage}」の途中で失敗しました。` : '失敗しました。';
  if (name === 'QuotaExceededError') {
    return {
      message: `${where}端末の空き容量が足りません。不要なファイルを消して空きを増やしてから、もう一度試してください。`,
      detail: raw,
    };
  }
  if (name === 'EncodingError' || name === 'NotSupportedError' || name === 'OperationError') {
    return {
      message:
        `${where}動画の圧縮または読み出しを、この端末のブラウザが受け付けませんでした。` +
        'ほかのアプリを閉じてから試すか、別の出力の形（1080×1920 に縮小など）で試してください。',
      detail: raw,
    };
  }
  if (name === 'RangeError' || /memory|allocation/i.test(raw)) {
    return {
      message: `${where}メモリが足りなくなった可能性があります。ほかのアプリやタブを閉じてから、もう一度試してください。`,
      detail: raw,
    };
  }
  return { message: `${where}下の「技術的な詳細」を Claude に伝えてください。`, detail: raw };
}

function selectedShape(): Shape {
  return (shapeInputs.find((i) => i.checked)?.value ?? 'landscape') as Shape;
}

// ---- 画面の入り切り -------------------------------------------------------

function refreshControls(): void {
  const busy = running !== null;
  el.file.disabled = busy;
  el.start.disabled = busy || !currentInfo || supportProblems.length > 0;
  el.cancel.hidden = !busy;
  const portraitSource = currentInfo ? currentInfo.height > currentInfo.width : false;
  for (const input of shapeInputs) {
    const shape = input.value as Shape;
    let disabled = busy;
    if (currentInfo && shape !== 'landscape' && portraitSource) disabled = true;
    // 縮小版は、元の幅が 1080 より大きいときだけ意味がある
    if (currentInfo && shape === 'portrait-fit-1080' && currentInfo.width <= 1080) disabled = true;
    input.disabled = disabled;
    if (disabled && input.checked && !busy) shapeInputs[0].checked = true;

    const small = document.querySelector<HTMLElement>(`small[data-size="${shape}"]`);
    if (small) {
      if (currentInfo) {
        const l = computeLayout(shape, currentInfo.width, currentInfo.height);
        small.textContent = `出力：${l.width}×${l.height}`;
      } else {
        small.textContent = '';
      }
    }
  }
  el.shapeNote.hidden = !portraitSource;
  el.shapeNote.textContent = portraitSource ? 'この動画は縦長なので、縦はめ込みは選べません。' : '';
}

function resetResult(): void {
  el.result.hidden = true;
  el.player.removeAttribute('src');
  el.player.load();
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = null;
  resultFile = null;
  summaryText = '';
}

// ---- 画面を消さない・裏に回ったことの記録 ---------------------------------

async function acquireWakeLock(): Promise<void> {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch (e) {
    log(`画面を点けたままにする設定ができませんでした（${e instanceof Error ? e.message : String(e)}）。手で画面が消えないようにしてください。`);
  }
}

function releaseWakeLock(): void {
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (!running) return;
  if (document.visibilityState === 'hidden') {
    hiddenCount++;
    log('注意：書き出し中に画面が裏に回りました。処理が止まったり遅くなったりすることがあります。');
  } else {
    void acquireWakeLock();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (running) e.preventDefault();
});

// ---- 動画を選ぶ -----------------------------------------------------------

el.file.addEventListener('change', async () => {
  const file = el.file.files?.[0] ?? null;
  clearError();
  resetResult();
  currentFile = null;
  currentInfo = null;
  el.info.hidden = true;
  refreshControls();
  if (!file) return;

  try {
    currentStage = '動画の読み込み';
    const info = await inspectVideo(file);
    currentFile = file;
    currentInfo = info;
    setRows(el.info, [
      ['ファイル', `${info.fileName}（${formatSize(info.fileSize)}）`],
      ['大きさ', `${info.width}×${info.height}`],
      ['長さ', `${formatDuration(info.duration)}（${info.duration.toFixed(1)} 秒）`],
      ['コマ数', `毎秒 ${info.frameRate.toFixed(2)} コマ（全 ${info.frameCount} コマ）`],
      ['映像の形式', `${info.videoCodec}${info.videoBitrate ? `／約 ${(info.videoBitrate / 1e6).toFixed(1)} Mbps` : ''}`],
      [
        '音声',
        info.hasAudio
          ? `${info.audioCodec ?? '不明'}／${info.audioSampleRate ?? '?'} Hz／${info.audioChannels ?? '?'} ch`
          : '入っていません',
      ],
    ]);
    el.info.hidden = false;
    log(`動画を読み込みました：${info.width}×${info.height}、${info.duration.toFixed(1)}秒、${info.frameRate.toFixed(2)}fps`);
    if (!info.hasAudio) log('注意：この動画には音声が入っていません。音ズレの確認はできません。');
  } catch (e) {
    const { message, detail } = explainError(e);
    showError(message, detail);
    el.file.value = '';
  } finally {
    currentStage = '';
    refreshControls();
  }
});

// ---- 書き出す -------------------------------------------------------------

function buildSummary(info: VideoInfo, result: ExportResult, check: Verification | null): string {
  const ratio = result.elapsedMs / 1000 / info.duration;
  const lines = [
    '【書き出し検証の結果】',
    `ブラウザ：${navigator.userAgent}`,
    `ビルド：${__BUILD_TIME__}`,
    `元の動画：${info.width}×${info.height}／毎秒${info.frameRate.toFixed(2)}コマ／${info.duration.toFixed(1)}秒／映像 ${info.videoCodec}／音声 ${info.audioCodec ?? 'なし'}`,
    `出力の形：${shapeLabel(result.layout.shape)}（${result.layout.width}×${result.layout.height}）`,
    `結果：最後まで完走`,
    `所要時間：${formatDuration(result.elapsedMs / 1000)}（${(result.elapsedMs / 1000).toFixed(1)}秒）＝動画の長さの ${ratio.toFixed(2)} 倍 → ${ratio <= 3 ? '3倍以内（合格）' : '3倍超（不合格）'}`,
    `処理の速さ：毎秒 ${(result.frames / (result.elapsedMs / 1000)).toFixed(1)} コマ`,
    `ファイルの大きさ：${formatSize(result.blob.size)}`,
    `圧縮の設定：${result.hardware === 'prefer-hardware' ? '本体の圧縮チップ優先' : 'ブラウザ任せ'}／${(result.bitrate / 1e6).toFixed(1)} Mbps／保存先 ${result.storeKind === 'opfs' ? '端末の保存領域' : 'メモリ'}`,
    `書き出し中に画面が裏に回った回数：${hiddenCount}`,
  ];
  if (check) {
    lines.push(
      `書き出し後の動画：${check.width}×${check.height}／毎秒${check.frameRate.toFixed(2)}コマ／${check.duration.toFixed(1)}秒`,
      `コマ数：元 ${check.frameCountIn} → 書き出し後 ${check.frameCountOut}`,
      `音声：${audioLabel(check)}`,
      `音と映像の始まりの差：元 ${formatMs(check.avOffsetInMs)} → 書き出し後 ${formatMs(check.avOffsetOutMs)}`,
      `音と映像の終わりの差：元 ${formatMs(check.avEndOffsetInMs)} → 書き出し後 ${formatMs(check.avEndOffsetOutMs)}`,
    );
  } else {
    lines.push('書き出し後の検査：できませんでした');
  }
  return lines.join('\n');
}

function audioLabel(check: Verification): string {
  switch (check.audio) {
    case 'copied':
      return `元のまま移せた（無加工を確認。データ数 元 ${check.audioPacketsIn} → 後 ${check.audioPacketsOut}）`;
    case 'reencoded':
      return '圧縮し直された（元のデータと一致しません）';
    case 'missing':
      return '書き出し後の動画に音声が入っていません';
    case 'none':
      return '元の動画に音声がありません';
  }
}

function showResult(info: VideoInfo, result: ExportResult, check: Verification | null): void {
  const elapsedSec = result.elapsedMs / 1000;
  const ratio = elapsedSec / info.duration;
  const pass = ratio <= 3;

  el.verdict.className = `box ${pass ? 'pass' : 'fail'}`;
  el.verdict.textContent =
    `最後まで書き出せました。所要時間は ${formatDuration(elapsedSec)}、動画の長さ（${formatDuration(info.duration)}）の ${ratio.toFixed(2)} 倍です。` +
    (pass ? '「3倍以内」の条件を満たしています。' : '「3倍以内」の条件を満たしていません。') +
    '音と映像のずれは、下の動画を再生して目と耳でも確かめてください。';

  const rows: [string, string][] = [
    ['出力の形', `${shapeLabel(result.layout.shape)}（${result.layout.width}×${result.layout.height}）`],
    ['所要時間', `${formatDuration(elapsedSec)}（${elapsedSec.toFixed(1)} 秒）`],
    ['処理の速さ', `毎秒 ${(result.frames / elapsedSec).toFixed(1)} コマ`],
    ['ファイルの大きさ', formatSize(result.blob.size)],
  ];
  if (check) {
    const avDelta =
      check.avOffsetInMs !== null && check.avOffsetOutMs !== null ? check.avOffsetOutMs - check.avOffsetInMs : null;
    rows.push(
      ['書き出し後', `${check.width}×${check.height}／毎秒 ${check.frameRate.toFixed(2)} コマ／${check.duration.toFixed(1)} 秒`],
      ['コマ数', `元 ${check.frameCountIn} → 書き出し後 ${check.frameCountOut}`],
      ['音声', audioLabel(check)],
      [
        '音と映像の差',
        avDelta === null
          ? '-'
          : `始まり：元 ${formatMs(check.avOffsetInMs)} → 後 ${formatMs(check.avOffsetOutMs)}（変化 ${formatMs(avDelta)}）`,
      ],
    );
  } else {
    rows.push(['書き出し後の検査', 'できませんでした（記録を見てください）']);
  }
  setRows(el.resultInfo, rows);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const base = info.fileName.replace(/\.[^.]+$/, '');
  const name = `${base}_${result.layout.shape}_${stamp}.mp4`;
  resultFile = new File([result.blob], name, { type: 'video/mp4' });
  resultUrl = URL.createObjectURL(resultFile);
  el.player.src = resultUrl;
  el.save.href = resultUrl;
  el.save.download = name;
  el.share.hidden = !(navigator.canShare && navigator.canShare({ files: [resultFile] }));

  summaryText = buildSummary(info, result, check);
  log(summaryText);
  el.result.hidden = false;
  el.result.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

el.start.addEventListener('click', async () => {
  if (running || !currentFile || !currentInfo) return; // 二重実行の防止
  const file = currentFile;
  const info = currentInfo;
  const shape = selectedShape();
  const layout = computeLayout(shape, info.width, info.height);

  clearError();
  resetResult();
  await clearPreviousOutput();
  hiddenCount = 0;

  // 進捗表示の初期化
  el.progress.hidden = false;
  el.barFill.style.width = '0%';
  el.percent.textContent = '0';
  el.elapsed.textContent = '0秒';
  el.remaining.textContent = '計算中';
  el.speed.textContent = '-';
  const previewWidth = 320;
  el.preview.width = previewWidth;
  el.preview.height = Math.round((previewWidth * layout.height) / layout.width);
  const previewCtx = el.preview.getContext('2d');

  const startedAt = performance.now();
  let progress = 0;
  let frames = 0;
  let lastPreviewAt = 0;
  const timer = window.setInterval(() => {
    const sec = (performance.now() - startedAt) / 1000;
    el.elapsed.textContent = formatDuration(sec);
    if (progress > 0.02 && progress < 1) {
      el.remaining.textContent = `約 ${formatDuration((sec / progress) * (1 - progress))}`;
    }
    if (frames > 0 && sec > 0) {
      el.speed.textContent = `毎秒 ${(frames / sec).toFixed(1)} コマ（合格の目安：毎秒 ${(info.frameRate / 3).toFixed(1)} コマ以上）`;
    }
  }, 250);

  log(`書き出し開始：${shapeLabel(shape)}（${layout.width}×${layout.height}）`);
  await acquireWakeLock();

  const handle = startExport(file, info, shape, {
    onProgress: (p, f) => {
      progress = p;
      frames = f;
      const pct = Math.min(100, Math.floor(p * 100));
      el.percent.textContent = String(pct);
      el.barFill.style.width = `${pct}%`;
    },
    onStage: (stage) => {
      currentStage = stage;
      el.stage.textContent = stage;
      log(`作業：${stage}`);
    },
    onFrame: (canvas) => {
      // 見本は 0.7 秒に 1 回だけ更新する（毎コマ更新すると書き出しが遅くなるため）
      const now = performance.now();
      if (!previewCtx || now - lastPreviewAt < 700) return;
      lastPreviewAt = now;
      previewCtx.drawImage(canvas, 0, 0, el.preview.width, el.preview.height);
    },
    log,
  });
  running = handle;
  refreshControls();

  try {
    const result = await handle.done;
    window.clearInterval(timer);
    el.percent.textContent = '100';
    el.barFill.style.width = '100%';
    el.elapsed.textContent = formatDuration(result.elapsedMs / 1000);
    el.remaining.textContent = '0秒';

    currentStage = '書き出した動画の検査';
    el.stage.textContent = currentStage;
    let check: Verification | null = null;
    try {
      check = await verifyOutput(file, result.blob);
    } catch (e) {
      log(`書き出し後の検査に失敗しました：${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    }
    el.stage.textContent = '完了';
    showResult(info, result, check);
  } catch (e) {
    window.clearInterval(timer);
    if (e instanceof ExportCanceled) {
      el.stage.textContent = '中止しました';
      log('書き出しを中止しました。');
    } else {
      const sec = (performance.now() - startedAt) / 1000;
      const { message, detail } = explainError(e);
      showError(
        `${message}\n（開始から ${formatDuration(sec)}、進み具合 ${Math.floor(progress * 100)}% の時点）`,
        detail,
      );
      el.stage.textContent = '失敗しました';
    }
  } finally {
    running = null;
    currentStage = '';
    releaseWakeLock();
    refreshControls();
  }
});

el.cancel.addEventListener('click', () => {
  if (!running) return;
  if (window.confirm('書き出しを中止しますか？ 途中までの結果は残りません。')) running?.cancel();
});

el.share.addEventListener('click', async () => {
  if (!resultFile) return;
  try {
    await navigator.share({ files: [resultFile] });
  } catch (e) {
    if (e instanceof Error && e.name !== 'AbortError') showError('共有できませんでした。「端末に保存する」を使ってください。', e.message);
  }
});

el.copy.addEventListener('click', async () => {
  if (!summaryText) return;
  try {
    await navigator.clipboard.writeText(summaryText);
    el.copy.textContent = 'コピーしました';
  } catch {
    el.copy.textContent = 'コピーできませんでした（記録を開いて手で写してください）';
  }
  window.setTimeout(() => (el.copy.textContent = '結果の文をコピー'), 2500);
});

// 想定外のエラーも画面に出す（黙って止まるのを防ぐ）
window.addEventListener('unhandledrejection', (e) => {
  log(`想定外のエラー：${e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : String(e.reason)}`);
});
window.addEventListener('error', (e) => {
  log(`想定外のエラー：${e.message}`);
});

// ---- 起動時 ---------------------------------------------------------------

el.build.textContent = __BUILD_TIME__;
if (supportProblems.length > 0) {
  el.support.textContent = supportProblems.join('\n');
  el.support.hidden = false;
}
refreshControls();
log(`ページを開きました。${navigator.userAgent}`);
