import { v4 as uuidv4 } from 'uuid'
import type { Store } from './store.js'
import type { AIInterfaceImpl } from './ai.js'
import type {
  Handle,
  Result,
  TaskContext,
  TaskDefinition,
  TaskError,
  TaskMeta,
  Toolbox,
} from './types.js'

/** Type-safe identity function — returns the definition unchanged. */
export function defineTask<TEvent, TResult>(
  definition: TaskDefinition<TEvent, TResult>,
): TaskDefinition<TEvent, TResult> {
  return definition
}

/**
 * Creates a spawn function that closes over the system dependencies.
 * The returned function can spawn tasks at the top level (parentId = undefined)
 * or be wrapped to inject a parentId for child spawns.
 */
export function createSpawner(
  store: Store,
  ai: AIInterfaceImpl,
  toolbox: Toolbox,
) {
  function spawnWithParent(parentId: string | undefined) {
    return function spawn<TEvent, TResult>(
      task: TaskDefinition<TEvent, TResult>,
      event: TEvent,
    ): Handle<TResult> {
      const taskId = uuidv4()
      const kernelStore = store.scope('/kernel/')

      // Register task tools if not already registered
      if (task.tools) {
        for (const tool of task.tools) {
          if (!toolbox.get(tool.name)) {
            toolbox.register(tool)
          }
        }
      }

      // Write initial metadata
      const meta: TaskMeta = {
        id: taskId,
        name: task.name,
        status: 'running',
        parentId: parentId ?? null,
        startTime: new Date().toISOString(),
        endTime: null,
        error: null,
      }
      kernelStore.set(`tasks/${taskId}/meta`, meta)

      // Assemble TaskContext
      const ctx: TaskContext = {
        id: taskId,
        parentId,
        store: {
          local: store.scope(`/task/${taskId}/`),
          ephemeral: store.scope(`/ephemeral/tasks/${taskId}/`),
          global: store.scope('/global/'),
          raw: store.raw(),
        },
        ai: ai.forTask(taskId),
        toolbox,
        spawn: spawnWithParent(taskId),
      }

      // Create the internal promise that the handle exposes
      let resolveHandle: (result: Result<TResult, TaskError>) => void
      const handlePromise = new Promise<Result<TResult, TaskError>>(
        (resolve) => {
          resolveHandle = resolve
        },
      )

      // Call handler (do not await — fire and forget)
      const handlerPromise = task.handler(ctx, event)

      handlerPromise.then(
        (value) => {
          // Success
          kernelStore.set(`tasks/${taskId}/result`, value)

          const currentMeta = kernelStore.get(
            `tasks/${taskId}/meta`,
          ) as TaskMeta
          currentMeta.status = 'completed'
          currentMeta.endTime = new Date().toISOString()
          kernelStore.set(`tasks/${taskId}/meta`, currentMeta)

          // Ephemeral cleanup
          cleanupEphemeral(store, taskId)

          resolveHandle!({ ok: true, value })
        },
        (err) => {
          // Error
          const error: TaskError = {
            message: err instanceof Error ? err.message : String(err),
            cause: err instanceof Error ? err.cause : undefined,
          }

          const currentMeta = kernelStore.get(
            `tasks/${taskId}/meta`,
          ) as TaskMeta
          currentMeta.status = 'errored'
          currentMeta.endTime = new Date().toISOString()
          currentMeta.error = error
          kernelStore.set(`tasks/${taskId}/meta`, currentMeta)

          // Ephemeral cleanup
          cleanupEphemeral(store, taskId)

          resolveHandle!({ ok: false, error })
        },
      )

      return {
        id: taskId,
        wait: () => handlePromise,
      }
    }
  }

  return spawnWithParent(undefined)
}

/** Delete all ephemeral keys for a task. */
function cleanupEphemeral(store: Store, taskId: string): void {
  const raw = store.raw()
  const ephemeralPrefix = `/ephemeral/tasks/${taskId}/`
  const keys = raw.list(ephemeralPrefix)
  for (const key of keys) {
    raw.delete(key)
  }
}
