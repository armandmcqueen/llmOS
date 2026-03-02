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
}
