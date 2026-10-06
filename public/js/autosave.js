// Periodic save states in IndexedDB, so a reloaded page (iOS killing the tab, an accidental
// back swipe) can continue where the player was. One slot per game.

const DB = "retro-arena";
const STORE = "autosave";
const MAX_AGE = 24 * 60 * 60 * 1000;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}

export async function loadAutosave(gameId) {
  try {
    const save = await tx("readonly", (s) => s.get(gameId));
    return save && Date.now() - save.time < MAX_AGE ? save : null;
  } catch {
    return null;
  }
}

export function clearAutosave(gameId) {
  return tx("readwrite", (s) => s.delete(gameId)).catch(() => {});
}

// Saves every `intervalMs` while the page is visible, and right before it gets hidden.
export function startAutosave(gameId, mode, gameManager, intervalMs = 30000) {
  const save = () => {
    try {
      const state = gameManager.getState().slice(); // copy out of the wasm heap
      tx("readwrite", (s) => s.put({ state, mode, time: Date.now() }, gameId)).catch(() => {});
    } catch (e) {
      console.warn("autosave failed", e);
    }
  };
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") save();
  }, intervalMs);
  const onHide = () => {
    if (document.visibilityState === "hidden") save();
  };
  document.addEventListener("visibilitychange", onHide);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onHide);
  };
}
