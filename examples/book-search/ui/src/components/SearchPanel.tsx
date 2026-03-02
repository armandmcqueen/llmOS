import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

interface Props {
  onSearch: (query: string) => void;
  loading: boolean;
}

export default function SearchPanel({ onSearch, loading }: Props) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed && !loading) {
      onSearch(trimmed);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the book..."
        disabled={loading}
        className="flex-1 h-10"
      />
      <Button type="submit" disabled={loading || !query.trim()} size="lg">
        <Search className="size-4" />
        {loading ? "Searching..." : "Search"}
      </Button>
    </form>
  );
}
