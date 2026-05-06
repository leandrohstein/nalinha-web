const VEHICLE_TYPE_DB_NAME = "urbs-vehicle-type-data-db";
const VEHICLE_TYPE_DB_VERSION = 1;
const VEHICLE_TYPE_STORE_NAME = "vehicle_type_data";
const META_STORE_NAME = "metadata";
const LAST_SYNC_KEY = "last_sync";

function openVehicleTypeDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VEHICLE_TYPE_DB_NAME, VEHICLE_TYPE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(VEHICLE_TYPE_STORE_NAME)) {
        db.createObjectStore(VEHICLE_TYPE_STORE_NAME, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha ao abrir IndexedDB de tipos de veiculo."));
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

export const vehicleTypeDataRepository = {
  async withDb(callback) {
    const db = await openVehicleTypeDb();
    try {
      return await callback(db);
    } finally {
      db.close();
    }
  },

  async getSnapshot() {
    return this.withDb(async (db) => {
      const dataTx = db.transaction(VEHICLE_TYPE_STORE_NAME, "readonly");
      const dataStore = dataTx.objectStore(VEHICLE_TYPE_STORE_NAME);
      const items = await runRequest(dataStore.getAll(), "Falha ao ler tipos de veiculo do cache.");

      const metaTx = db.transaction(META_STORE_NAME, "readonly");
      const metaStore = metaTx.objectStore(META_STORE_NAME);
      const metadata = await runRequest(metaStore.get(LAST_SYNC_KEY), "Falha ao ler metadata do cache.");

      return {
        data: items,
        cachedAt: metadata ? metadata.cachedAt : null,
      };
    });
  },

  async getById(id) {
    return this.withDb(async (db) => {
      const tx = db.transaction(VEHICLE_TYPE_STORE_NAME, "readonly");
      const store = tx.objectStore(VEHICLE_TYPE_STORE_NAME);
      const normalizedId = typeof id === "string" ? Number(id) : id;

      return runRequest(store.get(normalizedId), "Falha ao ler tipo de veiculo por id.");
    });
  },

  async replaceAll(items, cachedAt = Date.now()) {
    return this.withDb(async (db) => {
      const tx = db.transaction([VEHICLE_TYPE_STORE_NAME, META_STORE_NAME], "readwrite");
      const dataStore = tx.objectStore(VEHICLE_TYPE_STORE_NAME);
      const metaStore = tx.objectStore(META_STORE_NAME);

      dataStore.clear();
      items.forEach((item) => {
        dataStore.put(item);
      });
      metaStore.put({
        key: LAST_SYNC_KEY,
        cachedAt,
      });

      await waitForTransaction(tx, "Falha ao salvar tipos de veiculo no cache.");
    });
  },
};
