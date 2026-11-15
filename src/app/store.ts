// 作品の保存先。ブラウザに備わったデータベース（IndexedDB）に、作品1つを1件として入れる。
// 動画ファイルそのものは保存しない（仕様書5章）。

import { normalizeProject, type Project } from '../core/model';

const DB_NAME = 'typo';
const STORE = 'projects';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('保存領域を開けませんでした'));
    };
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error('保存に失敗しました'));
        tx.onabort = () => reject(tx.error ?? new Error('保存が中断されました'));
      }),
  );
}

export async function listProjects(): Promise<Project[]> {
  const raw = await run<unknown[]>('readonly', (s) => s.getAll());
  return raw
    .map(normalizeProject)
    .filter((p): p is Project => p !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | null> {
  return normalizeProject(await run<unknown>('readonly', (s) => s.get(id)));
}

export async function saveProject(p: Project): Promise<void> {
  // 保存用に、ただのデータへ写し取る
  await run('readwrite', (s) => s.put(JSON.parse(JSON.stringify(p))));
}

export async function deleteProject(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

/** ブラウザに「このサイトのデータを勝手に消さないで」と頼む（断られても動作は続ける） */
export function requestPersistence(): void {
  void navigator.storage?.persist?.().catch(() => undefined);
}
