// llm-os v0.1 — Entry point

export type {
  StoreAccessor,
  Tool,
  Toolbox,
  AIConfig,
  AIRequestParams,
  Message,
  AIResponse,
  ToolCall,
  AIInterface,
  TaskDefinition,
  Handle,
  Result,
  TaskError,
  TaskContext,
  TaskMeta,
  LLMOSConfig,
  LLMOS,
} from './types.js'

import { Store } from './store.js'
import { ToolboxImpl } from './toolbox.js'
import { AIInterfaceImpl } from './ai.js'
import { defineTask, createSpawner } from './task.js'
import type { LLMOS, LLMOSConfig } from './types.js'

export { defineTask, createSpawner } from './task.js'
export { Store } from './store.js'
export { ToolboxImpl } from './toolbox.js'
export { AIInterfaceImpl } from './ai.js'

export function createLLMOS(config: LLMOSConfig): LLMOS {
  const store = new Store()
  const kernelStore = store.scope('/kernel/')
  const toolbox = new ToolboxImpl(kernelStore)
  const ai = new AIInterfaceImpl(config.ai, kernelStore)
  const spawn = createSpawner(store, ai, toolbox)

  return {
    store: { kernel: kernelStore },
    toolbox,
    defineTask,
    spawn,
  }
}
