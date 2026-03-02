import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { StoreState } from "../useStoreState.js";

interface Props {
  state: StoreState;
}

interface TreeNode {
  children: Map<string, TreeNode>;
  value?: any;
  fullKey?: string;
}

function buildTree(state: StoreState, filter: string): TreeNode {
  const root: TreeNode = { children: new Map() };
  const keys = Object.keys(state)
    .filter((k) => !filter || k.toLowerCase().includes(filter.toLowerCase()))
    .sort();

  for (const key of keys) {
    const parts = key.split("/").filter(Boolean);
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) {
        node.children.set(part, { children: new Map() });
      }
      node = node.children.get(part)!;
    }
    node.value = state[key];
    node.fullKey = key;
  }
  return root;
}

function describeValue(val: any): string {
  if (Array.isArray(val)) return `array[${val.length}]`;
  if (typeof val === "object" && val !== null)
    return `{${Object.keys(val).length} keys}`;
  if (typeof val === "string")
    return val.length > 60 ? `string(${val.length})` : `"${val}"`;
  return String(val);
}

function TreeNodeView({
  name,
  node,
  depth,
}: {
  name: string;
  node: TreeNode;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [showValue, setShowValue] = useState(false);
  const hasChildren = node.children.size > 0;
  const isLeaf = node.fullKey !== undefined;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 py-0.5 px-2 text-[13px] font-mono select-none hover:bg-muted/30 transition-colors"
        style={{ paddingLeft: depth * 16 + 8 }}
        role={hasChildren || isLeaf ? "button" : undefined}
        onClick={() => {
          if (hasChildren) setExpanded(!expanded);
          else if (isLeaf) setShowValue(!showValue);
        }}
      >
        <span className="w-3 shrink-0 text-[10px] text-muted-foreground/50">
          {hasChildren ? (expanded ? "▼" : "▶") : isLeaf ? "•" : " "}
        </span>
        <span className={hasChildren ? "text-foreground" : "text-muted-foreground"}>
          {name}
        </span>
        {isLeaf && (
          <span className="ml-2 text-[11px] text-muted-foreground/50">
            {describeValue(node.value)}
          </span>
        )}
      </div>

      {showValue && isLeaf && (
        <pre
          className="mx-2 my-0.5 rounded border bg-background p-2 text-[11px] text-muted-foreground overflow-auto max-h-48 whitespace-pre-wrap break-all"
          style={{ marginLeft: depth * 16 + 28 }}
        >
          {typeof node.value === "string"
            ? node.value.slice(0, 500) + (node.value.length > 500 ? "..." : "")
            : JSON.stringify(node.value, null, 2).slice(0, 1000)}
        </pre>
      )}

      {expanded &&
        Array.from(node.children.entries()).map(([childName, childNode]) => (
          <TreeNodeView
            key={childName}
            name={childName}
            node={childNode}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

export default function StoreExplorer({ state }: Props) {
  const [filter, setFilter] = useState("");
  const tree = useMemo(() => buildTree(state, filter), [state, filter]);
  const keyCount = Object.keys(state).length;

  return (
    <Card className="gap-0 py-0 overflow-hidden">
      <CardHeader className="flex-row items-center justify-between px-4 py-3 border-b">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Store ({keyCount} keys)
        </CardTitle>
        <Input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter keys..."
          className="h-7 w-40 text-xs"
        />
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[500px] overflow-y-auto py-1">
          {Array.from(tree.children.entries()).map(([name, node]) => (
            <TreeNodeView key={name} name={name} node={node} depth={0} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
