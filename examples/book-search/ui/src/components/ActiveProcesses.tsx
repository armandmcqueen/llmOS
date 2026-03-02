import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { TaskMeta } from "../useStoreState.js";

interface Props {
  tasks: TaskMeta[];
  loading: boolean;
}

function statusDotClass(status: string): string {
  switch (status) {
    case "running":
      return "bg-warning";
    case "completed":
      return "bg-success";
    case "errored":
      return "bg-destructive";
    default:
      return "bg-muted-foreground";
  }
}

function statusTextClass(status: string): string {
  switch (status) {
    case "running":
      return "text-warning";
    case "completed":
      return "text-success";
    case "errored":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

export default function ActiveProcesses({ tasks, loading }: Props) {
  const [now, setNow] = useState(Date.now());
  const searchStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (loading && searchStartRef.current === null) {
      searchStartRef.current = Date.now();
    }
    if (!loading) {
      searchStartRef.current = null;
    }
  }, [loading]);

  useEffect(() => {
    if (tasks.length === 0 && !loading) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [tasks.length, loading]);

  if (tasks.length === 0 && !loading) return null;

  const completed = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  const pct = total > 0 ? (completed / total) * 100 : 0;

  const elapsed = searchStartRef.current
    ? Math.round((now - searchStartRef.current) / 1000)
    : 0;

  const sorted = [...tasks].sort((a, b) => {
    if (!a.parentId && b.parentId) return -1;
    if (a.parentId && !b.parentId) return 1;
    return a.name.localeCompare(b.name);
  });

  const allDone = total > 0 && completed === total;

  return (
    <Card className="gap-0 py-0 overflow-hidden">
      <CardHeader className="flex-row items-center justify-between px-4 py-3">
        <CardTitle className="text-sm">
          {allDone ? "Complete" : "Processing"} — {completed}/{total} workers
          complete
        </CardTitle>
        <span className="text-xs text-muted-foreground tabular-nums">
          {elapsed}s
        </span>
      </CardHeader>

      <div className="px-4 pb-2">
        <Progress
          value={pct}
          className={`h-1 ${allDone ? "[&>[data-slot=progress-indicator]]:bg-success" : "[&>[data-slot=progress-indicator]]:bg-warning"}`}
        />
      </div>

      <CardContent className="px-4 pb-3 pt-0">
        <div className="flex flex-col gap-1">
          {sorted.map((t) => {
            const taskElapsed = t.endTime
              ? Math.round(
                  (new Date(t.endTime).getTime() -
                    new Date(t.startTime).getTime()) /
                    1000
                )
              : Math.round(
                  (now - new Date(t.startTime).getTime()) / 1000
                );

            const statusText =
              t.status === "running"
                ? "searching…"
                : t.status === "completed"
                  ? "done"
                  : "error";

            return (
              <div
                key={t.id}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${statusDotClass(t.status)} ${t.status === "running" ? "animate-[status-pulse_1s_infinite]" : ""}`}
                />
                <span className="flex-1 truncate text-foreground/80">
                  {t.name}
                </span>
                <span className={`w-16 text-right ${statusTextClass(t.status)}`}>
                  {statusText}
                </span>
                <span className="w-8 text-right tabular-nums">
                  {taskElapsed}s
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
