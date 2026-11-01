/* Persistent device-side recipe snapshot. No Pantry/plan writes while offline. */
const DB_NAME = 'kitchensync-recipe-hub-v1';
const STORE = 'snapshots';
function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function transaction(mode, action) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function cacheRecipeLibrary(recipes) {
  if (!Array.isArray(recipes)) return;
  await transaction('readwrite', store => store.put({ recipes, savedAt: new Date().toISOString() }, 'recipes'));
}
export async function readOfflineRecipes() {
  return (await transaction('readonly', store => store.get('recipes'))) || null;
}
export async function cacheRecipeHubOverview(overview) {
  if (!overview || typeof overview !== 'object') return;
  await transaction('readwrite', store => store.put(overview, 'overview'));
}
export async function readOfflineRecipeHubOverview() {
  return (await transaction('readonly', store => store.get('overview'))) || null;
}
