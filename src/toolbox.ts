import { tool as aiTool } from 'ai'
import { jsonSchema } from 'ai'
import type { StoreAccessor, Tool, Toolbox } from './types.js'

export class ToolboxImpl implements Toolbox {
  private tools: Map<string, Tool> = new Map()
  private kernelStore: StoreAccessor

  constructor(kernelStore: StoreAccessor) {
    this.kernelStore = kernelStore
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  async execute(name: string, params: any, taskId?: string): Promise<any> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Tool not found: ${name}`)

    const startTime = Date.now()
    try {
      const result = await tool.execute(params)
      this.kernelStore.append('toolbox/invocations', {
        tool: name,
        params,
        result,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        taskId: taskId ?? null,
      })
      return result
    } catch (err) {
      this.kernelStore.append('toolbox/invocations', {
        tool: name,
        params,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        taskId: taskId ?? null,
      })
      throw err
    }
  }

  list(): Tool[] {
    return Array.from(this.tools.values())
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  toAITools(names?: string[]): Record<string, any> {
    const tools = names
      ? (names
          .map((n) => this.tools.get(n))
          .filter(Boolean) as Tool[])
      : Array.from(this.tools.values())

    const result: Record<string, any> = {}
    for (const t of tools) {
      result[t.name] = aiTool({
        description: t.description,
        parameters: jsonSchema(t.schema),
        execute: async (args) => t.execute(args),
      })
    }
    return result
  }
}
