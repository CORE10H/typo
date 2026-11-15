// アプリの入口。URL に合わせて画面を切り替える。

import './app/style.css';
import { clear, errorText, h } from './app/dom';
import { parseRoute, go } from './app/router';
import { mountEdit } from './app/screens/edit';
import { mountExport } from './app/screens/export';
import { mountList } from './app/screens/list';
import { mountSetup } from './app/screens/setup';
import { app } from './app/state';
import { loadProject } from './app/store';

const root = document.getElementById('app') as HTMLElement;
let cleanup: (() => void) | null = null;
let token = 0;

async function render(): Promise<void> {
  const mine = ++token;
  const route = parseRoute();
  cleanup?.();
  cleanup = null;
  clear(root);
  window.scrollTo(0, 0);

  try {
    if (route.name !== 'list') {
      if (app.project?.id !== route.id) {
        const p = route.id ? await loadProject(route.id) : null;
        if (mine !== token) return;
        if (!p) {
          go('list', undefined, true);
          return;
        }
        app.open(p);
      }
    }
    switch (route.name) {
      case 'setup':
        cleanup = mountSetup(root);
        break;
      case 'edit':
        cleanup = mountEdit(root);
        break;
      case 'export':
        cleanup = mountExport(root);
        break;
      default:
        cleanup = mountList(root);
    }
  } catch (e) {
    clear(root);
    root.append(
      h(
        'div',
        { class: 'page' },
        h('p', { class: 'box error' }, `画面を開けませんでした。（${errorText(e)}）`),
        h('button', { class: 'btn', onclick: () => go('list') }, '作品一覧へ戻る'),
      ),
    );
  }
}

window.addEventListener('hashchange', () => void render());
void render();

// ホーム画面に追加して使えるようにする（通信がなくても開けるよう、アプリ本体を端末に控えておく）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
