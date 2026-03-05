import type { StoreAccessor } from './types.js'

export class Store {
  private data: Map<string, any> = new Map()

  /** Creates a scoped accessor that auto-prefixes all keys. */
  scope(prefix: string): StoreAccessor {
    return {
      get: (key) => this.data.get(prefix + key),
      set: (key, value) => {
        this.data.set(prefix + key, value)
      },
      delete: (key) => this.data.delete(prefix + key),
      list: (filterPrefix?: string) => {
        const fullPrefix = prefix + (filterPrefix ?? '')
        return Array.from(this.data.keys()).filter((k) =>
          k.startsWith(fullPrefix),
        )
      },
      append: (key, value) => {
        const fullKey = prefix + key
        const current = this.data.get(fullKey)
        if (current === undefined) {
          this.data.set(fullKey, [value])
        } else if (Array.isArray(current)) {
          current.push(value)
        } else {
          throw new Error(`Cannot append to non-array at ${fullKey}`)
        }
      },
    }
  }

  /** Raw accessor with no prefix. */
  raw(): StoreAccessor {
    return this.scope('')
  }

  /**
   * Returns a plain object snapshot of all store data.
   * Keys are store paths, values are the stored values.
   * This is the canonical serialization format for llmos state.
   */
  snapshot(): Record<string, any> {
    const result: Record<string, any> = {}
    for (const [key, value] of this.data) {
      result[key] = value
    }
    return result
  }

  /**
   * Load a snapshot into the store, replacing all existing data.
   * The snapshot should be a plain object in the format returned by snapshot().
   */
  load(snapshot: Record<string, any>): void {
    this.data.clear()
    for (const [key, value] of Object.entries(snapshot)) {
      this.data.set(key, value)
    }
  }
}
