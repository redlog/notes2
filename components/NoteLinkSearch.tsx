"use client";

import { useEffect, useRef, useState } from "react";

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
    <div className="absolute top-0 left-0 right-0 z-30 bg-white border-b border-gray-300 shadow p-3">
      <div className="flex gap-2 mb-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search note titles…"
          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        />
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-sm">
          Close
        </button>
      </div>
      {results.length > 0 && (
        <ul className="space-y-0.5 max-h-48 overflow-y-auto text-sm">
          {results.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => onInsert(`note:${r.id}`)}
                className="w-full text-left px-2 py-1 hover:bg-blue-50 rounded truncate"
              >
                {r.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {query && results.length === 0 && (
        <p className="text-xs text-gray-400">No notes found.</p>
      )}
    </div>
  );
}
