import { describe, it, expect, beforeEach } from 'vitest'
import { Store } from '../store.js'

describe('Store', () => {
  let store: Store

  beforeEach(() => {
    store = new Store()
  })

  describe('raw accessor', () => {
    it('get returns undefined for missing keys', () => {
      const raw = store.raw()
      expect(raw.get('missing')).toBeUndefined()
    })

    it('set and get round-trip', () => {
      const raw = store.raw()
      raw.set('key', { hello: 'world' })
      expect(raw.get('key')).toEqual({ hello: 'world' })
    })

    it('set overwrites existing values', () => {
      const raw = store.raw()
      raw.set('key', 'first')
      raw.set('key', 'second')
      expect(raw.get('key')).toBe('second')
    })

    it('delete removes key and returns true', () => {
      const raw = store.raw()
      raw.set('key', 'value')
      expect(raw.delete('key')).toBe(true)
      expect(raw.get('key')).toBeUndefined()
    })

    it('delete returns false for missing key', () => {
      const raw = store.raw()
      expect(raw.delete('missing')).toBe(false)
    })

    it('list returns all keys', () => {
      const raw = store.raw()
      raw.set('/a/1', 'v1')
      raw.set('/a/2', 'v2')
      raw.set('/b/1', 'v3')
      expect(raw.list()).toEqual(
        expect.arrayContaining(['/a/1', '/a/2', '/b/1']),
      )
    })

    it('list filters by prefix', () => {
      const raw = store.raw()
      raw.set('/a/1', 'v1')
      raw.set('/a/2', 'v2')
      raw.set('/b/1', 'v3')
      expect(raw.list('/a/')).toEqual(
        expect.arrayContaining(['/a/1', '/a/2']),
      )
      expect(raw.list('/a/')).toHaveLength(2)
    })

    it('append creates array from undefined', () => {
      const raw = store.raw()
      raw.append('log', 'entry1')
      expect(raw.get('log')).toEqual(['entry1'])
    })

    it('append pushes to existing array', () => {
      const raw = store.raw()
      raw.append('log', 'entry1')
      raw.append('log', 'entry2')
      expect(raw.get('log')).toEqual(['entry1', 'entry2'])
    })

    it('append throws on non-array value', () => {
      const raw = store.raw()
      raw.set('key', 'not-an-array')
      expect(() => raw.append('key', 'value')).toThrow(
        'Cannot append to non-array at key',
      )
    })
  })

  describe('scoped accessor', () => {
    it('prefixes keys on set/get', () => {
      const scoped = store.scope('/task/abc/')
      scoped.set('findings', 'data')
      // The underlying key should be prefixed
      expect(store.raw().get('/task/abc/findings')).toBe('data')
      expect(scoped.get('findings')).toBe('data')
    })

    it('prefixes keys on delete', () => {
      const scoped = store.scope('/task/abc/')
      scoped.set('temp', 'val')
      expect(scoped.delete('temp')).toBe(true)
      expect(store.raw().get('/task/abc/temp')).toBeUndefined()
    })

    it('list returns full paths filtered by scope', () => {
      const raw = store.raw()
      raw.set('/task/abc/a', 1)
      raw.set('/task/abc/b', 2)
      raw.set('/task/xyz/a', 3)

      const scoped = store.scope('/task/abc/')
      const keys = scoped.list()
      expect(keys).toEqual(
        expect.arrayContaining(['/task/abc/a', '/task/abc/b']),
      )
      expect(keys).toHaveLength(2)
    })

    it('list with sub-prefix filters further', () => {
      const raw = store.raw()
      raw.set('/task/abc/data/1', 'v1')
      raw.set('/task/abc/data/2', 'v2')
      raw.set('/task/abc/meta', 'v3')

      const scoped = store.scope('/task/abc/')
      const keys = scoped.list('data/')
      expect(keys).toEqual(
        expect.arrayContaining(['/task/abc/data/1', '/task/abc/data/2']),
      )
      expect(keys).toHaveLength(2)
    })

    it('append works through scoped accessor', () => {
      const scoped = store.scope('/kernel/')
      scoped.append('ai/requests', { id: 1 })
      scoped.append('ai/requests', { id: 2 })
      expect(store.raw().get('/kernel/ai/requests')).toEqual([
        { id: 1 },
        { id: 2 },
      ])
    })
  })

  describe('prefix isolation', () => {
    it('scoped accessors with different prefixes are isolated', () => {
      const task1 = store.scope('/task/t1/')
      const task2 = store.scope('/task/t2/')

      task1.set('data', 'from-t1')
      task2.set('data', 'from-t2')

      expect(task1.get('data')).toBe('from-t1')
      expect(task2.get('data')).toBe('from-t2')
    })

    it('kernel scope is isolated from task scopes', () => {
      const kernel = store.scope('/kernel/')
      const task = store.scope('/task/abc/')

      kernel.set('meta', 'system')
      task.set('meta', 'user')

      expect(kernel.get('meta')).toBe('system')
      expect(task.get('meta')).toBe('user')
    })

    it('global scope is accessible from raw', () => {
      const global = store.scope('/global/')
      global.set('shared', 'data')
      expect(store.raw().get('/global/shared')).toBe('data')
    })
  })
})
