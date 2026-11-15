// 動画の読み込みと書き出し。ライブラリは Mediabunny（選定理由は docs/export-notes.md）。
//
// 流れ：
//   1. 元の mp4 を開く
//   2. 映像を1コマずつ取り出し、Canvas に描いて文字を重ね、H.264 で圧縮し直す
//   3. 音声は圧縮し直さず、元のデータをそのまま移す
//   4. 端末の保存領域（OPFS）へ少しずつ書き込む。メモリに溜め込まない

import {
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  EncodedPacketSink,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  canEncodeVideo,
  type InputAudioTrack,
  type InputVideoTrack,
  type StreamTargetChunk,
  type Target,
} from 'mediabunny';
import { drawOverlay } from './draw';
import { computeLayout, type Layout, type Shape } from './layout';

/** 利用者にそのまま見せられる日本語のエラー */
export class ExportError extends Error {
  /** 技術的な詳細（あれば）。画面では小さく添える */
  detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'ExportError';
    this.detail = detail;
  }
}

/** 利用者が中止したことを表す */
export class ExportCanceled extends Error {
  constructor() {
    super('書き出しを中止しました。');
    this.name = 'ExportCanceled';
  }
}

export interface VideoInfo {
  fileName: string;
  fileSize: number;
  /** 秒 */
  duration: number;
  width: number;
  height: number;
  /** 1秒あたりのコマ数（平均） */
  frameRate: number;
  frameCount: number;
  videoCodec: string;
  /** bps。わからなければ null */
  videoBitrate: number | null;
  hasAudio: boolean;
  audioCodec: string | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
}

/** 受け付ける動画の上限（仕様書4章：480p・720p・1080p、5分まで） */
export const LIMITS = {
  maxDurationSec: 5 * 60 + 5,
  maxLongSide: 1920,
  maxShortSide: 1088,
};

const OPFS_FILE_NAME = 'typo-export.mp4';

function openInput(file: Blob): Input {
  return new Input({ formats: [MP4], source: new BlobSource(file) });
}

function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

/** 必要な機能がブラウザにあるかを調べる。足りないものの説明を返す（空なら問題なし） */
export function checkBrowserSupport(): string[] {
  const problems: string[] = [];
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof VideoFrame === 'undefined') {
    problems.push(
      'このブラウザは動画を書き出す機能（WebCodecs）に対応していません。Android の Chrome を最新版に更新して開いてください。',
    );
  }
  if (!window.isSecureContext) {
    problems.push('このページは安全な接続（https）で開く必要があります。公開先のURL（https://〜）から開いてください。');
  }
  return problems;
}

/** 動画ファイルの中身を調べる。書き出せない動画なら ExportError を投げる */
export async function inspectVideo(file: File): Promise<VideoInfo> {
  const input = openInput(file);
  try {
    let videoTrack: InputVideoTrack | null;
    let audioTrack: InputAudioTrack | null;
    try {
      videoTrack = await input.getPrimaryVideoTrack();
      audioTrack = await input.getPrimaryAudioTrack();
    } catch (e) {
      throw new ExportError(
        'このファイルを mp4 動画として読めませんでした。mp4 形式の動画を選んでください。',
        errorText(e),
      );
    }
    if (!videoTrack) {
      throw new ExportError('このファイルには映像が入っていません。映像と音の入った mp4 動画を選んでください。');
    }

    const videoCodec = await videoTrack.getCodec();
    if (!videoCodec) {
      throw new ExportError('この動画の映像の圧縮形式を判別できませんでした。別の動画で試してください。');
    }
    if (!(await videoTrack.canDecode())) {
      throw new ExportError(
        `この端末のブラウザは、この動画の映像（圧縮形式：${videoCodec}）を読み出せません。H.264 形式の mp4 で試してください。`,
      );
    }

    const width = await videoTrack.getDisplayWidth();
    const height = await videoTrack.getDisplayHeight();
    const duration = await input.computeDuration();
    const stats = await videoTrack.computePacketStats();
    const videoBitrate = (await videoTrack.getAverageBitrate()) ?? stats.averageBitrate ?? null;

    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    if (longSide > LIMITS.maxLongSide || shortSide > LIMITS.maxShortSide) {
      throw new ExportError(
        `この動画は ${width}×${height} で、扱える大きさ（フルHD：1920×1080 まで）を超えています。フルHD以下の動画を選んでください。`,
      );
    }
    if (duration > LIMITS.maxDurationSec) {
      throw new ExportError(
        `この動画は約 ${Math.round(duration)} 秒あり、扱える長さ（5分まで）を超えています。5分以内の動画を選んでください。`,
      );
    }

    return {
      fileName: file.name,
      fileSize: file.size,
      duration,
      width,
      height,
      frameRate: stats.averagePacketRate,
      frameCount: stats.packetCount,
      videoCodec,
      videoBitrate: videoBitrate && Number.isFinite(videoBitrate) ? videoBitrate : null,
      hasAudio: !!audioTrack,
      audioCodec: audioTrack ? await audioTrack.getCodec() : null,
      audioSampleRate: audioTrack ? await audioTrack.getSampleRate() : null,
      audioChannels: audioTrack ? await audioTrack.getNumberOfChannels() : null,
    };
  } finally {
    input.dispose();
  }
}

