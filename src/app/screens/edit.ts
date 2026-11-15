// 編集画面（仕様書7章）。
//   上：プレビュー。中：歌詞の行リストと簡易タイムライン（切り替え）。下：選んだ行の設定。

import { assignPresets, copySectionSettings, sectionNames } from '../../core/draft';
import { parsePhraseInput } from '../../core/lyrics';
import {
  POSITION_LABELS,
  formatTime,
  linesOf,
  lineText,
  newId,
  resolveOverlaps,
  snapToBeat,
  type LineItem,
  type Position,
  type Project,
} from '../../core/model';
import { EFFECTS, MAX_LAYERS, getEffect } from '../../engine/effects';
import { CATEGORY_LABELS, type EffectCategory } from '../../engine/effects/types';
import { PRESETS, presetName } from '../../engine/presets';
import { RECIPES, applyRecipe, getRecipe } from '../../engine/recipes';
import { THEMES, getTheme } from '../../engine/themes';
import { ExportError } from '../../video/exporter';
import { runAutoColor, type AutoColorJob } from '../autocolor';
import { clear, confirmDialog, errorText, formatClock, h, toast } from '../dom';
import { Player } from '../player';
import { go } from '../router';
import { app, type ChangeKind } from '../state';
import { attachVideo, chooseVideoFile } from '../video';
import { openSuggest } from './suggestui';
import { openTapSync } from './tapsync';
import { ChoiceThumbs } from './thumbs';
import { Timeline } from './timeline';

type PanelTab = 'motion' | 'layers' | 'time' | 'text' | 'look';

/** 行リストなどに出す、行の演出の短い呼び名 */
function describeLine(line: LineItem): string {
  const recipe = getRecipe(line.recipe);
  if (recipe) return `★${recipe.name}`;
  const n = line.layers.filter((l) => getEffect(l.fx)).length;
  return n > 0 ? `${presetName(line.preset)}＋${n}` : presetName(line.preset);
}

