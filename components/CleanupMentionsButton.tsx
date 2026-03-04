"use client";

import { useState } from "react";
import { Button } from "./ui/button";
import { Trash2 } from "lucide-react";

type Result = { tagsDeleted: number; peopleDeleted: number };

export default function CleanupMentionsButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/cleanup-mentions", { method: "POST" });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Unknown error");
      else setResult(data);
    } catch {
      setError("Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-5 space-y-3">
      <div>
        <h2 className="font-semibold text-sm">Clean up invalid mentions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Deletes any tags or people in the database that contain characters outside{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">a–z 0–9 _ -</code>.
          Body mentions will be re-extracted correctly the next time each note is saved.
        </p>
      </div>
      <div className="flex items-center gap-4">
        <Button variant="destructive" size="sm" onClick={run} disabled={loading} className="gap-1.5">
          <Trash2 className="h-3.5 w-3.5" />
          {loading ? "Running…" : "Run cleanup"}
        </Button>
        {result && (
          <p className="text-sm text-muted-foreground">
            Deleted {result.tagsDeleted} tag{result.tagsDeleted !== 1 ? "s" : ""} and{" "}
            {result.peopleDeleted} person{result.peopleDeleted !== 1 ? "s" : ""}.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
