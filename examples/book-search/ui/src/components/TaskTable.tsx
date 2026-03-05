import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TaskMeta } from "../useStoreState.js";

interface Props {
  tasks: TaskMeta[];
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

export default function TaskTable({ tasks }: Props) {
  const sorted = [...tasks].sort((a, b) => {
    if (!a.parentId && b.parentId) return -1;
    if (a.parentId && !b.parentId) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <Card className="gap-0 py-0 overflow-hidden">
      <CardHeader className="px-4 py-3 border-b">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Tasks ({tasks.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[400px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 px-4 text-xs">Status</TableHead>
                <TableHead className="h-8 px-4 text-xs">Name</TableHead>
                <TableHead className="h-8 px-4 text-xs">Parent</TableHead>
                <TableHead className="h-8 px-4 text-xs">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((t) => {
                const duration =
                  t.endTime && t.startTime
                    ? new Date(t.endTime).getTime() -
                      new Date(t.startTime).getTime()
                    : null;

                return (
                  <TableRow key={t.id}>
                    <TableCell className="px-4 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-block size-2 rounded-full ${statusDotClass(t.status)} ${t.status === "running" ? "animate-[status-pulse_1s_infinite]" : ""}`}
                        />
                        <span className={`text-xs ${statusTextClass(t.status)}`}>
                          {t.status}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-1.5 text-xs text-foreground">
                      {t.name}
                    </TableCell>
                    <TableCell className="px-4 py-1.5 text-xs text-muted-foreground font-mono">
                      {t.parentId ? t.parentId.slice(0, 8) : "—"}
                    </TableCell>
                    <TableCell className="px-4 py-1.5 text-xs text-muted-foreground tabular-nums">
                      {duration !== null ? `${duration}ms` : "..."}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
