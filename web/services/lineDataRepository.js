const LINE_DB_NAME = "urbs-line-data-db";
const LINE_DB_VERSION = 1;
const LINE_STORE_NAME = "line_data";
const META_STORE_NAME = "metadata";
const LAST_SYNC_KEY = "last_sync";

function openLineDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LINE_DB_NAME, LINE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(LINE_STORE_NAME)) {
        db.createObjectStore(LINE_STORE_NAME, { keyPath: "COD" });
      }

      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha ao abrir IndexedDB de linhas."));
  });
}

function runRequest(request, errorMessage) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(errorMessage));
  });
}

function waitForTransaction(tx, errorMessage) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error(errorMessage));
    tx.onabort = () => reject(tx.error || new Error(errorMessage));
  });
}

export const lineDataRepository = {
  async withDb(callback) {
    const db = await openLineDb();
    try {
      return await callback(db);
    } finally {
      db.close();
    }
  },

  async getSnapshot() {
    return this.withDb(async (db) => {
      const lineTx = db.transaction(LINE_STORE_NAME, "readonly");
      const lineStore = lineTx.objectStore(LINE_STORE_NAME);
      const lines = await runRequest(lineStore.getAll(), "Falha ao ler linhas do cache.");

      const metaTx = db.transaction(META_STORE_NAME, "readonly");
      const metaStore = metaTx.objectStore(META_STORE_NAME);
      const metadata = await runRequest(metaStore.get(LAST_SYNC_KEY), "Falha ao ler metadata do cache.");

      return {
        data: lines,
        cachedAt: metadata ? metadata.cachedAt : null,
      };
    });
  },

  async getByCod(cod) {
    return this.withDb(async (db) => {
      const tx = db.transaction(LINE_STORE_NAME, "readonly");
      const store = tx.objectStore(LINE_STORE_NAME);
      const normalizedCod = typeof cod === "number" ? String(cod) : cod;

      return runRequest(store.get(normalizedCod), "Falha ao ler linha por COD.");
    });
  },

  async replaceAll(lines, cachedAt = Date.now()) {
    return this.withDb(async (db) => {
      const tx = db.transaction([LINE_STORE_NAME, META_STORE_NAME], "readwrite");
      const lineStore = tx.objectStore(LINE_STORE_NAME);
      const metaStore = tx.objectStore(META_STORE_NAME);

      lineStore.clear();
      lines.forEach((line) => {
        lineStore.put(line);
      });
      metaStore.put({
        key: LAST_SYNC_KEY,
        cachedAt,
      });

      await waitForTransaction(tx, "Falha ao salvar linhas no cache.");
    });
  },
};
