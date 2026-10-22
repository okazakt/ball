import { encodeStage } from './stage.js';
let db;
export let persistent = true;
const memory = new Map();
export async function openStorage() {
  try {
    db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('toukan', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('stages', { keyPath: 'id' });
        r.result.createObjectStore('meta');
        r.result.createObjectStore('replays', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch {
    persistent = false;
  }
}
function transaction(name, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    let result;
    try {
      result = action(tx.objectStore(name));
    } catch (e) {
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function listStages() {
  return db ? transaction('stages', 'readonly', (s) => s.getAll()) : [...memory.values()];
}
export async function saveStage(stage, favorite = false) {
  const id = encodeStage(stage);
  const all = await listStages();
  const old = all.find((s) => s.id === id);
  const item = {
    id,
    stage,
    favorite: favorite || old?.favorite || false,
    time: Math.max(Date.now(), ...all.map((s) => s.time + 1)),
  };
  if (db) {
    await transaction('stages', 'readwrite', (s) => s.put(item));
    const recent = [...all.filter((s) => s.id !== id), item]
      .filter((s) => !s.favorite)
      .sort((a, b) => b.time - a.time);
    await transaction('stages', 'readwrite', (s) => {
      recent.slice(50).forEach((r) => s.delete(r.id));
    });
  } else {
    memory.set(id, item);
    const recent = [...memory.values()].filter((s) => !s.favorite).sort((a, b) => b.time - a.time);
    recent.slice(50).forEach((r) => memory.delete(r.id));
  }
  return item;
}
export async function removeStage(id) {
  if (db) await transaction('stages', 'readwrite', (s) => s.delete(id));
  else memory.delete(id);
}
export async function toggleFavorite(item) {
  item.favorite = !item.favorite;
  if (db) await transaction('stages', 'readwrite', (s) => s.put(item));
  else memory.set(item.id, item);
  const recent = (await listStages()).filter((s) => !s.favorite).sort((a, b) => b.time - a.time);
  for (const old of recent.slice(50)) await removeStage(old.id);
}
export async function getUnlocked() {
  return db ? (await transaction('meta', 'readonly', (s) => s.get('unlocked'))) ?? 1 : 1;
}
export async function unlock(n) {
  const previous = await getUnlocked();
  if (db) await transaction('meta', 'readwrite', (s) => s.put(Math.max(n, previous), 'unlocked'));
}
export async function saveReplay(data) {
  if (!db) return;
  await transaction('replays', 'readwrite', (s) => s.put({ id: 'latest', ...data }));
}

export async function getReplay() {
  return db ? transaction('replays', 'readonly', (s) => s.get('latest')) : undefined;
}
