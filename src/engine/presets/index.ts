// 動き（プリセット）の一覧。仕様書6章の12種。
// 特殊型を足すときは、ファイルを1つ作ってここに1行足すだけでよい。

import { BASIC_PRESET_DEFS, makeBasicPreset } from './basic';
import { rondo } from './rondo';
import { shatter } from './shatter';
import { tangle } from './tangle';
import type { Preset } from './types';

const basic = new Map(BASIC_PRESET_DEFS.map((d) => [d.id, makeBasicPreset(d)]));
const pick = (id: string): Preset => {
  const p = basic.get(id);
  if (!p) throw new Error(`プリセット ${id} がありません`);
  return p;
};

/** 画面に並べる順（仕様書の表の順） */
export const PRESETS: Preset[] = [
  pick('fall'),
  pick('drip'),
  pick('pulse'),
  pick('impact'),
  rondo,
  shatter,
  pick('blur'),
  pick('whisper'),
  pick('tremble'),
  tangle,
  pick('sink'),
  pick('flash'),
];

const byId = new Map(PRESETS.map((p) => [p.id, p]));

export function getPreset(id: string): Preset {
  return byId.get(id) ?? PRESETS[0];
}

export function presetName(id: string): string {
  return getPreset(id).name;
}
