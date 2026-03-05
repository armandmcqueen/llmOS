import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { AIRequestLog } from "../useStoreState.js";

interface Props {
  requests: AIRequestLog[];
}

function RequestCard({ req, index }: { req: AIRequestLog; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        className="flex w-full items-center justify-between px-4 py-2 text-xs hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-muted-foreground/50 font-mono text-[11px]">
            #{index + 1}
          </span>
          <span className="text-chart-1 font-mono">{req.model}</span>
          <span className="text-muted-foreground/50 font-mono text-[11px]">
            {req.taskId ? req.taskId.slice(0, 8) : "no task"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">
            {req.response.usage.totalTokens} tok
          </span>
          <span className="text-muted-foreground/50">{req.durationMs}ms</span>
          {expanded ? (
            <ChevronDown className="size-3 text-muted-foreground/50" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground/50" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {req.request.system && (
            <div>
              <div className="text-[11px] font-semibold uppercase text-muted-foreground/50 mb-1">
                System
              </div>
              <pre className="rounded border bg-background p-2 text-[11px] text-muted-foreground overflow-auto max-h-36 whitespace-pre-wrap break-all">
                {req.request.system.slice(0, 300)}
              </pre>
            </div>
          )}
          <div>
            <div className="text-[11px] font-semibold uppercase text-muted-foreground/50 mb-1">
              User Message
            </div>
            <pre className="rounded border bg-background p-2 text-[11px] text-muted-foreground overflow-auto max-h-36 whitespace-pre-wrap break-all">
              {(
                req.request.messages.find((m) => m.role === "user")?.content ||
                ""
              ).slice(0, 300)}
              {(
                req.request.messages.find((m) => m.role === "user")?.content ||
                ""
              ).length > 300
                ? "..."
                : ""}
            </pre>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase text-muted-foreground/50 mb-1">
              Response
            </div>
            <pre className="rounded border bg-background p-2 text-[11px] text-muted-foreground overflow-auto max-h-36 whitespace-pre-wrap break-all">
              {req.response.content.slice(0, 500)}
              {req.response.content.length > 500 ? "..." : ""}
            </pre>
          </div>
          <div className="flex gap-4 text-[11px] text-muted-foreground/50 pt-1">
            <span>Prompt: {req.response.usage.promptTokens}</span>
            <span>Completion: {req.response.usage.completionTokens}</span>
            <span>Total: {req.response.usage.totalTokens}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AILog({ requests }: Props) {
  return (
    <Card className="gap-0 py-0 overflow-hidden">
      <CardHeader className="px-4 py-3 border-b">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          AI Requests ({requests.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[500px] overflow-y-auto">
          {requests.map((req, i) => (
            <RequestCard key={i} req={req} index={i} />
          ))}
          {requests.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground/50">
              No AI requests yet
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
