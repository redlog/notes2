"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface Props {
  person: string;
  initialContent: string;
  initialUpdatedAt: string | null;
  projectParam?: string;
}

const AUTOSAVE_DELAY = 2000; // ms debounce

export default function BioEditor({ person, initialContent, initialUpdatedAt, projectParam }: Props) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>(() => {
    if (!initialUpdatedAt) return "Not yet saved";
    const t = new Date(initialUpdatedAt);
    return `Saved ${t.getFullYear()}-${(t.getMonth() + 1).toString().padStart(2, "0")}-${t.getDate().toString().padStart(2, "0")} ${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}`;
  });
  const [justSaved, setJustSaved] = useState(false);

  const lastSavedContent = useRef(initialContent);
  const saveInFlight = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSave = useCallback(async (value: string) => {
    if (saveInFlight.current) return;
    if (value === lastSavedContent.current) return;
    saveInFlight.current = true;
    setSaving(true);

    const qs = projectParam ? `?project=${encodeURIComponent(projectParam)}` : "";
    try {
      const res = await fetch(`/api/bio/${encodeURIComponent(person)}${qs}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      });
      const data = await res.json();
      if (data.ok) {
        lastSavedContent.current = value;
        const t = new Date(data.updated_at);
        setSaveStatus(
          `Saved ${t.getFullYear()}-${(t.getMonth() + 1).toString().padStart(2, "0")}-${t.getDate().toString().padStart(2, "0")} ${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}`
        );
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2000);
      } else {
        setSaveStatus("Save failed.");
      }
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }, [person, projectParam]);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setContent(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => doSave(value), AUTOSAVE_DELAY);
  }

  // Save on unmount if dirty
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const saveStatusClass = cn(
    "text-xs transition-colors duration-300",
    saveStatus.startsWith("Save failed") ? "text-destructive"
      : justSaved ? "text-green-600 font-medium"
      : "text-muted-foreground"
  );

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)]">
      <div className="flex items-center justify-between mb-3">
        <span className={saveStatusClass}>{saving ? "Saving…" : saveStatus}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => doSave(content)}
          disabled={saving}
          className="h-7 text-xs gap-1"
        >
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>
      </div>
      <textarea
        value={content}
        onChange={handleChange}
        className="flex-1 w-full resize-none rounded-lg border border-border bg-card p-4 text-sm font-mono leading-relaxed outline-none focus:ring-1 focus:ring-ring"
        placeholder={`Notes about @${person}…`}
        spellCheck
      />
    </div>
  );
}
