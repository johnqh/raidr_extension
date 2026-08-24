import { sha256Hex } from './hash';

const STORE_NAME = 'content';

export interface ContentStore {
  put(bytes: Uint8Array): Promise<string>;
  get(hash: string): Promise<Uint8Array | null>;
  has(hash: string): Promise<boolean>;
  count(): Promise<number>;
  totalBytes(): Promise<number>;
}

interface ContentRow {
  hash: string;
  bytes: Uint8Array;
  size: number;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class IdbContentStore implements ContentStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly dbName: string,
    private readonly factory: IDBFactory
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = this.factory.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }

  private async tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  async put(bytes: Uint8Array): Promise<string> {
    const hash = await sha256Hex(bytes);
    if (await this.has(hash)) return hash;
    const store = await this.tx('readwrite');
    const row: ContentRow = { hash, bytes, size: bytes.byteLength };
    await promisify(store.put(row));
    return hash;
  }

  async get(hash: string): Promise<Uint8Array | null> {
    const store = await this.tx('readonly');
    const row = await promisify<ContentRow | undefined>(store.get(hash));
    return row ? row.bytes : null;
  }

  async has(hash: string): Promise<boolean> {
    const store = await this.tx('readonly');
    const key = await promisify<IDBValidKey | undefined>(store.getKey(hash));
    return key !== undefined;
  }

  async count(): Promise<number> {
    const store = await this.tx('readonly');
    return promisify(store.count());
  }

  async totalBytes(): Promise<number> {
    const store = await this.tx('readonly');
    const rows = await promisify<ContentRow[]>(store.getAll());
    return rows.reduce((sum, row) => sum + row.size, 0);
  }
}
