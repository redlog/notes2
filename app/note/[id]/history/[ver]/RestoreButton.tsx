"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

export default function RestoreButton({ noteId, version }: { noteId: number; version: number }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleRestore() {
    if (!confirm("Restore this version? The current note will be replaced.")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/notes/${noteId}/versions/${version}`, { method: "POST" });
      if (res.ok) {
        router.push(`/note/${noteId}`);
      } else {
        const { error } = await res.json();
        alert(error ?? "Restore failed");
        setLoading(false);
      }
    } catch {
      alert("Restore failed");
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleRestore} disabled={loading} className="gap-1.5">
      <RotateCcw className="h-3.5 w-3.5" />
      {loading ? "Restoring…" : "Restore this version"}
    </Button>
  );
}
