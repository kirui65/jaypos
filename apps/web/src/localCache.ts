const databaseName = "ej-pos-cache";
const storeName = "records";
let opening: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB unavailable"));
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local cache"));
  });
  return opening;
}

export async function readLocal<T>(key: string): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function writeLocal<T>(key: string, value: T): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(storeName, "readwrite").objectStore(storeName).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
