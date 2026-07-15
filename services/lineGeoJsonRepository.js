const LINE_GEOJSON_DB_NAME = "urbs-line-geojson-db";
const LINE_GEOJSON_DB_VERSION = 1;
const LINE_GEOJSON_STORE_NAME = "line_geojson";

function openLineGeoJsonDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LINE_GEOJSON_DB_NAME, LINE_GEOJSON_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(LINE_GEOJSON_STORE_NAME)) {
        db.createObjectStore(LINE_GEOJSON_STORE_NAME, { keyPath: "cod" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha ao abrir IndexedDB de trajetos de linha."));
  });
}

export const lineGeoJsonRepository = {
  async withDb(callback) {
    const db = await openLineGeoJsonDb();
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
          const tx = db.transaction(LINE_GEOJSON_STORE_NAME, "readonly");
          const store = tx.objectStore(LINE_GEOJSON_STORE_NAME);
          const request = store.get(cod);

          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error || new Error("Falha ao ler trajeto da linha."));
        })
    );
  },

  async set(cod, data, url, cachedAt = Date.now()) {
    return this.withDb(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(LINE_GEOJSON_STORE_NAME, "readwrite");
          const store = tx.objectStore(LINE_GEOJSON_STORE_NAME);
          const request = store.put({ cod, data, url, cachedAt });

          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error || new Error("Falha ao salvar trajeto da linha."));
        })
    );
  },
};
