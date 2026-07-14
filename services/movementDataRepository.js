const MOVEMENT_DB_NAME = "urbs-movement-db";
const MOVEMENT_DB_VERSION = 1;
const MOVEMENT_STORE_NAME = "movement_tracks";

function openMovementDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MOVEMENT_DB_NAME, MOVEMENT_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MOVEMENT_STORE_NAME)) {
        db.createObjectStore(MOVEMENT_STORE_NAME, { keyPath: "dateKey" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha ao abrir IndexedDB de trajetos."));
  });
}

export const movementDataRepository = {
  async withDb(callback) {
    const db = await openMovementDb();
    try {
      return await callback(db);
    } finally {
      db.close();
    }
  },

  async get(dateKey) {
    return this.withDb(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(MOVEMENT_STORE_NAME, "readonly");
          const store = tx.objectStore(MOVEMENT_STORE_NAME);
          const request = store.get(dateKey);

          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error || new Error("Falha ao ler trajeto processado."));
        })
    );
  },

  async set(record) {
    return this.withDb(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(MOVEMENT_STORE_NAME, "readwrite");
          const store = tx.objectStore(MOVEMENT_STORE_NAME);
          const request = store.put(record);

          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error || new Error("Falha ao salvar trajeto processado."));
        })
    );
  },
};
