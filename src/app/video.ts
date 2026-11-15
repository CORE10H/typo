// 動画を選んだときの処理。

import { inspectVideo } from '../video/exporter';
import { confirmDialog } from './dom';
import { app } from './state';

/** 動画を選ぶための、見えないファイル選択欄を開く */
export function chooseVideoFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/mp4,.mp4';
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}

/**
 * 動画を読み込み、今の作品に結びつける。
 * 作品に記録済みの動画と違うものを選んだときは、確かめてから使う（選び間違いの防止）。
 * 読めない動画のときは ExportError を投げる。
 * @returns 使うことにしたら true
 */
export async function attachVideo(file: File): Promise<boolean> {
  const p = app.project;
  if (!p) return false;
  const info = await inspectVideo(file);
  const recorded = p.video;
  const hasRecord = recorded.name !== '' && recorded.duration > 0;
  const same =
    Math.abs(recorded.duration - info.duration) < 0.6 && recorded.width === info.width && recorded.height === info.height;
  if (hasRecord && !same && p.items.length > 0) {
    const ok = await confirmDialog(
      `この作品で使っていた動画（${recorded.name}、${Math.round(recorded.duration)}秒、${recorded.width}×${recorded.height}）と、` +
        `選んだ動画（${info.fileName}、${Math.round(info.duration)}秒、${info.width}×${info.height}）が違うようです。この動画に差し替えますか？`,
      '差し替える',
    );
    if (!ok) return false;
  }
  app.setVideo({ file, info, url: URL.createObjectURL(file) });
  p.video = { name: info.fileName, duration: info.duration, width: info.width, height: info.height };
  if (!p.title) p.title = info.fileName.replace(/\.[^.]+$/, '');
  if (info.height > info.width) p.output.shape = 'landscape'; // 縦長の動画は縦はめ込みにできない
  app.commit();
  return true;
}
