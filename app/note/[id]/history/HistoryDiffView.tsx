"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { diffLines, Change } from "diff";
import { Clock, ChevronRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type VersionMeta = { version: number; title: string; saved_at: string };

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function HistoryDiffView({
  noteId,
  versions,
}: {
  noteId: number;
  versions: VersionMeta[];
}) {
  const router = useRouter();
  const currentVersion = Math.max(...versions.map((v) => v.version));

  // Up to 2 selected version numbers (in click order)
  const [selected, setSelected] = useState<number[]>([]);
  const [bodies, setBodies] = useState<Record<number, string>>({});
  const [loadingVers, setLoadingVers] = useState<Set<number>>(new Set());
  const [restoring, setRestoring] = useState<number | null>(null);

  async function restore(ver: number) {
    if (!confirm("Restore this version? The current note will be replaced.")) return;
    setRestoring(ver);
    try {
      const res = await fetch(`/api/notes/${noteId}/versions/${ver}`, { method: "POST" });
      if (res.ok) {
        router.push(`/note/${noteId}`);
      } else {
        const { error } = await res.json();
        alert(error ?? "Restore failed");
        setRestoring(null);
      }
    } catch {
      alert("Restore failed");
      setRestoring(null);
    }
  }

  async function fetchBody(ver: number) {
    if (bodies[ver] !== undefined) return;
    setLoadingVers((prev) => new Set(prev).add(ver));
    try {
      const res = await fetch(`/api/notes/${noteId}/versions/${ver}`);
      if (res.ok) {
        const data = await res.json();
        setBodies((prev) => ({ ...prev, [ver]: data.body ?? "" }));
      }
    } finally {
      setLoadingVers((prev) => {
        const next = new Set(prev);
        next.delete(ver);
        return next;
      });
    }
  }

  function toggle(ver: number) {
    if (selected.includes(ver)) {
      setSelected((prev) => prev.filter((v) => v !== ver));
    } else {
      fetchBody(ver);
      // Keep max 2; if already 2 selected, evict the first (FIFO)
      setSelected((prev) =>
        prev.length >= 2 ? [...prev.slice(1), ver] : [...prev, ver]
      );
    }
  }

  // Determine which selected version is older vs newer
  const [oldVer, newVer] =
    selected.length === 2
      ? selected[0] < selected[1]
        ? [selected[0], selected[1]]
        : [selected[1], selected[0]]
      : [null, null];

  const ready =
    oldVer !== null &&
    newVer !== null &&
    bodies[oldVer] !== undefined &&
    bodies[newVer] !== undefined;

  const waiting =
    selected.length === 2 &&
    !ready &&
    (loadingVers.has(selected[0]) || loadingVers.has(selected[1]));

  const diffResult: Change[] | null = ready
    ? diffLines(bodies[oldVer!] ?? "", bodies[newVer!] ?? "")
    : null;

  return (
    <>
      {/* ── Mobile: simple list linking to version detail pages ── */}
      <ul className="md:hidden divide-y divide-border border border-border rounded-lg">
        {versions.map((v) => (
          <li key={v.version}>
            <Link
              href={`/note/${noteId}/history/${v.version}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">v{v.version}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                  <Clock className="h-3 w-3 shrink-0" />
                  {fmt(v.saved_at)}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 ml-auto shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>

      {/* ── md+: diff UI ─────────────────────────────────────── */}
      <div
        className="hidden md:flex border border-border rounded-lg overflow-hidden"
        style={{ minHeight: "65vh" }}
      >
      {/* ── Version list sidebar ─────────────────────────────── */}
      <div className="w-52 xl:w-60 shrink-0 border-r border-border flex flex-col">
        <div className="px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide border-b border-border bg-muted/30">
          Versions · pick 2
        </div>
        <ul className="overflow-y-auto flex-1">
          {versions.map((v) => {
            const isSel = selected.includes(v.version);
            const isOld = isSel && selected.length === 2 && v.version === oldVer;
            const isNew = isSel && selected.length === 2 && v.version === newVer;
            const isOnlyOne = isSel && selected.length === 1;

            let dotClass = "border-border bg-background";
            let dotLabel = "";
            if (isOld) {
              dotClass =
                "border-red-500 bg-red-500 text-white text-[9px] font-bold";
              dotLabel = "O";
            } else if (isNew) {
              dotClass =
                "border-green-600 bg-green-600 text-white text-[9px] font-bold";
              dotLabel = "N";
            } else if (isOnlyOne) {
              dotClass = "border-primary bg-primary";
            }

            return (
              <li key={v.version}>
                <button
                  onClick={() => toggle(v.version)}
                  className={`w-full text-left px-3 py-2.5 text-sm border-b border-border transition-colors flex items-center gap-2 ${
                    isOld
                      ? "bg-red-50 dark:bg-red-950/25 hover:bg-red-100 dark:hover:bg-red-950/40"
                      : isNew
                      ? "bg-green-50 dark:bg-green-950/25 hover:bg-green-100 dark:hover:bg-green-950/40"
                      : isOnlyOne
                      ? "bg-primary/8 hover:bg-primary/12"
                      : "hover:bg-muted/50"
                  }`}
                >
                  {/* Selection indicator */}
                  <span
                    className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center leading-none ${dotClass}`}
                  >
                    {dotLabel}
                  </span>

                  <div className="min-w-0">
                    <div className="font-medium text-xs text-foreground">
                      v{v.version}
                    </div>
                    <div className="flex items-center gap-0.5 text-[11px] text-muted-foreground mt-0.5">
                      <Clock className="h-2.5 w-2.5 shrink-0" />
                      {fmt(v.saved_at)}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ── Diff panel ───────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-auto">
        {selected.length === 0 && (
          <div className="flex items-center justify-center h-full p-8 text-sm text-muted-foreground text-center">
            Click two versions on the left to compare them
          </div>
        )}

        {selected.length === 1 && (
          <div className="flex flex-col items-center justify-center h-full p-8 gap-3 text-center">
            <p className="text-sm text-muted-foreground">
              Select one more version to compare
            </p>
            {selected[0] !== currentVersion && (
              <>
                <p className="text-xs text-muted-foreground">— or —</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => restore(selected[0])}
                  disabled={restoring === selected[0]}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {restoring === selected[0] ? "Restoring…" : `Restore v${selected[0]}`}
                </Button>
              </>
            )}
          </div>
        )}

        {selected.length === 2 && waiting && (
          <div className="flex items-center justify-center h-full p-8 text-sm text-muted-foreground">
            Loading…
          </div>
        )}

        {ready && diffResult && (
          <>
            <div className="sticky top-0 px-4 py-1.5 text-xs font-mono border-b border-border bg-muted/60 backdrop-blur flex items-center gap-6">
              <span className="flex items-center gap-1">
                <span className="text-red-600 font-bold">−</span>
                <span className="text-muted-foreground">v{oldVer}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="text-green-600 font-bold">+</span>
                <span className="text-muted-foreground">v{newVer}</span>
              </span>
              <div className="ml-auto flex items-center gap-2 font-sans">
                {oldVer !== currentVersion && (
                  <button
                    onClick={() => restore(oldVer!)}
                    disabled={restoring === oldVer}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    title={`Restore v${oldVer}`}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {restoring === oldVer ? "Restoring…" : `Restore v${oldVer}`}
                  </button>
                )}
                {newVer !== currentVersion && (
                  <button
                    onClick={() => restore(newVer!)}
                    disabled={restoring === newVer}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    title={`Restore v${newVer}`}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {restoring === newVer ? "Restoring…" : `Restore v${newVer}`}
                  </button>
                )}
              </div>
            </div>

            <div className="font-mono text-xs">
              {diffResult.map((part, i) => {
                const lines = part.value.split("\n");
                // diffLines ends values with "\n", so split produces a trailing empty string — drop it
                if (lines[lines.length - 1] === "") lines.pop();
                return lines.map((line, li) => (
                  <div
                    key={`${i}-${li}`}
                    className={`flex gap-3 px-4 py-px leading-5 ${
                      part.added
                        ? "bg-green-50 dark:bg-green-950/40"
                        : part.removed
                        ? "bg-red-50 dark:bg-red-950/40"
                        : ""
                    }`}
                  >
                    <span
                      className={`select-none w-3 shrink-0 ${
                        part.added
                          ? "text-green-600"
                          : part.removed
                          ? "text-red-500"
                          : "text-muted-foreground/40"
                      }`}
                    >
                      {part.added ? "+" : part.removed ? "−" : " "}
                    </span>
                    <span
                      className={`whitespace-pre-wrap break-all ${
                        part.added
                          ? "text-green-900 dark:text-green-100"
                          : part.removed
                          ? "text-red-900 dark:text-red-100"
                          : "text-foreground"
                      }`}
                    >
                      {line}
                    </span>
                  </div>
                ));
              })}
            </div>
          </>
        )}
      </div>
      </div>
    </>
  );
}