export function mountEdit(root: HTMLElement): () => void {
  let p = app.project as Project;
  let selectedId: string | null = null;
  let view: 'list' | 'timeline' = 'list';
  let panelTab: PanelTab = 'motion';
  let motionView: 'recipe' | 'motion' = 'recipe';
  let fxCategory: EffectCategory = 'glitch';
  let seeking = false;
  let tapping = false;
  let colorJob: AutoColorJob | null = null;
  let colorTimer = 0;
  let nowId: string | null = null;

  // ---- 部品 ----------------------------------------------------------------
  const canvas = h('canvas', { class: 'preview' });
  const previewWrap = h('div', { class: 'preview-wrap' }, canvas);
  const player = new Player(canvas);
  const videoBanner = h('div', { class: 'banner', hidden: true });
  const playBtn = h('button', { class: 'btn icon', 'aria-label': '再生／停止', onclick: () => player.toggle() }, '▶');
  const timeLabel = h('span', { class: 'time' }, '0:00.0');
  const seekBar = h('input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.01',
    value: '0',
    class: 'seek',
    'aria-label': '再生位置',
    oninput: () => {
      seeking = true;
      player.seek(parseFloat(seekBar.value));
    },
    onchange: () => {
      seeking = false;
    },
  });
  const undoBtn = h('button', { class: 'btn icon', 'aria-label': '元に戻す', title: '元に戻す', onclick: () => app.undo() }, '↶');
  const redoBtn = h('button', { class: 'btn icon', 'aria-label': 'やり直す', title: 'やり直す', onclick: () => app.redo() }, '↷');
  const titleEl = h('h1', { class: 'title' });
  const listEl = h('div', { class: 'lines' });
  const colorStatus = h('span', { class: 'status' });
  const panel = h('div', { class: 'panel', hidden: true });
  const viewList = h('button', { class: 'seg on', onclick: () => setView('list') }, '行リスト');
  const viewTimeline = h('button', { class: 'seg', onclick: () => setView('timeline') }, 'タイムライン');

  const timeline = new Timeline({
    player,
    selectedId: () => selectedId,
    select: (id) => select(id, false),
  });
  timeline.el.hidden = true;

  // レシピ（動き＋効果の組み合わせ）の見本
  const recipeThumbs = new ChoiceThumbs(
    RECIPES.map((r) => ({
      id: r.id,
      name: r.name,
      hint: r.hint,
      apply: (l: LineItem) => applyRecipe(l, r),
      active: (l: LineItem) => l.recipe === r.id,
    })),
    (choice) => {
      const line = selectedLine();
      const recipe = getRecipe(choice.id);
      if (!line || !recipe) return;
      applyRecipe(line, recipe);
      line.locked = true;
      app.commit();
    },
  );
  // 動きの見本（重ねた効果はそのまま残して、動きだけを入れ替える）
  const motionThumbs = new ChoiceThumbs(
    PRESETS.map((m) => ({
      id: m.id,
      name: m.name,
      hint: m.hint,
      apply: (l: LineItem) => {
        l.preset = m.id;
      },
      active: (l: LineItem) => l.preset === m.id,
    })),
    (choice) => {
      const line = selectedLine();
      if (!line) return;
      line.preset = choice.id;
      line.recipe = null;
      line.locked = true;
      app.commit();
    },
  );
  const stopThumbs = (): void => {
    recipeThumbs.stop();
    motionThumbs.stop();
  };

  // ---- 選択 ----------------------------------------------------------------
  const selectedLine = (): LineItem | null => linesOf(p).find((l) => l.id === selectedId) ?? null;

  /** 行を選ぶ。選ぶと、プレビューがその行だけを繰り返し再生する */
  function select(id: string | null, scrollTimeline = true): void {
    selectedId = id;
    const line = selectedLine();
    if (line) {
      player.setLoop({ start: Math.max(0, line.start - 0.15), end: line.end + 0.3 });
      player.seek(Math.max(0, line.start - 0.15));
      player.play();
      if (scrollTimeline) timeline.reveal(line.id);
    } else {
      player.setLoop(null);
    }
    renderList();
    timeline.update();
    renderPanel();
    listEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }

  function setView(v: 'list' | 'timeline'): void {
    view = v;
    viewList.classList.toggle('on', v === 'list');
    viewTimeline.classList.toggle('on', v === 'timeline');
    listEl.hidden = v !== 'list';
    timeline.el.hidden = v !== 'timeline';
    if (v === 'timeline') {
      timeline.update();
      if (selectedId) timeline.reveal(selectedId);
    } else {
      listEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    }
  }

  // ---- 行リスト ------------------------------------------------------------
  function renderList(): void {
    clear(listEl);
    const lines = linesOf(p);
    if (lines.length === 0) {
      listEl.append(
        h('p', { class: 'empty' }, 'まだ行がありません。'),
        h('button', { class: 'btn', onclick: () => go('setup', p.id) }, '取り込み画面で叩き台を作る'),
      );
      return;
    }
    let section = '';
    for (const line of lines) {
      if (line.section !== section) {
        section = line.section;
        listEl.append(h('div', { class: 'section' }, section));
      }
      listEl.append(
        h(
          'button',
          {
            class: `line ${line.id === selectedId ? 'sel' : ''} ${line.id === nowId ? 'now' : ''}`,
            'data-id': line.id,
            onclick: () => select(line.id === selectedId ? null : line.id),
          },
          h('span', { class: 'line-time' }, formatTime(line.start)),
          h('span', { class: 'line-text' }, lineText(line)),
          h('span', { class: 'line-preset' }, `${line.locked ? '🔒' : ''}${describeLine(line)}`),
        ),
      );
    }
  }

  function markNow(t: number): void {
    const cur = linesOf(p).find((l) => t >= l.start && t < l.end)?.id ?? null;
    if (cur === nowId) return;
    nowId = cur;
    if (view !== 'list') return;
    for (const el of listEl.querySelectorAll<HTMLElement>('.line')) {
      el.classList.toggle('now', el.dataset.id === nowId);
    }
    if (!selectedId && player.playing) listEl.querySelector('.now')?.scrollIntoView({ block: 'nearest' });
  }

  // ---- 選んだ行の設定 ------------------------------------------------------
  function slider(label: string, value: number, onLive: (v: number) => void): HTMLElement {
    const out = h('span', { class: 'value' }, Math.round(value * 100));
    const input = h('input', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.01',
      value: String(value),
      oninput: () => {
        const v = parseFloat(input.value);
        out.textContent = String(Math.round(v * 100));
        onLive(v);
        player.refresh();
      },
      onchange: () => app.commit(),
    });
    return h('label', { class: 'slider' }, h('span', null, label), input, out);
  }

  function timeField(line: LineItem, key: 'start' | 'end'): HTMLElement {
    const apply = (value: number): void => {
      const v = Math.max(0, Math.min(player.duration, p.snap ? snapToBeat(p, value) : Math.round(value * 100) / 100));
      line[key] = v;
      if (key === 'start' && line.end < v + 0.15) line.end = v + 0.15;
      if (key === 'end' && line.start > v - 0.15) line.start = Math.max(0, v - 0.15);
      resolveOverlaps(p);
      app.commit();
      const l = selectedLine();
      if (l) player.setLoop({ start: Math.max(0, l.start - 0.15), end: l.end + 0.3 });
    };
    const input = h('input', {
      type: 'text',
      inputMode: 'decimal',
      class: 'num',
      value: line[key].toFixed(2),
      'aria-label': key === 'start' ? '開始（秒）' : '終了（秒）',
      onchange: () => {
        const n = parseFloat(input.value.replace(',', '.'));
        if (Number.isFinite(n)) apply(n);
        else input.value = line[key].toFixed(2);
      },
    });
    return h(
      'div',
      { class: 'time-field' },
      h('span', { class: 'label' }, key === 'start' ? '開始' : '終了'),
      h('button', { class: 'btn small', 'aria-label': '0.1秒早く', onclick: () => apply(line[key] - 0.1) }, '−0.1'),
      input,
      h('span', null, '秒'),
      h('button', { class: 'btn small', 'aria-label': '0.1秒遅く', onclick: () => apply(line[key] + 0.1) }, '＋0.1'),
      h('button', { class: 'btn small', onclick: () => apply(player.time) }, '今の位置'),
    );
  }

  function renderPanel(): void {
    const line = selectedLine();
    panel.hidden = !line;
    clear(panel);
    if (!line) {
      stopThumbs();
      return;
    }
    const tab = (id: PanelTab, label: string): HTMLElement =>
      h(
        'button',
        {
          class: `seg ${panelTab === id ? 'on' : ''}`,
          onclick: () => {
            panelTab = id;
            renderPanel();
          },
        },
        label,
      );
    const body = h('div', { class: 'panel-body' });

    if (panelTab === 'motion') {
      const active = motionView === 'recipe' ? recipeThumbs : motionThumbs;
      (motionView === 'recipe' ? motionThumbs : recipeThumbs).stop();
      active.setLine(p, line);
      active.start();
      const viewBtn = (id: 'recipe' | 'motion', label: string): HTMLElement =>
        h(
          'button',
          {
            class: `chip ${motionView === id ? 'on' : ''}`,
            'aria-pressed': String(motionView === id),
            onclick: () => {
              motionView = id;
              renderPanel();
            },
          },
          label,
        );
      const layerCount = line.layers.filter((l) => getEffect(l.fx)).length;
      const others = sectionNames(p).filter((s) => s !== line.section);
      const source = h('select', { 'aria-label': '写す元の区間' }, others.map((s) => h('option', { value: s }, s)));
      body.append(
        h('div', { class: 'chips tight' }, viewBtn('recipe', `★ レシピ（${RECIPES.length}）`), viewBtn('motion', `動き（${PRESETS.length}）`)),
        active.el,
        h(
          'p',
          { class: 'note' },
          motionView === 'recipe'
            ? 'レシピは、動きと効果を組み合わせた完成形です。選んだあと「重ね」で細かく直せます。'
            : `動きだけを入れ替えます。${layerCount > 0 ? `重ねた効果（${layerCount}個）はそのまま残ります。` : ''}`,
        ),
        slider('強さ', line.strength, (v) => {
          line.strength = v;
          line.locked = true;
        }),
        slider('速さ', line.speed, (v) => {
          line.speed = v;
          line.locked = true;
        }),
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: `btn small ${line.locked ? 'on' : ''}`,
              'aria-pressed': String(line.locked),
              title: '固定した行は「おまかせで振り直す」「演出の提案」で上書きされません',
              onclick: () => {
                line.locked = !line.locked;
                app.commit();
              },
            },
            line.locked ? '🔒 固定中' : '固定する',
          ),
          h(
            'button',
            {
              class: 'btn small',
              onclick: () => {
                let n = 0;
                for (const l of linesOf(p)) {
                  if (l.section !== line.section) continue;
                  l.preset = line.preset;
                  l.layers = line.layers.map((x) => ({ ...x }));
                  l.recipe = line.recipe;
                  l.strength = line.strength;
                  l.speed = line.speed;
                  l.locked = true;
                  n++;
                }
                app.commit();
                toast(`「${line.section}」の ${n} 行に同じ演出を入れました`);
              },
            },
            `「${line.section}」の全行に適用`,
          ),
        ),
        others.length > 0
          ? h(
              'div',
              { class: 'row middle' },
              source,
              h(
                'button',
                {
                  class: 'btn small',
                  title: '2回目のサビに、1回目の設定をコピーするときに使います',
                  onclick: () => {
                    const n = copySectionSettings(p, source.value, line.section);
                    app.commit();
                    toast(n > 0 ? `「${source.value}」の設定を ${n} 行に写しました` : '写せる行がありませんでした');
                  },
                },
                'の設定をこの区間へ写す',
              ),
            )
          : '',
      );
      // いま選ばれている見本が見える位置まで送る（一覧が長いので）
      requestAnimationFrame(() => active.revealActive());
    } else {
      stopThumbs();
    }

    if (panelTab === 'layers') {
      // 重ねた効果を変えたら、レシピの印を外して行を固定する
      const changed = (): void => {
        line.recipe = null;
        line.locked = true;
        app.commit();
      };
      const known = line.layers.filter((l) => getEffect(l.fx));
      const rows = known.map((ref) => {
        const e = getEffect(ref.fx)!;
        const index = line.layers.indexOf(ref);
        const value = h('span', { class: 'value' }, Math.round(ref.amount * 100));
        const input = h('input', {
          type: 'range',
          min: '0',
          max: '1',
          step: '0.01',
          value: String(ref.amount),
          'aria-label': `${e.name} の量`,
          oninput: () => {
            ref.amount = parseFloat(input.value);
            value.textContent = String(Math.round(ref.amount * 100));
            player.refresh();
          },
          onchange: changed,
        });
        return h(
          'div',
          { class: 'layer' },
          h('div', { class: 'layer-head' }, h('strong', null, e.name), h('small', null, CATEGORY_LABELS[e.category])),
          h(
            'div',
            { class: 'layer-row' },
            input,
            value,
            h(
              'button',
              {
                class: 'btn small',
                disabled: index <= 0,
                'aria-label': `${e.name} を前へ`,
                title: '重なりの順番を1つ前へ（後ろにある効果が優先されます）',
                onclick: () => {
                  line.layers.splice(index, 1);
                  line.layers.splice(index - 1, 0, ref);
                  changed();
                },
              },
              '↑',
            ),
            h(
              'button',
              {
                class: 'btn small danger-text',
                'aria-label': `${e.name} を外す`,
                onclick: () => {
                  line.layers = line.layers.filter((l) => l !== ref);
                  changed();
                },
              },
              '外す',
            ),
          ),
        );
      });
      const full = known.length >= MAX_LAYERS;
      const hard = known.filter((l) => getEffect(l.fx)!.legibility <= 2).length;
      const categories = Object.keys(CATEGORY_LABELS) as EffectCategory[];
      const recipe = getRecipe(line.recipe);
      body.append(
        h(
          'p',
          { class: 'note' },
          recipe
            ? `レシピ「${recipe.name}」の中身です。量を変えたり、外したり、足したりできます。`
            : `動き「${presetName(line.preset)}」の上に、効果を重ねます。`,
        ),
        ...(rows.length > 0 ? rows : [h('p', { class: 'empty' }, 'まだ効果を重ねていません。')]),
        hard >= 3 || known.length >= 4
          ? h('p', { class: 'box warn' }, '効果をたくさん重ねると、歌詞が読みにくくなります。読ませたい行では、数を絞るのがおすすめです。')
          : '',
        h('span', { class: 'label' }, full ? `効果を足す（1行に ${MAX_LAYERS} 個まで。外してから足してください）` : '効果を足す'),
        h(
          'div',
          { class: 'chips tight' },
          categories.map((c) =>
            h(
              'button',
              {
                class: `chip ${fxCategory === c ? 'on' : ''}`,
                'aria-pressed': String(fxCategory === c),
                onclick: () => {
                  fxCategory = c;
                  renderPanel();
                },
              },
              CATEGORY_LABELS[c],
            ),
          ),
        ),
        h(
          'div',
          { class: 'fx-list' },
          EFFECTS.filter((e) => e.category === fxCategory).map((e) => {
            const has = line.layers.some((l) => l.fx === e.id);
            return h(
              'button',
              {
                class: 'fx-item',
                disabled: has || full,
                onclick: () => {
                  // 登場・退場を受け持つ効果は、それぞれ1つまで。すでにあれば入れ替える
                  if (e.replaces) {
                    const old = line.layers.find((l) => getEffect(l.fx)?.replaces === e.replaces);
                    if (old) {
                      line.layers = line.layers.filter((l) => l !== old);
                      toast(`${e.replaces === 'enter' ? '登場' : '退場'}の効果は1つまでなので、「${getEffect(old.fx)!.name}」と入れ替えました`);
                    }
                  }
                  line.layers = [...line.layers, { fx: e.id, amount: 0.5 }];
                  changed();
                },
              },
              h('strong', null, has ? `✓ ${e.name}` : `＋ ${e.name}`),
              h('small', null, e.hint),
            );
          }),
        ),
      );
    }

    if (panelTab === 'time') {
      body.append(
        timeField(line, 'start'),
        timeField(line, 'end'),
        h('p', { class: 'note' }, `長さ ${(line.end - line.start).toFixed(2)} 秒。${p.snap ? '拍に吸着しています。' : ''}`),
      );
    }

    if (panelTab === 'text') {
      const input = h('textarea', {
        rows: 2,
        value: line.phrases.join(' / '),
        'aria-label': '歌詞（「/」で区切る）',
        onchange: () => {
          const phrases = parsePhraseInput(input.value);
          if (phrases.length === 0) {
            input.value = line.phrases.join(' / ');
            toast('文字が空です。行を消すときは「この行を消す」を使ってください', 'error');
            return;
          }
          line.phrases = phrases;
          app.commit();
        },
      });
      const layoutBtn = (value: LineItem['layout'], label: string): HTMLElement =>
        h(
          'button',
          {
            class: `seg ${line.layout === value ? 'on' : ''}`,
            onclick: () => {
              line.layout = value;
              line.locked = true;
              app.commit();
            },
          },
          label,
        );
      body.append(
        input,
        h('p', { class: 'note' }, '「/」を入れた場所でフレーズが分かれます。'),
        h('div', { class: 'segs' }, layoutBtn('stack', '段に並べる'), layoutBtn('sequence', '順番に出す')),
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: 'btn small',
              onclick: () => {
                const lines = linesOf(p);
                const next = lines[lines.indexOf(line) + 1];
                let start = line.end;
                let end = Math.min(next ? next.start : player.duration, start + 2);
                if (end - start < 0.3) {
                  // 後ろに空きがないときは、この行の時間を半分に分けて、後ろ半分を新しい行にする
                  if (line.end - line.start < 0.6) {
                    toast('この行が短すぎて、行を足せません。先に行を長くしてください', 'error');
                    return;
                  }
                  end = line.end;
                  start = Math.round(((line.start + line.end) / 2) * 100) / 100;
                  line.end = start;
                }
                const added: LineItem = {
                  ...line,
                  id: newId('l'),
                  phrases: ['新しい行'],
                  start,
                  end,
                  locked: false,
                  auto: undefined,
                };
                p.items.splice(p.items.indexOf(line) + 1, 0, added);
                app.commit();
                select(added.id);
              },
            },
            '後ろに行を足す',
          ),
          h(
            'button',
            {
              class: 'btn small danger-text',
              onclick: async () => {
                if (!(await confirmDialog(`「${lineText(line)}」を消しますか？（「元に戻す」で戻せます）`, '消す', true))) return;
                p.items = p.items.filter((i) => i !== line);
                selectedId = null;
                player.setLoop(null);
                app.commit();
              },
            },
            'この行を消す',
          ),
        ),
      );
    }

    if (panelTab === 'look') {
      const hasBand = p.output.shape === 'portrait-fit';
      const options: (Position | null)[] = [null, 'top', 'middle', 'bottom'];
      if (hasBand) options.push('band-top', 'band-bottom');
      const theme = getTheme(p.theme);
      body.append(
        h('span', { class: 'label' }, '位置'),
        h(
          'div',
          { class: 'chips' },
          options.map((o) =>
            h(
              'button',
              {
                class: `chip ${line.position === o ? 'on' : ''}`,
                onclick: () => {
                  line.position = o;
                  line.locked = true;
                  app.commit();
                },
              },
              o === null ? `標準（${POSITION_LABELS[p.position]}）` : POSITION_LABELS[o],
            ),
          ),
        ),
        h('span', { class: 'label' }, '色'),
        h(
          'div',
          { class: 'chips' },
          h(
            'button',
            {
              class: `chip ${line.color === null ? 'on' : ''}`,
              onclick: () => {
                line.color = null;
                app.commit();
              },
            },
            p.autoColor ? '自動' : '標準',
          ),
          theme.palette.map((sw, i) =>
            h('button', {
              class: `chip color ${line.color === i ? 'on' : ''}`,
              'aria-label': `色 ${i + 1}`,
              style: `background:linear-gradient(${sw.fill[0]},${sw.fill[1]});border-color:${sw.stroke};box-shadow:0 0 0 2px ${line.color === i ? 'var(--accent)' : 'transparent'}, 0 0 8px ${sw.glow}`,
              onclick: () => {
                line.color = i;
                line.locked = true;
                app.commit();
              },
            }),
          ),
        ),
      );
    }

    panel.append(
      h(
        'div',
        { class: 'panel-head' },
        h('strong', { class: 'panel-title' }, lineText(line)),
        h('button', { class: 'btn icon', 'aria-label': '閉じる', onclick: () => select(null) }, '×'),
      ),
      h('div', { class: 'segs' }, tab('motion', '演出'), tab('layers', `重ね${line.layers.length > 0 ? `(${line.layers.length})` : ''}`), tab('time', '時間'), tab('text', '文字'), tab('look', '位置と色')),
      body,
    );
  }

  // ---- 作品全体の見た目 ----------------------------------------------------
  function openSettings(): void {
    const close = (): void => overlay.remove();
    const range = (label: string, min: number, max: number, get: () => number, set: (v: number) => void): HTMLElement => {
      const input = h('input', {
        type: 'range',
        min: String(min),
        max: String(max),
        step: '0.05',
        value: String(get()),
        oninput: () => {
          set(parseFloat(input.value));
          player.setProject(p);
        },
        onchange: () => app.commit(),
      });
      return h('label', { class: 'slider' }, h('span', null, label), input);
    };
    const check = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement => {
      const input = h('input', {
        type: 'checkbox',
        checked: get(),
        onchange: () => {
          set(input.checked);
          app.commit();
        },
      });
      return h('label', { class: 'check' }, input, label);
    };
    const positions: Position[] =
      p.output.shape === 'portrait-fit' ? ['top', 'middle', 'bottom', 'band-top', 'band-bottom'] : ['top', 'middle', 'bottom'];
    const positionSelect = h(
      'select',
      {
        onchange: () => {
          p.position = positionSelect.value as Position;
          app.commit();
        },
      },
      positions.map((o) => h('option', { value: o, selected: p.position === o }, POSITION_LABELS[o])),
    );
    const themeSelect = h(
      'select',
      {
        onchange: () => {
          p.theme = themeSelect.value;
          app.commit();
        },
      },
      THEMES.map((t) => h('option', { value: t.id, selected: p.theme === t.id }, t.name)),
    );
    const portraitSource = p.video.height > p.video.width;
    const shapeSelect = h(
      'select',
      {
        disabled: portraitSource,
        onchange: () => {
          p.output.shape = shapeSelect.value as Project['output']['shape'];
          if (p.output.shape === 'landscape' && (p.position === 'band-top' || p.position === 'band-bottom')) {
            p.position = 'bottom';
          }
          app.commit();
          close();
        },
      },
      h('option', { value: 'landscape', selected: p.output.shape === 'landscape' }, '横のまま'),
      h('option', { value: 'portrait-fit', selected: p.output.shape === 'portrait-fit' }, '縦にはめ込み'),
    );
    const overlay = h(
      'div',
      { class: 'modal', onclick: (e: Event) => e.target === overlay && close() },
      h(
        'div',
        { class: 'modal-box', role: 'dialog', 'aria-modal': 'true' },
        h('h2', null, '作品全体の見た目'),
        h('label', { class: 'field inline' }, h('span', null, 'テーマ'), themeSelect),
        h('label', { class: 'field inline' }, h('span', null, '出力の形'), shapeSelect),
        h('label', { class: 'field inline' }, h('span', null, '標準の位置'), positionSelect),
        range('文字の大きさ', 0.6, 1.6, () => p.textScale, (v) => (p.textScale = v)),
        range('縁取りの太さ', 0, 2, () => p.outline, (v) => (p.outline = v)),
        check('影を付ける', () => p.shadow, (v) => (p.shadow = v)),
        check('映像の色に合わせて自動で配色する', () => p.autoColor, (v) => (p.autoColor = v)),
        h(
          'div',
          { class: 'row end' },
          h(
            'button',
            {
              class: 'btn',
              onclick: () => {
                close();
                go('setup', p.id);
              },
            },
            '歌詞・BPM・待機区間を直す',
          ),
          h('button', { class: 'btn primary', onclick: close }, '閉じる'),
        ),
      ),
    );
    document.body.appendChild(overlay);
  }

  // ---- 動画・自動配色 ------------------------------------------------------
  async function pickVideo(): Promise<void> {
    const file = await chooseVideoFile();
    if (!file) return;
    try {
      await attachVideo(file);
    } catch (e) {
      toast(e instanceof ExportError ? e.message : `動画を読み込めませんでした。（${errorText(e)}）`, 'error');
    }
  }

  function syncVideo(): void {
    player.setVideo(app.video?.url ?? null);
    videoBanner.hidden = !!app.video;
    clear(videoBanner);
    if (!app.video) {
      videoBanner.append(
        h('span', null, p.video.name ? `動画「${p.video.name}」を選び直してください` : '動画を選ぶと、映像の上で確かめられます'),
        h('button', { class: 'btn small primary', onclick: () => void pickVideo() }, '動画を選ぶ'),
      );
    }
    seekBar.max = String(player.duration);
  }

  /** 少し待ってから、時間や位置が変わった行の配色を調べ直す */
  function scheduleAutoColor(): void {
    window.clearTimeout(colorTimer);
    colorJob?.cancel();
    colorJob = null;
    colorStatus.textContent = '';
    if (!app.video || !p.autoColor) return;
    const file = app.video.file;
    colorTimer = window.setTimeout(() => {
      const target = p;
      const job = runAutoColor(target, file, (done, total) => {
        if (app.project !== target || colorJob !== job) return;
        colorStatus.textContent = total > 0 && done < total ? `色を合わせています ${done}/${total}` : '';
        if (total > 0) app.touch();
      });
      colorJob = job;
    }, 900);
  }

  // ---- 全体の更新 ----------------------------------------------------------
  function refreshAll(): void {
    titleEl.textContent = p.title || '（無題）';
    undoBtn.disabled = !app.canUndo;
    redoBtn.disabled = !app.canRedo;
    previewWrap.classList.toggle('portrait', p.output.shape === 'portrait-fit');
    player.setProject(p);
    seekBar.max = String(player.duration);
    if (selectedId && !selectedLine()) {
      selectedId = null;
      player.setLoop(null);
    }
    const line = selectedLine();
    if (line) player.setLoop({ start: Math.max(0, line.start - 0.15), end: line.end + 0.3 });
    renderList();
    timeline.update();
    renderPanel();
  }

  const onChange = (kind: ChangeKind): void => {
    if (!app.project) return;
    p = app.project;
    if (kind === 'live') {
      player.refresh();
      return;
    }
    if (kind === 'video') syncVideo();
    refreshAll();
    scheduleAutoColor();
  };
  const unsubscribe = app.subscribe(onChange);

  player.onTime = (t) => {
    timeLabel.textContent = `${formatTime(t)} / ${formatClock(player.duration)}`;
    if (!seeking) seekBar.value = String(t);
    if (view === 'timeline') timeline.setTime(t, player.playing);
    markNow(t);
  };
  player.onPlayState = (playing) => {
    playBtn.textContent = playing ? '⏸' : '▶';
  };

  const onKey = (e: KeyboardEvent): void => {
    if (tapping) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      player.toggle();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) app.redo();
      else app.undo();
    }
  };
  window.addEventListener('keydown', onKey);

  root.append(
    h(
      'div',
      { class: 'edit' },
      h(
        'header',
        { class: 'bar' },
        h('button', { class: 'btn small', onclick: () => go('list') }, '← 一覧'),
        titleEl,
        undoBtn,
        redoBtn,
        h('button', { class: 'btn small primary', onclick: () => go('export', p.id) }, '書き出す'),
      ),
      videoBanner,
      previewWrap,
      h('div', { class: 'transport' }, playBtn, seekBar, timeLabel),
      h(
        'div',
        { class: 'tools' },
        h('div', { class: 'segs' }, viewList, viewTimeline),
        h(
          'button',
          {
            class: 'btn small',
            onclick: () => {
              const lines = linesOf(p);
              if (lines.length === 0) return;
              const index = Math.max(0, lines.findIndex((l) => l.id === selectedId));
              tapping = true;
              select(null);
              openTapSync(player, index, () => {
                tapping = false;
              });
            },
          },
          'タップ同期',
        ),
        h(
          'button',
          {
            class: 'btn small',
            title: '固定していない行の演出を、すぐに選び直します',
            onclick: () => {
              const n = assignPresets(p, Math.floor(Math.random() * 1e9));
              app.commit();
              toast(n > 0 ? `${n} 行の演出を振り直しました（固定した行はそのまま）` : '振り直せる行がありません（すべて固定されています）');
            },
          },
          'おまかせで振り直す',
        ),
        h(
          'button',
          {
            class: 'btn small',
            title: '演出の案と、選んだ理由を見てから当てはめます。AIに相談することもできます',
            onclick: () => {
              if (linesOf(p).length === 0) return;
              openSuggest(p);
            },
          },
          '演出の提案',
        ),
        h('button', { class: 'btn small', onclick: openSettings }, '見た目'),
        colorStatus,
      ),
      h('div', { class: 'middle-area' }, listEl, timeline.el),
      panel,
    ),
  );

  syncVideo();
  refreshAll();
  scheduleAutoColor();
  player.refresh();

  return () => {
    unsubscribe();
    window.removeEventListener('keydown', onKey);
    window.clearTimeout(colorTimer);
    colorJob?.cancel();
    stopThumbs();
    player.destroy();
    document.querySelectorAll('.modal, .tap-overlay').forEach((el) => el.remove());
  };
}
