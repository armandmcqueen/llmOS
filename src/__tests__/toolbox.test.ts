import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Store } from '../store.js'
import { ToolboxImpl } from '../toolbox.js'
import type { StoreAccessor, Tool } from '../types.js'

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'test_tool',
    description: 'A test tool',
    schema: {
      type: 'object',
      properties: { input: { type: 'string' } },
      required: ['input'],
    },
    execute: async (params: { input: string }) => ({
      output: `processed: ${params.input}`,
    }),
    ...overrides,
  }
}

describe('Toolbox', () => {
  let store: Store
  let kernel: StoreAccessor
  let toolbox: ToolboxImpl

  beforeEach(() => {
    store = new Store()
    kernel = store.scope('/kernel/')
    toolbox = new ToolboxImpl(kernel)
  })

  describe('register + get + list', () => {
    it('registers and retrieves a tool by name', () => {
      const tool = makeTool()
      toolbox.register(tool)
      expect(toolbox.get('test_tool')).toBe(tool)
    })

    it('returns undefined for unknown tool', () => {
      expect(toolbox.get('nope')).toBeUndefined()
    })

    it('lists all registered tools', () => {
      toolbox.register(makeTool({ name: 'a' }))
      toolbox.register(makeTool({ name: 'b' }))
      const names = toolbox.list().map((t) => t.name)
      expect(names).toEqual(['a', 'b'])
    })

    it('overwrites tool with same name', () => {
      toolbox.register(makeTool({ description: 'v1' }))
      toolbox.register(makeTool({ description: 'v2' }))
      expect(toolbox.get('test_tool')?.description).toBe('v2')
      expect(toolbox.list()).toHaveLength(1)
    })
  })

  describe('execute', () => {
    it('calls tool and returns result', async () => {
      toolbox.register(makeTool())
      const result = await toolbox.execute('test_tool', { input: 'hello' })
      expect(result).toEqual({ output: 'processed: hello' })
    })

    it('throws on unknown tool', async () => {
      await expect(toolbox.execute('missing', {})).rejects.toThrow(
        'Tool not found: missing',
      )
    })

    it('logs successful invocation to kernel store', async () => {
      toolbox.register(makeTool())
      await toolbox.execute('test_tool', { input: 'hello' }, 'task-1')

      const logs = kernel.get('toolbox/invocations')
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({
        tool: 'test_tool',
        params: { input: 'hello' },
        result: { output: 'processed: hello' },
        taskId: 'task-1',
      })
      expect(logs[0].durationMs).toBeTypeOf('number')
      expect(logs[0].timestamp).toBeTypeOf('string')
    })

    it('logs null taskId when not provided', async () => {
      toolbox.register(makeTool())
      await toolbox.execute('test_tool', { input: 'x' })

      const logs = kernel.get('toolbox/invocations')
      expect(logs[0].taskId).toBeNull()
    })

    it('logs error and re-throws on tool failure', async () => {
      const failingTool = makeTool({
        name: 'fail_tool',
        execute: async () => {
          throw new Error('tool broke')
        },
      })
      toolbox.register(failingTool)

      await expect(
        toolbox.execute('fail_tool', { input: 'x' }, 'task-2'),
      ).rejects.toThrow('tool broke')

      const logs = kernel.get('toolbox/invocations')
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({
        tool: 'fail_tool',
        error: 'tool broke',
        taskId: 'task-2',
      })
      expect(logs[0].result).toBeUndefined()
    })

    it('accumulates multiple invocation logs', async () => {
      toolbox.register(makeTool())
      await toolbox.execute('test_tool', { input: 'a' })
      await toolbox.execute('test_tool', { input: 'b' })

      const logs = kernel.get('toolbox/invocations')
      expect(logs).toHaveLength(2)
    })
  })

  describe('toAITools', () => {
    it('converts all tools to AI SDK format', () => {
      toolbox.register(makeTool({ name: 'alpha', description: 'First tool' }))
      toolbox.register(makeTool({ name: 'beta', description: 'Second tool' }))

      const aiTools = toolbox.toAITools()
      expect(Object.keys(aiTools)).toEqual(['alpha', 'beta'])
      // Each tool should have the shape the AI SDK expects
      for (const key of Object.keys(aiTools)) {
        expect(aiTools[key]).toHaveProperty('parameters')
        expect(aiTools[key]).toHaveProperty('execute')
      }
    })

    it('filters to named subset', () => {
      toolbox.register(makeTool({ name: 'a' }))
      toolbox.register(makeTool({ name: 'b' }))
      toolbox.register(makeTool({ name: 'c' }))

      const aiTools = toolbox.toAITools(['a', 'c'])
      expect(Object.keys(aiTools)).toEqual(['a', 'c'])
    })

    it('skips unknown names in filter', () => {
      toolbox.register(makeTool({ name: 'a' }))
      const aiTools = toolbox.toAITools(['a', 'missing'])
      expect(Object.keys(aiTools)).toEqual(['a'])
    })

    it('returns empty object when no tools registered', () => {
      const aiTools = toolbox.toAITools()
      expect(aiTools).toEqual({})
    })

    it('execute on AI tool delegates to original tool', async () => {
      const spy = vi.fn(async (params: any) => ({ result: params.input }))
      toolbox.register(makeTool({ name: 'spy_tool', execute: spy }))

      const aiTools = toolbox.toAITools()
      const result = await aiTools['spy_tool'].execute({ input: 'test' })
      expect(result).toEqual({ result: 'test' })
      expect(spy).toHaveBeenCalledWith({ input: 'test' })
    })
  })
})
