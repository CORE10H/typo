import { defineConfig } from 'vite';

// 画面の下に出す「いつ作った版か」。スマホで開いたページが最新かどうかを見分けるため。
const buildTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });

// base を相対パスにしておくと、GitHub Pages の
// https://<ユーザー名>.github.io/<リポジトリ名>/ でも、手元の確認でも同じように動く。
export default defineConfig({
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      // ページは2枚。アプリ本体と、段階1の書き出し検証ページ。
      input: {
        main: 'index.html',
        verify: 'verify.html',
      },
    },
  },
});
