import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StoreState, TaskMeta, TaskUsage } from "../useStoreState.js";
import { extractTaskUsage } from "../useStoreState.js";

interface Props {
  state: StoreState;
  tasks: TaskMeta[];
}

export default function UsageSummary({ state, tasks }: Props) {
  const taskUsages: { name: string; id: string; usage: TaskUsage }[] = [];
  let totalPrompt = 0;
  let totalCompletion = 0;
  let totalRequests = 0;

  for (const task of tasks) {
    const usage = extractTaskUsage(state, task.id);
    if (usage && usage.requestCount > 0) {
      taskUsages.push({ name: task.name, id: task.id, usage });
      totalPrompt += usage.promptTokens;
      totalCompletion += usage.completionTokens;
      totalRequests += usage.requestCount;
    }
  }

  const totalTokens = totalPrompt + totalCompletion;
  const maxTokens = Math.max(1, ...taskUsages.map((t) => t.usage.totalTokens));

  return (
    <Card className="gap-0 py-0 overflow-hidden">
      <CardHeader className="px-4 py-3 border-b">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Token Usage
        </CardTitle>
      </CardHeader>

      <CardContent className="p-0">
        {/* Totals row */}
        <div className="flex gap-6 px-4 py-3 border-b border-border/50">
          {[
            { label: "Total", value: totalTokens.toLocaleString() },
            { label: "Prompt", value: totalPrompt.toLocaleString() },
            { label: "Completion", value: totalCompletion.toLocaleString() },
            { label: "Requests", value: String(totalRequests) },
          ].map((item) => (
            <div key={item.label} className="flex flex-col gap-0.5">
              <span className="text-[11px] uppercase text-muted-foreground/50">
                {item.label}
              </span>
              <span className="text-lg font-bold text-foreground font-mono">
                {item.value}
              </span>
            </div>
          ))}
        </div>

        {/* Bar chart */}
        <div className="flex flex-col gap-1 px-4 py-2 max-h-72 overflow-y-auto">
          {taskUsages.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-xs">
              <span
                className="w-32 shrink-0 truncate font-mono text-[11px] text-muted-foreground"
                title={t.id}
              >
                {t.name}
              </span>
              <div className="flex flex-1 h-3 overflow-hidden rounded-sm bg-background">
                <div
                  className="h-full bg-chart-1 transition-all duration-300"
                  style={{
                    width: `${(t.usage.promptTokens / maxTokens) * 100}%`,
                  }}
                />
                <div
                  className="h-full bg-success transition-all duration-300"
                  style={{
                    width: `${(t.usage.completionTokens / maxTokens) * 100}%`,
                  }}
                />
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted-foreground/50">
                {t.usage.totalTokens}
              </span>
            </div>
          ))}
        </div>

        {/* Legend */}
        {taskUsages.length > 0 && (
          <div className="flex gap-4 px-4 py-2 text-[11px] text-muted-foreground/50 border-t border-border/50">
            <span>
              <span className="text-chart-1">■</span> prompt
            </span>
            <span>
              <span className="text-success">■</span> completion
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
