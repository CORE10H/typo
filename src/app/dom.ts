// 画面づくりの小さな道具。

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

/** 要素を作る。props の on〜 はイベント、class・style・data-* は属性、それ以外はプロパティとして入れる */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key === 'class') {
        el.className = String(value);
      } else if (key === 'style' || key.startsWith('data-') || key.startsWith('aria-') || key === 'for' || key === 'role') {
        el.setAttribute(key, String(value));
      } else {
        (el as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }
  append(el, children);
  return el;
}

function append(parent: Node, children: (Child | Child[])[]): void {
  for (const child of children) {
    if (Array.isArray(child)) append(parent, child);
    else if (child === null || child === undefined || child === false) continue;
    else parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el: Element): void {
  el.replaceChildren();
}

let toastTimer = 0;
/** 画面の下に短いお知らせを出す */
export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `show ${kind}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el && (el.className = ''), kind === 'error' ? 6000 : 2600);
}

/** はい／いいえを尋ねる。取り返しのつかない操作の前に使う */
export function confirmDialog(message: string, okLabel = 'はい', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (result: boolean): void => {
      overlay.remove();
      resolve(result);
    };
    const overlay = h(
      'div',
      { class: 'modal', onclick: (e: Event) => e.target === overlay && close(false) },
      h(
        'div',
        { class: 'modal-box', role: 'dialog', 'aria-modal': 'true' },
        h('p', null, message),
        h(
          'div',
          { class: 'row end' },
          h('button', { class: 'btn', onclick: () => close(false) }, 'やめる'),
          h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, okLabel),
        ),
      ),
    );
    document.body.appendChild(overlay);
  });
}

export function formatClock(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s - m * 60)).padStart(2, '0')}`;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}分${String(s % 60).padStart(2, '0')}秒` : `${s}秒`;
}

export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
