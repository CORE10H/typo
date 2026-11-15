// 作品一覧（仕様書7章）。開く、複製、削除、新規作成。

import { linesOf, newId, newProject, type Project } from '../../core/model';
import { getTheme } from '../../engine/themes';
import { clear, confirmDialog, errorText, formatClock, h, toast } from '../dom';
import { go } from '../router';
import { app } from '../state';
import { deleteProject, listProjects, requestPersistence, saveProject } from '../store';

declare const __BUILD_TIME__: string;

export function mountList(root: HTMLElement): () => void {
  app.close();
  app.setVideo(null);
  const listEl = h('div', { class: 'cards' });

  const createNew = async (): Promise<void> => {
    const p = newProject();
    try {
      await saveProject(p);
      requestPersistence();
    } catch (e) {
      toast(`作品を保存できませんでした。（${errorText(e)}）`, 'error');
      return;
    }
    app.open(p);
    go('setup', p.id);
  };

  const refresh = async (): Promise<void> => {
    let projects: Project[];
    try {
      projects = await listProjects();
    } catch (e) {
      clear(listEl);
      listEl.append(h('p', { class: 'box error' }, `作品の一覧を読み込めませんでした。（${errorText(e)}）`));
      return;
    }
    clear(listEl);
    if (projects.length === 0) {
      listEl.append(
        h('p', { class: 'empty' }, 'まだ作品がありません。「新しく作る」から始めてください。'),
      );
      return;
    }
    for (const p of projects) {
      const lines = linesOf(p).length;
      const theme = getTheme(p.theme);
      listEl.append(
        h(
          'article',
          { class: 'card' },
          h(
            'button',
            {
              class: 'card-main',
              onclick: () => {
                app.open(p);
                go(lines > 0 ? 'edit' : 'setup', p.id);
              },
            },
            h('span', { class: 'swatch', style: `background:linear-gradient(${theme.backdrop[0]},${theme.backdrop[1]})` }),
            h(
              'span',
              { class: 'card-text' },
              h('strong', null, p.title || '（無題）'),
              h(
                'small',
                null,
                `${lines}行`,
                p.video.duration > 0 ? `・${formatClock(p.video.duration)}` : '',
                `・${theme.name}`,
                `・${new Date(p.updatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
              ),
              p.video.name ? h('small', null, `動画：${p.video.name}`) : null,
            ),
          ),
          h(
            'div',
            { class: 'card-actions' },
            h(
              'button',
              {
                class: 'btn small',
                onclick: async () => {
                  const copy: Project = JSON.parse(JSON.stringify(p));
                  copy.id = newId('p');
                  copy.title = `${p.title || '無題'} のコピー`;
                  copy.createdAt = copy.updatedAt = Date.now();
                  try {
                    await saveProject(copy);
                    toast('複製しました');
                  } catch (e) {
                    toast(`複製できませんでした。（${errorText(e)}）`, 'error');
                  }
                  void refresh();
                },
              },
              '複製',
            ),
            h(
              'button',
              {
                class: 'btn small danger-text',
                onclick: async () => {
                  const ok = await confirmDialog(
                    `「${p.title || '無題'}」を削除しますか？ 削除すると元に戻せません。`,
                    '削除する',
                    true,
                  );
                  if (!ok) return;
                  try {
                    await deleteProject(p.id);
                  } catch (e) {
                    toast(`削除できませんでした。（${errorText(e)}）`, 'error');
                  }
                  void refresh();
                },
              },
              '削除',
            ),
          ),
        ),
      );
    }
  };

  root.append(
    h(
      'div',
      { class: 'page' },
      h('header', { class: 'page-head' }, h('h1', null, 'リリックタイポ'), h('p', { class: 'sub' }, '動画に歌詞演出を焼き込む')),
      h('button', { class: 'btn primary wide', onclick: () => void createNew() }, '＋ 新しく作る'),
      h('h2', null, '作品一覧'),
      listEl,
      h(
        'footer',
        { class: 'foot' },
        h('a', { href: './verify.html' }, '書き出し検証ページ'),
        h('span', null, `ビルド：${__BUILD_TIME__}`),
      ),
    ),
  );
  void refresh();
  return () => undefined;
}
