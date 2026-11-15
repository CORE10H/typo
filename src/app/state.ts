// アプリの状態：今開いている作品、選んだ動画、元に戻す／やり直すの履歴、自動保存。

import { normalizeProject, type Project } from '../core/model';
import type { VideoInfo } from '../video/exporter';
import { errorText, toast } from './dom';
import { saveProject } from './store';

export interface LoadedVideo {
  file: File;
  info: VideoInfo;
  url: string;
}

/**
 * 変更の種類。
 * - commit: 履歴に残す変更（1操作ぶん）
 * - live: つまみを動かしている途中など、まだ履歴に残さない変更
 * - replace: 元に戻す／やり直す／作品の開き直しで、作品がまるごと入れ替わった
 * - video: 動画を選び直した
 */
export type ChangeKind = 'commit' | 'live' | 'replace' | 'video';

const MAX_HISTORY = 80;

class AppState {
  project: Project | null = null;
  video: LoadedVideo | null = null;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private snapshot = '';
  private listeners = new Set<(kind: ChangeKind) => void>();
  private saveTimer = 0;
  private dirty = false;

  subscribe(fn: (kind: ChangeKind) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(kind: ChangeKind): void {
    for (const fn of [...this.listeners]) fn(kind);
  }

  /** 作品を開く（履歴は空から始める） */
  open(p: Project): void {
    this.flush();
    this.project = p;
    this.undoStack = [];
    this.redoStack = [];
    this.snapshot = JSON.stringify(p);
    this.emit('replace');
  }

  close(): void {
    this.flush();
    this.project = null;
    this.undoStack = [];
    this.redoStack = [];
  }

  /** 作品を書き換えたあとに呼ぶ。履歴に1つ積み、自動保存を予約する */
  commit(): void {
    if (!this.project) return;
    const next = JSON.stringify(this.project);
    if (next === this.snapshot) return;
    this.undoStack.push(this.snapshot);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.snapshot = next;
    this.scheduleSave();
    this.emit('commit');
  }

  /** 履歴には積まずに、画面の更新と保存だけ行う（自動配色の結果など） */
  touch(): void {
    if (!this.project) return;
    this.snapshot = JSON.stringify(this.project);
    this.scheduleSave();
    this.emit('live');
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.snapshot);
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.snapshot);
    this.restore(next);
  }

  private restore(json: string): void {
    const p = normalizeProject(JSON.parse(json));
    if (!p) return;
    this.snapshot = json;
    this.project = p;
    this.scheduleSave();
    this.emit('replace');
  }

  setVideo(video: LoadedVideo | null): void {
    if (this.video && this.video !== video) URL.revokeObjectURL(this.video.url);
    this.video = video;
    this.emit('video');
  }

  private scheduleSave(): void {
    this.dirty = true;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(), 400);
  }

  /** 予約中の保存を今すぐ行う（画面を閉じる直前など） */
  flush(): void {
    window.clearTimeout(this.saveTimer);
    if (!this.dirty || !this.project) return;
    this.dirty = false;
    this.project.updatedAt = Date.now();
    saveProject(this.project).catch((e) => {
      this.dirty = true;
      toast(`自動保存に失敗しました。端末の空き容量を確かめてください。（${errorText(e)}）`, 'error');
    });
  }
}

export const app = new AppState();

// 画面を閉じる・裏に回すときに、保存し損ねないようにする
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') app.flush();
});
window.addEventListener('pagehide', () => app.flush());
