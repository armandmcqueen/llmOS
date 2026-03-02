import { useState, useCallback } from "react";
import SearchPanel from "./components/SearchPanel.js";
import ActiveProcesses from "./components/ActiveProcesses.js";
import TaskTable from "./components/TaskTable.js";
import StoreExplorer from "./components/StoreExplorer.js";
import AILog from "./components/AILog.js";
import UsageSummary from "./components/UsageSummary.js";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStoreState, extractTasks, extractAIRequests } from "./useStoreState.js";

interface SearchResult {
  query: string;
  answer: string;
  passages: { chunkIndex: number; text: string }[];
  workerCount: number;
}

export default function App() {
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storeState = useStoreState(loading, 500);
  const displayState = storeState;

  const handleSearch = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const tasks = displayState ? extractTasks(displayState) : [];
  const aiRequests = displayState ? extractAIRequests(displayState) : [];

  return (
    <div className="max-w-7xl mx-auto px-6 py-6">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Book Search Agent
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Map-reduce search over "The Hard Thing About Hard Things"
        </p>
      </header>

      {/* Search */}
      <div className="mb-6">
        <SearchPanel onSearch={handleSearch} loading={loading} />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(400px,45%)] gap-6">
        {/* Left column — active processes + results */}
        <div className="flex flex-col gap-4 min-w-0">
          <ActiveProcesses tasks={tasks} loading={loading} />

          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {result && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <Badge variant="secondary">{result.workerCount} workers</Badge>
                <Badge variant="secondary">
                  {result.passages.length} passages
                </Badge>
              </div>

              <Card className="gap-0 py-0">
                <CardContent className="p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Answer
                  </h3>
                  <p className="text-sm whitespace-pre-wrap">{result.answer}</p>
                </CardContent>
              </Card>

              {result.passages.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Relevant Passages
                  </h3>
                  {result.passages.map((p, i) => (
                    <Card key={i} className="gap-0 py-0">
                      <CardContent className="p-3">
                        <Badge
                          variant="outline"
                          className="mb-2 text-success border-success/30"
                        >
                          chunk {p.chunkIndex}
                        </Badge>
                        <p className="text-[13px] text-foreground/80">
                          {p.text}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column — debug panels */}
        {displayState && (
          <div className="min-w-0">
            <Tabs defaultValue="tasks">
              <TabsList variant="line" className="w-full justify-start">
                <TabsTrigger value="tasks">
                  Tasks ({tasks.length})
                </TabsTrigger>
                <TabsTrigger value="store">
                  Store ({Object.keys(displayState).length})
                </TabsTrigger>
                <TabsTrigger value="ai">
                  AI Log ({aiRequests.length})
                </TabsTrigger>
                <TabsTrigger value="usage">Usage</TabsTrigger>
              </TabsList>
              <TabsContent value="tasks">
                <TaskTable tasks={tasks} />
              </TabsContent>
              <TabsContent value="store">
                <StoreExplorer state={displayState} />
              </TabsContent>
              <TabsContent value="ai">
                <AILog requests={aiRequests} />
              </TabsContent>
              <TabsContent value="usage">
                <UsageSummary state={displayState} tasks={tasks} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
