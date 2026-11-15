// 「演出の提案」の窓。
//   上：アプリ内の提案（歌詞と曲の構成から選んだ案と、その理由）。行ごとに採否と別候補を選べる。
//   下：AI（Claude・ChatGPT など）に相談するための、依頼文のコピーと、返事の貼り付け。
// どちらも、固定した行（🔒）には触らない。当てはめた結果は「元に戻す」で一度に戻せる。

import { applyAiReply, buildAiPrompt, parseAiReply } from '../../core/aiexchange';
import { linesOf, lineText, type Project } from '../../core/model';
import { applySuggestion, suggest, type Candidate, type Suggestion } from '../../core/suggest';
import { clear, h, toast } from '../dom';
import { app } from '../state';

export function openSuggest(p: Project): void {
  let seed = Math.floor(Math.random() * 1e9);
  let list: Suggestion[] = [];
  /** 行ごとの、採るかどうかと、選んだ候補 */
  const picked = new Map<string, { on: boolean; choice: Candidate }>();

  const close = (): void => overlay.remove();
  const listEl = h('div', { class: 'sg-list' });
  const applyBtn = h('button', { class: 'btn primary', onclick: () => applyPicked() }, '当てはめる');
  const problemsEl = h('div', { class: 'box warn', hidden: true });
  const promptArea = h('textarea', { rows: 5, readOnly: true, hidden: true, 'aria-label': 'AIに貼る依頼文' });
  const replyArea = h('textarea', { rows: 4, placeholder: 'AIの返事（JSON）をここに貼り付けます', 'aria-label': 'AIの返事' });

  function refreshButton(): void {
    const n = list.filter((s) => picked.get(s.lineId)?.on).length;
    applyBtn.textContent = `選んだ ${n} 行に当てはめる`;
    applyBtn.disabled = n === 0;
  }

  function build(): void {
    list = suggest(p, seed);
    picked.clear();
    for (const s of list) picked.set(s.lineId, { on: true, choice: s.choice });
    render();
  }

  function render(): void {
    clear(listEl);
    const lines = new Map(linesOf(p).map((l) => [l.id, l]));
    if (list.length === 0) {
      listEl.append(h('p', { class: 'note' }, '提案できる行がありません（すべての行が固定されています）。'));
    }
    let section = '';
    for (const s of list) {
      const line = lines.get(s.lineId);
      if (!line) continue;
      if (line.section !== section) {
        section = line.section;
        listEl.append(h('div', { class: 'section' }, section));
      }
      const state = picked.get(s.lineId)!;
      const check = h('input', {
        type: 'checkbox',
        checked: state.on,
        'aria-label': 'この行に当てはめる',
        onchange: () => {
          state.on = check.checked;
          refreshButton();
        },
      });
      const options = [s.choice, ...s.alternatives];
      const select = h(
        'select',
        {
          'aria-label': '演出',
          onchange: () => {
            state.choice = options[select.selectedIndex] ?? s.choice;
          },
        },
        options.map((c, i) =>
          h('option', { selected: c === state.choice }, `${c.kind === 'recipe' ? '★ ' : ''}${c.name}${i === 0 ? '' : '（別候補）'}`),
        ),
      );
      listEl.append(
        h(
          'div',
          { class: 'sg-row' },
          h('label', { class: 'sg-head' }, check, h('span', { class: 'sg-text' }, lineText(line))),
          h('div', { class: 'sg-pick' }, select),
          h('p', { class: 'sg-reason' }, s.reason),
        ),
      );
    }
    refreshButton();
  }

  function applyPicked(): void {
    const lines = new Map(linesOf(p).map((l) => [l.id, l]));
    let n = 0;
    for (const s of list) {
      const state = picked.get(s.lineId);
      const line = lines.get(s.lineId);
      if (!state?.on || !line || line.locked) continue;
      applySuggestion(line, s, state.choice);
      n++;
    }
    if (n === 0) return;
    app.commit();
    toast(`${n} 行に演出を当てはめました（「元に戻す」で戻せます）`);
    close();
  }

  async function copyPrompt(): Promise<void> {
    const text = buildAiPrompt(p);
    try {
      await navigator.clipboard.writeText(text);
      toast('依頼文をコピーしました。AIに貼り付けてください');
    } catch {
      // コピーが許されない環境では、文章を見せて手でコピーしてもらう
      promptArea.value = text;
      promptArea.hidden = false;
      promptArea.focus();
      promptArea.select();
      toast('自動でコピーできませんでした。下の文章を全部選んでコピーしてください');
    }
  }

  function applyReply(): void {
    const text = replyArea.value.trim();
    if (!text) {
      toast('AIの返事を貼り付けてください', 'error');
      return;
    }
    const reply = parseAiReply(text, linesOf(p).length);
    const result = reply.choices.length > 0 ? applyAiReply(p, reply) : { applied: 0, skippedLocked: 0 };
    clear(problemsEl);
    const notes = [...reply.problems];
    if (result.skippedLocked > 0) notes.push(`固定した ${result.skippedLocked} 行は、変えずに残しました`);
    problemsEl.hidden = notes.length === 0;
    if (notes.length > 0) {
      problemsEl.append(
        h('strong', null, '受け付けなかった内容'),
        h('ul', null, notes.slice(0, 12).map((n) => h('li', null, n))),
        notes.length > 12 ? h('p', { class: 'note' }, `ほか ${notes.length - 12} 件`) : '',
      );
    }
    if (result.applied > 0) {
      app.commit();
      toast(`AIの案を ${result.applied} 行に当てはめました（「元に戻す」で戻せます）`);
      if (notes.length === 0) close();
    } else {
      toast('当てはめられる内容がありませんでした', 'error');
    }
  }

  const overlay = h(
    'div',
    { class: 'modal', onclick: (e: Event) => e.target === overlay && close() },
    h(
      'div',
      { class: 'modal-box', role: 'dialog', 'aria-modal': 'true' },
      h('h2', null, '演出の提案'),
      h(
        'p',
        { class: 'note' },
        '歌詞の言葉と、曲の中での場所（サビか、静かな場面か）から選んだ案です。★ は複数の効果を組み合わせたレシピ。固定した行（🔒）は変えません。',
      ),
      listEl,
      h(
        'div',
        { class: 'row end sg-actions' },
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              seed = Math.floor(Math.random() * 1e9);
              build();
            },
          },
          '別の案を出す',
        ),
        applyBtn,
      ),
      h('h2', null, 'AIに相談する'),
      h(
        'p',
        { class: 'note' },
        'Claude や ChatGPT などに、歌詞の意味まで読んで選んでもらう方法です。依頼文（歌詞が入っています）をコピーしてAIに貼り、返ってきた JSON をここへ貼り戻します。このアプリ自身がAIへ通信することはありません。',
      ),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => void copyPrompt() }, '① 依頼文をコピー')),
      promptArea,
      replyArea,
      problemsEl,
      h(
        'div',
        { class: 'row end' },
        h('button', { class: 'btn', onclick: () => applyReply() }, '② 返事を当てはめる'),
        h('button', { class: 'btn', onclick: close }, '閉じる'),
      ),
    ),
  );
  document.body.appendChild(overlay);
  build();
}
