// 出力の形ごとの寸法計算。プレビューと書き出しで共用する。

/**
 * 出力の形。
 * - landscape: 横のまま（元動画と同じ大きさ）
 * - portrait-fit: 縦はめ込み。幅は元動画に合わせ、9:16 の枠の中央に置く。上下は黒地（仕様書どおり）
 * - portrait-fit-1080: 縦はめ込みの比較用。枠を 1080×1920 に固定し、動画を縮めて置く
 */
export type Shape = 'landscape' | 'portrait-fit' | 'portrait-fit-1080';

export interface Layout {
  shape: Shape;
  /** 出力する動画全体の幅と高さ（ピクセル） */
  width: number;
  height: number;
  /** 出力の中で、元の映像を置く場所と大きさ */
  video: { x: number; y: number; width: number; height: number };
}

/** 動画の圧縮は偶数の寸法しか受け付けないことが多いので、偶数に丸める */
function toEven(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export function computeLayout(shape: Shape, sourceWidth: number, sourceHeight: number): Layout {
  if (shape === 'landscape') {
    const width = toEven(sourceWidth);
    const height = toEven(sourceHeight);
    return { shape, width, height, video: { x: 0, y: 0, width, height } };
  }

  const width = shape === 'portrait-fit-1080' ? 1080 : toEven(sourceWidth);
  const height = toEven((width * 16) / 9);
  const videoHeight = toEven((width * sourceHeight) / sourceWidth);
  const y = Math.round((height - videoHeight) / 2);
  return { shape, width, height, video: { x: 0, y, width, height: videoHeight } };
}

export function shapeLabel(shape: Shape): string {
  switch (shape) {
    case 'landscape':
      return '横のまま';
    case 'portrait-fit':
      return '縦はめ込み（幅は元動画のまま）';
    case 'portrait-fit-1080':
      return '縦はめ込み（1080×1920 に縮小・比較用）';
  }
}
