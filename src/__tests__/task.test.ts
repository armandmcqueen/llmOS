import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Store } from '../store.js'
import { ToolboxImpl } from '../toolbox.js'
import { AIInterfaceImpl } from '../ai.js'
import { defineTask, createSpawner } from '../task.js'
import type { TaskMeta, TaskContext } from '../types.js'

// Mock generateText and anthropic provider — we don't make real AI calls in task tests
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return { ...actual, generateText: vi.fn() }
})
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => (model: string) => ({ modelId: model })),
}))

describe('defineTask', () => {
  it('is an identity function — returns the definition unchanged', () => {
    const def = defineTask({
      name: 'test',
      handler: async () => 'result',
    })
    expect(def.name).toBe('test')
    expect(def.handler).toBeTypeOf('function')
  })
})

describe('spawn + Handle', () => {
  let store: Store
  let kernel: ReturnType<Store['scope']>
  let toolbox: ToolboxImpl
  let ai: AIInterfaceImpl
  let spawn: ReturnType<typeof createSpawner>

  beforeEach(() => {
    store = new Store()
    kernel = store.scope('/kernel/')
    toolbox = new ToolboxImpl(kernel)
    ai = new AIInterfaceImpl(
      { provider: 'anthropic', apiKey: 'test', defaultModel: 'test-model' },
      kernel,
    )
    spawn = createSpawner(store, ai, toolbox)
  })

  describe('success path', () => {
    it('handle.wait() resolves with { ok: true, value }', async () => {
      const task = defineTask({
        name: 'simple',
        handler: async () => 42,
      })

      const handle = spawn(task, undefined)
      const result = await handle.wait()

      expect(result).toEqual({ ok: true, value: 42 })
    })

    it('handle.id is a UUID', async () => {
      const task = defineTask({
        name: 'simple',
        handler: async () => null,
      })

      const handle = spawn(task, undefined)
      expect(handle.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
      await handle.wait()
    })

    it('writes result to kernel store', async () => {
      const task = defineTask({
        name: 'writer',
        handler: async () => ({ data: 'hello' }),
      })

      const handle = spawn(task, undefined)
      await handle.wait()

      expect(kernel.get(`tasks/${handle.id}/result`)).toEqual({
        data: 'hello',
      })
    })
  })

  describe('error path', () => {
    it('handle.wait() resolves (not rejects) with { ok: false, error }', async () => {
      const task = defineTask({
        name: 'failing',
        handler: async () => {
          throw new Error('task broke')
        },
      })

      const handle = spawn(task, undefined)
      const result = await handle.wait()

      expect(result).toEqual({
        ok: false,
        error: { message: 'task broke', cause: undefined },
      })
    })

    it('preserves error cause', async () => {
      const task = defineTask({
        name: 'causal',
        handler: async () => {
          throw new Error('outer', { cause: 'inner reason' })
        },
      })

      const handle = spawn(task, undefined)
      const result = await handle.wait()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.cause).toBe('inner reason')
      }
    })

    it('handles non-Error throws', async () => {
      const task = defineTask({
        name: 'string-throw',
        handler: async () => {
          throw 'raw string error'
        },
      })

      const handle = spawn(task, undefined)
      const result = await handle.wait()

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toBe('raw string error')
      }
    })
  })

  describe('task metadata lifecycle', () => {
    it('writes initial metadata with status=running', async () => {
      let capturedId: string = ''
      const task = defineTask({
        name: 'meta-check',
        handler: async (ctx) => {
          capturedId = ctx.id
          // Check metadata while running
          const meta = kernel.get(`tasks/${ctx.id}/meta`) as TaskMeta
          expect(meta.status).toBe('running')
          expect(meta.name).toBe('meta-check')
          expect(meta.endTime).toBeNull()
          expect(meta.error).toBeNull()
          return 'done'
        },
      })

      const handle = spawn(task, undefined)
      await handle.wait()

      // After completion
      const meta = kernel.get(`tasks/${handle.id}/meta`) as TaskMeta
      expect(meta.status).toBe('completed')
      expect(meta.endTime).toBeTypeOf('string')
    })

    it('sets status=errored on failure', async () => {
      const task = defineTask({
        name: 'failing',
        handler: async () => {
          throw new Error('boom')
        },
      })

      const handle = spawn(task, undefined)
      await handle.wait()

      const meta = kernel.get(`tasks/${handle.id}/meta`) as TaskMeta
      expect(meta.status).toBe('errored')
      expect(meta.endTime).toBeTypeOf('string')
      expect(meta.error).toEqual({ message: 'boom', cause: undefined })
    })

    it('parentId is null for top-level spawn', async () => {
      const task = defineTask({
        name: 'top-level',
        handler: async () => 'ok',
      })

      const handle = spawn(task, undefined)
      await handle.wait()

      const meta = kernel.get(`tasks/${handle.id}/meta`) as TaskMeta
      expect(meta.parentId).toBeNull()
    })
  })

  describe('TaskContext', () => {
    it('provides scoped store accessors', async () => {
      const task = defineTask({
        name: 'store-test',
        handler: async (ctx) => {
          ctx.store.local.set('key', 'local-value')
          ctx.store.ephemeral.set('key', 'ephemeral-value')
          ctx.store.global.set('key', 'global-value')

          expect(ctx.store.local.get('key')).toBe('local-value')
          expect(ctx.store.ephemeral.get('key')).toBe('ephemeral-value')
          expect(ctx.store.global.get('key')).toBe('global-value')

          // Verify paths via raw
          expect(ctx.store.raw.get(`/task/${ctx.id}/key`)).toBe('local-value')
          expect(ctx.store.raw.get(`/ephemeral/tasks/${ctx.id}/key`)).toBe(
            'ephemeral-value',
          )
          expect(ctx.store.raw.get('/global/key')).toBe('global-value')
          return 'ok'
        },
      })

      const handle = spawn(task, undefined)
      const result = await handle.wait()
      expect(result.ok).toBe(true)
    })

    it('passes event to handler', async () => {
      const task = defineTask({
        name: 'event-test',
        handler: async (_ctx, event: { topic: string }) => {
          return `researched: ${event.topic}`
        },
      })

      const handle = spawn(task, { topic: 'AI agents' })
      const result = await handle.wait()
      expect(result).toEqual({ ok: true, value: 'researched: AI agents' })
    })

    it('provides ai and toolbox', async () => {
      const task = defineTask({
        name: 'deps-test',
        handler: async (ctx) => {
          expect(ctx.ai).toBeDefined()
          expect(ctx.ai.request).toBeTypeOf('function')
          expect(ctx.toolbox).toBeDefined()
          expect(ctx.toolbox.register).toBeTypeOf('function')
          return 'ok'
        },
      })

      const handle = spawn(task, undefined)
      await handle.wait()
    })
  })

  describe('ephemeral cleanup', () => {
    it('deletes ephemeral keys on success', async () => {
      const task = defineTask({
        name: 'ephemeral-success',
        handler: async (ctx) => {
          ctx.store.ephemeral.set('scratch', 'temp')
          ctx.store.ephemeral.set('cache', 'temp2')
          ctx.store.local.set('persistent', 'keep me')
          return 'done'
        },
      })

      const handle = spawn(task, undefined)
      await handle.wait()

      const raw = store.raw()
      // Ephemeral keys should be gone
      expect(
        raw.list(`/ephemeral/tasks/${handle.id}/`),
      ).toHaveLength(0)
      // Local keys should survive
      expect(raw.get(`/task/${handle.id}/persistent`)).toBe('keep me')
    })

    it('deletes ephemeral keys on error', async () => {
      const task = defineTask({
        name: 'ephemeral-error',
        handler: async (ctx) => {
          ctx.store.ephemeral.set('scratch', 'temp')
          throw new Error('fail')
        },
      })

      const handle = spawn(task, undefined)
      await handle.wait()

      const raw = store.raw()
      expect(
        raw.list(`/ephemeral/tasks/${handle.id}/`),
      ).toHaveLength(0)
    })
  })

  describe('parent-child spawning', () => {
    it('ctx.spawn sets parentId on child task', async () => {
      let childId: string = ''

      const child = defineTask({
        name: 'child',
        handler: async (ctx) => {
          childId = ctx.id
          expect(ctx.parentId).toBeTypeOf('string')
          return 'child-result'
        },
      })

      const parent = defineTask({
        name: 'parent',
        handler: async (ctx) => {
          const childHandle = ctx.spawn(child, undefined)
          const childResult = await childHandle.wait()
          return { childResult }
        },
      })

      const handle = spawn(parent, undefined)
      const result = await handle.wait()

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.childResult).toEqual({
          ok: true,
          value: 'child-result',
        })
      }

      // Verify parent-child relationship in metadata
      const childMeta = kernel.get(`tasks/${childId}/meta`) as TaskMeta
      expect(childMeta.parentId).toBe(handle.id)

      const parentMeta = kernel.get(`tasks/${handle.id}/meta`) as TaskMeta
      expect(parentMeta.parentId).toBeNull()
    })

    it('grandchild gets parent (not grandparent) as parentId', async () => {
      let grandchildId: string = ''
      let childId: string = ''

      const grandchild = defineTask({
        name: 'grandchild',
        handler: async (ctx) => {
          grandchildId = ctx.id
          return 'gc'
        },
      })

      const child = defineTask({
        name: 'child',
        handler: async (ctx) => {
          childId = ctx.id
          const h = ctx.spawn(grandchild, undefined)
          await h.wait()
          return 'c'
        },
      })

      const parent = defineTask({
        name: 'parent',
        handler: async (ctx) => {
          const h = ctx.spawn(child, undefined)
          await h.wait()
          return 'p'
        },
      })

      const handle = spawn(parent, undefined)
      await handle.wait()

      const gcMeta = kernel.get(`tasks/${grandchildId}/meta`) as TaskMeta
      expect(gcMeta.parentId).toBe(childId)

      const cMeta = kernel.get(`tasks/${childId}/meta`) as TaskMeta
      expect(cMeta.parentId).toBe(handle.id)
    })
  })

  describe('tool registration', () => {
    it('registers task tools with the toolbox on spawn', async () => {
      const task = defineTask({
        name: 'with-tools',
        tools: [
          {
            name: 'custom_tool',
            description: 'A custom tool',
            schema: { type: 'object', properties: {} },
            execute: async () => 'result',
          },
        ],
        handler: async () => 'done',
      })

      spawn(task, undefined)
      expect(toolbox.get('custom_tool')).toBeDefined()
    })

    it('does not overwrite existing tools', async () => {
      const existingTool = {
        name: 'shared_tool',
        description: 'original',
        schema: {},
        execute: async () => 'original',
      }
      toolbox.register(existingTool)

      const task = defineTask({
        name: 'with-dup-tool',
        tools: [
          {
            name: 'shared_tool',
            description: 'replacement',
            schema: {},
            execute: async () => 'replaced',
          },
        ],
        handler: async () => 'done',
      })

      spawn(task, undefined)
      expect(toolbox.get('shared_tool')?.description).toBe('original')
    })
  })

  describe('concurrent tasks', () => {
    it('multiple tasks run concurrently', async () => {
      const order: string[] = []

      const task = defineTask({
        name: 'concurrent',
        handler: async (_ctx, event: { label: string; delay: number }) => {
          await new Promise((r) => setTimeout(r, event.delay))
          order.push(event.label)
          return event.label
        },
      })

      const h1 = spawn(task, { label: 'slow', delay: 50 })
      const h2 = spawn(task, { label: 'fast', delay: 10 })

      const [r1, r2] = await Promise.all([h1.wait(), h2.wait()])

      expect(r1).toEqual({ ok: true, value: 'slow' })
      expect(r2).toEqual({ ok: true, value: 'fast' })
      // Fast should finish first
      expect(order).toEqual(['fast', 'slow'])
    })
  })
})
