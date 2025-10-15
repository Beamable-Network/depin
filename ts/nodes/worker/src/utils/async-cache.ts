import { LRUCache } from 'lru-cache';

export class AsyncCache<K extends {}, V extends {}> {
  private cache: LRUCache<K, V, unknown>;
  private pendingFetches: Map<K, Promise<V>>;

  constructor(options: LRUCache.Options<K, V, unknown>) {
    this.cache = new LRUCache<K, V, unknown>(options);
    this.pendingFetches = new Map();
  }

  async get(key: K, fetchFn: () => Promise<V>): Promise<V> {
    // Check if value is already in cache
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Check if there's already a pending fetch for this key
    const pending = this.pendingFetches.get(key);
    if (pending) {
      return pending;
    }

    // Start a new fetch
    const fetchPromise = fetchFn()
      .then((value) => {
        this.cache.set(key, value);
        this.pendingFetches.delete(key);
        return value;
      })
      .catch((error) => {
        this.pendingFetches.delete(key);
        throw error;
      });

    this.pendingFetches.set(key, fetchPromise);
    return fetchPromise;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  set(key: K, value: V): void {
    this.cache.set(key, value);
  }

  delete(key: K): boolean {
    this.pendingFetches.delete(key);
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.pendingFetches.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
