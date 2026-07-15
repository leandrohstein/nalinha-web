const CACHE_DB_NAME = "urbs-cache-db";
const CACHE_DB_VERSION = 2;
const CACHE_STORE_NAME = "vehicle_data";

function openCacheDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(CACHE_STORE_NAME)) {
        db.deleteObjectStore(CACHE_STORE_NAME);
      }

      db.createObjectStore(CACHE_STORE_NAME, { keyPath: "dateTimeKey" });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha ao abrir IndexedDB."));
  });
}

export const cacheRepository = {
  async withDb(callback) {
    const db = await openCacheDb();
    try {
      return await callback(db);
    } finally {
      db.close();
    }
  },

  async getEntry(dateTimeKey) {
    return this.withDb(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(CACHE_STORE_NAME, "readonly");
          const store = tx.objectStore(CACHE_STORE_NAME);
          const request = store.get(dateTimeKey);

          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error || new Error("Falha ao ler cache."));
        })
    );
  },

  async get(dateTimeKey) {
    const entry = await this.getEntry(dateTimeKey);
    return entry ? entry.data : null;
  },

  async getEntriesForDate(dateKey) {
    return this.getEntriesInRange(`${dateKey} 00:00`, `${dateKey} 23:59`);
  },

  async getEntriesInRange(startKey, endKey) {
    return this.withDb(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(CACHE_STORE_NAME, "readonly");
          const store = tx.objectStore(CACHE_STORE_NAME);
          const range = IDBKeyRange.bound(startKey, endKey);
          const request = store.getAll(range);

          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error || new Error("Falha ao ler cache no intervalo."));
        })
    );
  },

  async set(dateTimeKey, data, url = null) {
    return this.withDb(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(CACHE_STORE_NAME, "readwrite");
          const store = tx.objectStore(CACHE_STORE_NAME);
          const request = store.put({
            dateTimeKey,
            url,
            data,
            cachedAt: Date.now(),
          });

          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error || new Error("Falha ao salvar cache."));
        })
    );
  },
};
