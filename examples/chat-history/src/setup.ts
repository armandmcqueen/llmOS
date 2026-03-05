/**
 * Setup / wiring — creates the LLMOS instance for the chat demo.
 *
 * Similar to book-search's createLLMOSWithStore but tailored for chat.
 */

import {
  Store,
  createSpawner,
  ToolboxImpl,
  AIInterfaceImpl,
} from 'llmos-v0'
import type { LLMOS } from 'llmos-v0'
import { defineTask } from 'llmos-v0'
import { MockAI } from './mock-ai.js'

export interface ChatLLMOSSetup {
  llmos: LLMOS
  store: Store
}

/**
 * Create an LLMOS instance for the chat demo.
 *
 * @param mode - 'mock' for testing (no API calls), 'real' for actual Haiku calls
 * @param apiKey - Anthropic API key (required for 'real' mode)
 * @param delayMs - Artificial delay for mock mode (default 0)
 */
export function createChatLLMOS(
  mode: 'mock' | 'real',
  apiKey?: string,
  delayMs = 0,
): ChatLLMOSSetup {
  const store = new Store()
  const kernelStore = store.scope('/kernel/')
  const toolbox = new ToolboxImpl(kernelStore)

  let ai: any
  if (mode === 'mock') {
    ai = new MockAI(kernelStore, undefined, delayMs)
  } else {
    if (!apiKey && !process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'ANTHROPIC_API_KEY is required for real mode. Set it as an env var or pass it directly.',
      )
    }
    ai = new AIInterfaceImpl(
      {
        provider: 'anthropic',
        apiKey: apiKey || process.env.ANTHROPIC_API_KEY || '',
        defaultModel: 'claude-3-5-haiku-20241022',
      },
      kernelStore,
    )
  }

  const spawn = createSpawner(store, ai, toolbox)

  const llmos: LLMOS = {
    store: { kernel: kernelStore },
    toolbox,
    defineTask,
    spawn,
  }

  return { llmos, store }
}