// ---------------------------------------------------------------------------
// 書き出し先
// ---------------------------------------------------------------------------

interface Store {
  kind: 'opfs' | 'memory';
  target: Target;
  /** 書き出しが終わったあとに、結果のファイルを取り出す */
  getBlob(): Promise<Blob>;
  /** 失敗・中止したときに、書きかけのファイルを消す */
  discard(): Promise<void>;
}

/** 前回の書き出し結果を端末の保存領域から消す（溜まり続けて容量を圧迫しないように） */
export async function clearPreviousOutput(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OPFS_FILE_NAME);
  } catch {
    // 無ければ何もしない
  }
}

async function openStore(log: (msg: string) => void): Promise<Store> {
  // まず端末の保存領域（OPFS：ブラウザがサイトごとに持つ専用の保存場所）を試す。
  // 3分のフルHDは数百MBになるので、メモリではなくここへ少しずつ書く。
  try {
    if (!navigator.storage?.getDirectory) throw new Error('navigator.storage.getDirectory がありません');
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OPFS_FILE_NAME).catch(() => undefined);
    const handle = await root.getFileHandle(OPFS_FILE_NAME, { create: true });
    const writable = await handle.createWritable();
    const target = new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>, {
      chunked: true,
      chunkSize: 8 * 1024 * 1024,
    });
    return {
      kind: 'opfs',
      target,
      getBlob: async () => {
        const f = await handle.getFile();
        return new File([f], OPFS_FILE_NAME, { type: 'video/mp4' });
      },
      discard: async () => {
        await writable.abort().catch(() => undefined);
        await root.removeEntry(OPFS_FILE_NAME).catch(() => undefined);
      },
    };
  } catch (e) {
    log(`端末の保存領域が使えないため、メモリ上に書き出します（${errorText(e)}）`);
    const target = new BufferTarget();
    return {
      kind: 'memory',
      target,
      getBlob: async () => {
        if (!target.buffer) throw new Error('書き出し結果が空です');
        return new Blob([target.buffer], { type: 'video/mp4' });
      },
      discard: async () => undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// 書き出し本体
// ---------------------------------------------------------------------------

export interface ExportCallbacks {
  /** 0〜1 */
  onProgress(progress: number, frames: number): void;
  /** 今どの作業をしているか（エラー文に使う） */
  onStage(stage: string): void;
  /** 1コマ描き終えるたびに呼ばれる。画面の小さな見本の更新に使う */
  onFrame?(canvas: HTMLCanvasElement): void;
  log(message: string): void;
}

export interface ExportResult {
  blob: Blob;
  layout: Layout;
  elapsedMs: number;
  frames: number;
  storeKind: 'opfs' | 'memory';
  hardware: 'prefer-hardware' | 'no-preference';
  bitrate: number;
}

export interface ExportHandle {
  done: Promise<ExportResult>;
  cancel(): void;
}

function chooseBitrate(info: VideoInfo): number {
  // 元動画と同じくらいの画質を保つ。極端に低い・高い値は避ける。
  const source = info.videoBitrate ?? 8_000_000;
  return Math.round(Math.min(16_000_000, Math.max(6_000_000, source)));
}

function describeDiscardReason(reason: string): string {
  switch (reason) {
    case 'unknown_source_codec':
      return '圧縮形式を判別できない';
    case 'undecodable_source_codec':
      return 'この端末では読み出せない圧縮形式';
    case 'no_encodable_target_codec':
      return 'この端末では書き出せる圧縮形式がない';
    case 'max_track_count_reached':
    case 'max_track_count_of_type_reached':
      return 'mp4 に入れられる数を超えている';
    default:
      return reason;
  }
}

export function startExport(file: File, info: VideoInfo, shape: Shape, cb: ExportCallbacks): ExportHandle {
  let conversion: Conversion | null = null;
  let canceled = false;

  const run = async (): Promise<ExportResult> => {
    const startedAt = performance.now();
    const layout = computeLayout(shape, info.width, info.height);
    const bitrate = chooseBitrate(info);
    const quality = new Quality({ bitrate });

    cb.onStage('書き出しの準備');

    // この端末が、この大きさの H.264 圧縮に対応しているかを先に確かめる。
    // スマホ本体の圧縮チップ（ハードウェア）を優先する。使えなければブラウザ任せにする。
    let hardware: 'prefer-hardware' | 'no-preference' = 'prefer-hardware';
    const encodeCheck = { width: layout.width, height: layout.height, quality, frameRate: info.frameRate };
    if (!(await canEncodeVideo('avc', { ...encodeCheck, hardwareAcceleration: 'prefer-hardware' }))) {
      hardware = 'no-preference';
      if (!(await canEncodeVideo('avc', encodeCheck))) {
        throw new ExportError(
          `この端末のブラウザは、${layout.width}×${layout.height} の大きさの動画を H.264 形式で圧縮できません。` +
            (shape === 'portrait-fit'
              ? '「縦はめ込み（1080×1920 に縮小）」なら書き出せる可能性があります。'
              : '別の出力の形で試してください。'),
        );
      }
      cb.log('圧縮チップ優先の設定が使えないため、ブラウザ任せで圧縮します（遅くなる可能性があります）');
    }

    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new ExportError('描画用のキャンバスを用意できませんでした。ページを開き直して試してください。');

    const store = await openStore(cb.log);
    const input = openInput(file);
    let frames = 0;

    try {
      const output = new Output({
        // fastStart: false = 動画の目次を末尾に置く。メモリをいちばん使わない書き方。
        format: new Mp4OutputFormat({ fastStart: false }),
        target: store.target,
      });

      const v = layout.video;
      conversion = await Conversion.init({
        input,
        output,
        tracks: 'primary',
        video: {
          codec: 'avc',
          quality,
          hardwareAcceleration: hardware,
          forceTranscode: true,
          // 回転の情報は映像そのものに焼き込む（文字まで一緒に回ってしまうのを防ぐ）
          allowTransformationMetadata: false,
          processedWidth: layout.width,
          processedHeight: layout.height,
          process: (sample) => {
            if (layout.shape !== 'landscape') {
              ctx.fillStyle = '#000000';
              ctx.fillRect(0, 0, layout.width, layout.height);
            }
            sample.draw(ctx, v.x, v.y, v.width, v.height);
            drawOverlay(ctx, layout, Math.max(0, sample.timestamp));
            frames++;
            cb.onFrame?.(canvas);
            // 元のコマと同じ時刻・同じ長さで出す。フレームレートを変えず、音とのずれを作らない。
            const durationUs = Math.round(sample.duration * 1_000_000);
            return new VideoFrame(canvas, {
              timestamp: sample.microsecondTimestamp,
              duration: durationUs > 0 ? durationUs : undefined,
            });
          },
        },
        // 音声は何も指定しない＝圧縮し直さず、元のデータをそのまま移す。
        audio: {},
        // 音声を無加工で移すために必要なら、映像と音声をまとめて同じだけ時刻をずらすことを許す
        // （まとめてずらすので、音と映像の関係は変わらない）。
        copy: { shiftTolerance: Infinity },
        showWarnings: false,
      });

      if (!conversion.isValid) {
        const reasons = conversion.discardedTracks
          .map((d) => `${d.track.type === 'video' ? '映像' : '音声'}：${describeDiscardReason(d.reason)}`)
          .join('、');
        throw new ExportError(`この動画は書き出せません（${reasons || '理由不明'}）。`);
      }
      for (const d of conversion.discardedTracks) {
        if (d.reason === 'discarded_by_user') continue;
        const kind = d.track.type === 'video' ? '映像' : d.track.type === 'audio' ? '音声' : 'その他のデータ';
        cb.log(`注意：${kind}の一部を出力に含められませんでした（${describeDiscardReason(d.reason)}）`);
      }

      conversion.onProgress = (p) => cb.onProgress(p, frames);

      cb.onStage('書き出し（映像の圧縮）');
      if (canceled) throw new ExportCanceled();
      await conversion.execute();

      cb.onStage('書き出したファイルの取り出し');
      const blob = await store.getBlob();
      if (blob.size === 0) throw new ExportError('書き出したファイルが空でした。もう一度試してください。');

      return {
        blob,
        layout,
        elapsedMs: performance.now() - startedAt,
        frames,
        storeKind: store.kind,
        hardware,
        bitrate,
      };
    } catch (e) {
      await store.discard();
      if (canceled || e instanceof ConversionCanceledError) throw new ExportCanceled();
      throw e;
    } finally {
      input.dispose();
      // キャンバスが抱えている画像用メモリを早めに手放す
      canvas.width = 0;
      canvas.height = 0;
    }
  };

  return {
    done: run(),
    cancel: () => {
      canceled = true;
      void conversion?.cancel().catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------------------
// 書き出したファイルの検査（合格条件の判断材料を数字で出す）
// ---------------------------------------------------------------------------

export interface Verification {
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  frameCountIn: number;
  frameCountOut: number;
  /** 音声の検査結果。元動画に音声が無ければ 'none' */
  audio: 'copied' | 'reencoded' | 'missing' | 'none';
  audioPacketsIn: number;
  audioPacketsOut: number;
  /** 「音の始まり − 映像の始まり」（ミリ秒）。元動画と書き出し後 */
  avOffsetInMs: number | null;
  avOffsetOutMs: number | null;
  /** 「音の終わり − 映像の終わり」（ミリ秒）。元動画と書き出し後 */
  avEndOffsetInMs: number | null;
  avEndOffsetOutMs: number | null;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 音声の先頭のデータを比べて、元のまま移っているか（無加工か）を確かめる */
async function audioIsCopied(a: InputAudioTrack, b: InputAudioTrack): Promise<boolean> {
  if ((await a.getCodec()) !== (await b.getCodec())) return false;
  const sinkA = new EncodedPacketSink(a);
  const sinkB = new EncodedPacketSink(b);
  const firstB = await sinkB.getFirstPacket();
  if (!firstB) return false;

  // 先頭が数個ずれていても比べられるよう、元動画側で同じ中身のデータを探す
  let pa = await sinkA.getFirstPacket();
  for (let skip = 0; pa && skip < 8 && !sameBytes(pa.data, firstB.data); skip++) {
    pa = await sinkA.getNextPacket(pa);
  }
  if (!pa || !sameBytes(pa.data, firstB.data)) return false;

  let pb: typeof firstB | null = firstB;
  for (let i = 0; i < 200 && pa && pb; i++) {
    if (!sameBytes(pa.data, pb.data)) return false;
    pa = await sinkA.getNextPacket(pa);
    pb = await sinkB.getNextPacket(pb);
  }
  return true;
}

export async function verifyOutput(source: File, result: Blob): Promise<Verification> {
  const inA = openInput(source);
  const inB = openInput(result);
  try {
    const vA = await inA.getPrimaryVideoTrack();
    const vB = await inB.getPrimaryVideoTrack();
    if (!vA || !vB) throw new Error('映像が見つかりません');
    const aA = await inA.getPrimaryAudioTrack();
    const aB = await inB.getPrimaryAudioTrack();

    const statsVA = await vA.computePacketStats();
    const statsVB = await vB.computePacketStats();

    let audio: Verification['audio'] = 'none';
    let audioPacketsIn = 0;
    let audioPacketsOut = 0;
    let avOffsetInMs: number | null = null;
    let avOffsetOutMs: number | null = null;
    let avEndOffsetInMs: number | null = null;
    let avEndOffsetOutMs: number | null = null;

    if (aA) {
      audioPacketsIn = (await aA.computePacketStats()).packetCount;
      avOffsetInMs = ((await aA.getFirstTimestamp()) - (await vA.getFirstTimestamp())) * 1000;
      avEndOffsetInMs = ((await aA.computeDuration()) - (await vA.computeDuration())) * 1000;
      if (!aB) {
        audio = 'missing';
      } else {
        audioPacketsOut = (await aB.computePacketStats()).packetCount;
        avOffsetOutMs = ((await aB.getFirstTimestamp()) - (await vB.getFirstTimestamp())) * 1000;
        avEndOffsetOutMs = ((await aB.computeDuration()) - (await vB.computeDuration())) * 1000;
        audio = (await audioIsCopied(aA, aB)) ? 'copied' : 'reencoded';
      }
    }

    return {
      width: await vB.getDisplayWidth(),
      height: await vB.getDisplayHeight(),
      frameRate: statsVB.averagePacketRate,
      duration: await inB.computeDuration(),
      frameCountIn: statsVA.packetCount,
      frameCountOut: statsVB.packetCount,
      audio,
      audioPacketsIn,
      audioPacketsOut,
      avOffsetInMs,
      avOffsetOutMs,
      avEndOffsetInMs,
      avEndOffsetOutMs,
    };
  } finally {
    inA.dispose();
    inB.dispose();
  }
}
