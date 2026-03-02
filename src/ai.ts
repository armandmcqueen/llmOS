import { generateText } from 'ai'
import { jsonSchema } from 'ai'
import { tool as aiTool } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type {
  AIConfig,
  AIInterface,
  AIRequestParams,
  AIResponse,
  StoreAccessor,
  Tool,
} from './types.js'

/**
 * Create a Vercel AI SDK provider model instance from our config.
 * Currently only supports Anthropic; easy to extend.
 */
function createProviderModel(
  provider: string,
  model: string,
  apiKey: string,
) {
  switch (provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey })
      return anthropic(model)
    }
    default:
      throw new Error(`Unsupported AI provider: ${provider}`)
  }
}

/**
 * Convert llm-os Tool[] to Vercel AI SDK tool format.
 */
function formatToolsForSDK(tools: Tool[]): Record<string, any> {
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

export class AIInterfaceImpl implements AIInterface {
  private config: AIConfig
  private kernelStore: StoreAccessor
  private taskId: string | null

  constructor(config: AIConfig, kernelStore: StoreAccessor, taskId?: string) {
    this.config = config
    this.kernelStore = kernelStore
    this.taskId = taskId ?? null
  }

  /** Returns a new instance scoped to a specific task ID. */
  forTask(taskId: string): AIInterfaceImpl {
    return new AIInterfaceImpl(this.config, this.kernelStore, taskId)
  }

  async request(params: AIRequestParams): Promise<AIResponse> {
    const model = params.model ?? this.config.defaultModel
    const startTime = Date.now()

    const result = await generateText({
      model: createProviderModel(
        this.config.provider,
        model,
        this.config.apiKey,
      ),
      system: params.system,
      messages: params.messages as any,
      tools: params.tools ? formatToolsForSDK(params.tools) : undefined,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
    })

    const response: AIResponse = {
      content: result.text ?? '',
      toolCalls: (result.toolCalls ?? []).map((tc) => ({
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: tc.args,
      })),
      usage: {
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        totalTokens:
          (result.usage?.promptTokens ?? 0) +
          (result.usage?.completionTokens ?? 0),
      },
      raw: result,
    }

    const durationMs = Date.now() - startTime

    // Log to kernel store
    this.kernelStore.append('ai/requests', {
      model,
      request: {
        system: params.system,
        messages: params.messages,
        tools: params.tools?.map((t) => t.name) ?? [],
      },
      response: {
        content: response.content,
        toolCalls: response.toolCalls,
        usage: response.usage,
      },
      durationMs,
      timestamp: new Date().toISOString(),
      taskId: this.taskId,
    })

    // Update cumulative usage for this task
    if (this.taskId) {
      const usageKey = `tasks/${this.taskId}/usage`
      const current = this.kernelStore.get(usageKey) ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        requestCount: 0,
      }
      this.kernelStore.set(usageKey, {
        promptTokens: current.promptTokens + response.usage.promptTokens,
        completionTokens:
          current.completionTokens + response.usage.completionTokens,
        totalTokens: current.totalTokens + response.usage.totalTokens,
        requestCount: current.requestCount + 1,
      })
    }

    return response
  }
}
