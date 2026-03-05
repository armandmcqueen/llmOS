import { useState, useEffect, useRef, useCallback } from "react";

export interface StoreState {
  [key: string]: any;
}

/**
 * Polls /api/state every `intervalMs` while `active` is true.
 * Returns the latest store snapshot.
 */
export function useStoreState(active: boolean, intervalMs = 500) {
  const [state, setState] = useState<StoreState | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/state");
      if (res.ok) {
        setState(await res.json());
      }
    } catch {
      // ignore fetch errors during polling
    }
  }, []);

  useEffect(() => {
    if (active) {
      fetchState();
      intervalRef.current = setInterval(fetchState, intervalMs);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [active, intervalMs, fetchState]);

  // Do one final fetch when search completes
  useEffect(() => {
    if (!active && state) {
      fetchState();
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

// ─── Helpers for extracting typed data from the snapshot ─────────

export interface TaskMeta {
  id: string;
  name: string;
  status: "running" | "completed" | "errored";
  parentId: string | null;
  startTime: string;
  endTime: string | null;
  error: { message: string } | null;
}

export interface AIRequestLog {
  model: string;
  request: {
    system?: string;
    messages: { role: string; content: string }[];
    tools: string[];
  };
  response: {
    content: string;
    toolCalls: any[];
    usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  };
  durationMs: number;
  timestamp: string;
  taskId: string | null;
}

export interface TaskUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
}

export function extractTasks(state: StoreState): TaskMeta[] {
  const tasks: TaskMeta[] = [];
  for (const key of Object.keys(state)) {
    if (key.startsWith("/kernel/tasks/") && key.endsWith("/meta")) {
      tasks.push(state[key]);
    }
  }
  return tasks;
}

export function extractAIRequests(state: StoreState): AIRequestLog[] {
  return state["/kernel/ai/requests"] || [];
}

export function extractTaskUsage(state: StoreState, taskId: string): TaskUsage | null {
  return state[`/kernel/tasks/${taskId}/usage`] || null;
}
