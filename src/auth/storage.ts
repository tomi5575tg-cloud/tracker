export interface StorageProvider {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
  clear?(): void | Promise<void>;
}

export class InMemoryStorageProvider implements StorageProvider {
  private store = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  public removeItem(key: string): void {
    this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }
}

export class SafeBrowserStorageProvider implements StorageProvider {
  private readonly storageType: 'localStorage' | 'sessionStorage';

  constructor(storageType: 'localStorage' | 'sessionStorage' = 'localStorage') {
    this.storageType = storageType;
  }

  private getStorage(): Storage | null {
    try {
      if (typeof window !== 'undefined' && window[this.storageType]) {
        return window[this.storageType];
      }
    } catch {
      // Storage might be restricted by security policies or sandbox
    }
    return null;
  }

  public getItem(key: string): string | null {
    const storage = this.getStorage();
    if (!storage) return null;
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  public setItem(key: string, value: string): void {
    const storage = this.getStorage();
    if (!storage) return;
    try {
      storage.setItem(key, value);
    } catch {
      // ignore quota exceeded or security errors
    }
  }

  public removeItem(key: string): void {
    const storage = this.getStorage();
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch {
      // ignore
    }
  }

  public clear(): void {
    const storage = this.getStorage();
    if (!storage) return;
    try {
      storage.clear();
    } catch {
      // ignore
    }
  }
}
