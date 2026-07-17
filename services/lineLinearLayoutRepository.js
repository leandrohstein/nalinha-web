const LINE_LINEAR_LAYOUT_DB_NAME = "urbs-line-linear-layout-db";
const LINE_LINEAR_LAYOUT_DB_VERSION = 1;
const LINE_LINEAR_LAYOUT_STORE_NAME = "line_linear_layout";

function openLineLinearLayoutDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LINE_LINEAR_LAYOUT_DB_NAME, LINE_LINEAR_LAYOUT_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(LINE_LINEAR_LAYOUT_STORE_NAME)) {
        db.createObjectStore(LINE_LINEAR_LAYOUT_STORE_NAME, { keyPath: "cod" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha ao abrir IndexedDB do mapa linear da linha."));
  });
}

export const lineLinearLayoutRepository = {
  async withDb(callback) {
    const db = await openLineLinearLayoutDb();
    try {
      return await callback(db);
    } finally {
      db.close();
    }
  },

  async get(cod) {
    return this.withDb(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(LINE_LINEAR_LAYOUT_STORE_NAME, "readonly");
          const store = tx.objectStore(LINE_LINEAR_LAYOUT_STORE_NAME);
          const request = store.get(cod);

          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error || new Error("Falha ao ler mapa linear da linha."));
        })
    );
  },

  async set(cod, groups, version, cachedAt = Date.now()) {
    return this.withDb(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(LINE_LINEAR_LAYOUT_STORE_NAME, "readwrite");
          const store = tx.objectStore(LINE_LINEAR_LAYOUT_STORE_NAME);
          const request = store.put({ cod, groups, version, cachedAt });

          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error || new Error("Falha ao salvar mapa linear da linha."));
        })
    );
  },
};
