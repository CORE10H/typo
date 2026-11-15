// テーマごとの書体の読み込み。
// 同梱する書体は、再配布が許された SIL Open Font License のものだけ（仕様書9章）。
// ファイルは @fontsource のパッケージから取り込み、ビルド時にアプリへ同梱する。

import shipporiJa from '@fontsource/shippori-mincho/files/shippori-mincho-japanese-800-normal.woff2?url';
import shipporiLatin from '@fontsource/shippori-mincho/files/shippori-mincho-latin-800-normal.woff2?url';
import zenJa from '@fontsource/zen-old-mincho/files/zen-old-mincho-japanese-700-normal.woff2?url';
import zenLatin from '@fontsource/zen-old-mincho/files/zen-old-mincho-latin-700-normal.woff2?url';
import kaiseiJa from '@fontsource/kaisei-decol/files/kaisei-decol-japanese-700-normal.woff2?url';
import kaiseiLatin from '@fontsource/kaisei-decol/files/kaisei-decol-latin-700-normal.woff2?url';
import type { Theme } from './themes';

const FILES: Record<string, { weight: number; urls: string[] }> = {
  'Shippori Mincho': { weight: 800, urls: [shipporiLatin, shipporiJa] },
  'Zen Old Mincho': { weight: 700, urls: [zenLatin, zenJa] },
  'Kaisei Decol': { weight: 700, urls: [kaiseiLatin, kaiseiJa] },
};

/** 書体が読めなかったときの代わり（端末に入っている書体） */
export const FALLBACK_FONTS = '"Noto Serif CJK JP", "Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif';

const loading = new Map<string, Promise<boolean>>();

/** テーマの書体を読み込む。読めなくても止めず、端末の書体で代用する（false を返す） */
export function ensureThemeFont(theme: Theme): Promise<boolean> {
  const family = theme.font.family;
  let p = loading.get(family);
  if (!p) {
    const entry = FILES[family];
    if (!entry || typeof FontFace === 'undefined') {
      p = Promise.resolve(false);
    } else {
      p = Promise.all(
        entry.urls.map(async (url) => {
          const face = new FontFace(family, `url(${url}) format("woff2")`, { weight: String(entry.weight) });
          await face.load();
          document.fonts.add(face);
        }),
      ).then(
        () => true,
        () => {
          loading.delete(family); // 次の機会にもう一度試せるようにする
          return false;
        },
      );
    }
    loading.set(family, p);
  }
  return p;
}

export function fontString(theme: Theme, px: number): string {
  return `${theme.font.weight} ${px}px "${theme.font.family}", ${FALLBACK_FONTS}`;
}
