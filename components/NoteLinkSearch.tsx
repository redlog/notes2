"use client";

import { useEffect, useRef, useState } from "react";
import { X, Search } from "lucide-react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

interface Result {
  id: number;
  title: string;
}

interface Props {
  onInsert: (text: string) => void;
  onClose: () => void;
}

export default function NoteLinkSearch({ onInsert, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/title-search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setResults(data.results ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="absolute top-0 left-0 right-0 z-30 bg-background border-b border-border shadow-lg p-3">
      <div className="flex gap-2 mb-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search note titles…"
            className="pl-8 h-8 text-sm"
            onKeyDown={(e) => e.key === "Escape" && onClose()}
          />
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      {results.length > 0 && (
        <ul className="space-y-0.5 max-h-48 overflow-y-auto">
          {results.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onInsert(`note:${r.id}`)}
                className="w-full text-left text-sm px-2 py-1.5 hover:bg-accent rounded-sm transition-colors truncate"
              >
                {r.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {query && results.length === 0 && (
        <p className="text-xs text-muted-foreground px-2 py-1">No notes found.</p>
      )}
    </div>
  );
}
