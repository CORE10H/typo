// 画面の切り替え。URL の # 以降で画面を決める（戻るボタンがそのまま効く）。

export type RouteName = 'list' | 'setup' | 'edit' | 'export';

export interface Route {
  name: RouteName;
  id: string | null;
}

export function parseRoute(): Route {
  const m = /^#\/(setup|edit|export)\/([\w-]+)$/.exec(location.hash);
  if (m) return { name: m[1] as RouteName, id: m[2] };
  return { name: 'list', id: null };
}

export function go(name: RouteName, id?: string, replace = false): void {
  const hash = name === 'list' ? '#/' : `#/${name}/${id}`;
  if (replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
}
