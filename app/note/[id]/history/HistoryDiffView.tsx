"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { diffLines, Change } from "diff";
import { marked } from "marked";
import { Clock, ChevronRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type VersionMeta = { version: number; title: string; saved_at: string };
type VersionData = { title: string; body: string };

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
  const [versionData, setVersionData] = useState<Record<number, VersionData>>({});
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
    if (versionData[ver] !== undefined) return;
    setLoadingVers((prev) => new Set(prev).add(ver));
    try {
      const res = await fetch(`/api/notes/${noteId}/versions/${ver}`);
      if (res.ok) {
        const data = await res.json();
        setVersionData((prev) => ({
          ...prev,
          [ver]: { title: data.title ?? "", body: data.body ?? "" },
        }));
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

  // Single-note view
  const singleVer = selected.length === 1 ? selected[0] : null;
  const singleData = singleVer !== null ? versionData[singleVer] : null;
  const singleLoading = singleVer !== null && loadingVers.has(singleVer);
  const singleHtml = singleData
    ? (marked.parse(singleData.body) as string)
    : null;

  // Diff view
  const [oldVer, newVer] =
    selected.length === 2
      ? selected[0] < selected[1]
        ? [selected[0], selected[1]]
        : [selected[1], selected[0]]
      : [null, null];

  const diffReady =
    oldVer !== null &&
    newVer !== null &&
    versionData[oldVer] !== undefined &&
    versionData[newVer] !== undefined;

  const diffWaiting =
    selected.length === 2 &&
    !diffReady &&
    (loadingVers.has(selected[0]) || loadingVers.has(selected[1]));

  const diffResult: Change[] | null = diffReady
    ? diffLines(versionData[oldVer!]?.body ?? "", versionData[newVer!]?.body ?? "")
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

      {/* ── md+: main UI ───────────────────────────────────────── */}
      <div
        className="hidden md:flex border border-border rounded-lg overflow-hidden"
        style={{ minHeight: "65vh" }}
      >
        {/* ── Version list sidebar ──────────────────────────────── */}
        <div className="w-52 xl:w-60 shrink-0 border-r border-border flex flex-col">
          <div className="px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide border-b border-border bg-muted/30">
            Versions
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

        {/* ── Content panel ─────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-auto">
          {/* 0 selected */}
          {selected.length === 0 && (
            <div className="flex items-center justify-center h-full p-8 text-sm text-muted-foreground text-center">
              Click a version to view it, or select two to compare
            </div>
          )}

          {/* 1 selected: render the note */}
          {selected.length === 1 && (
            <>
              {singleLoading && (
                <div className="flex items-center justify-center h-full p-8 text-sm text-muted-foreground">
                  Loading…
                </div>
              )}
              {singleData && (
                <div className="p-6">
                  <div className="flex items-center justify-between mb-5 pb-3 border-b border-border gap-4">
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                      <Clock className="h-3 w-3 shrink-0" />
                      <span>v{singleVer} · {fmt(versions.find((v) => v.version === singleVer)!.saved_at)}</span>
                      {singleVer === currentVersion && (
                        <span className="text-green-600 dark:text-green-400 font-medium">
                          Current version
                        </span>
                      )}
                    </div>
                    {singleVer !== currentVersion && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => restore(singleVer!)}
                        disabled={restoring === singleVer}
                        className="gap-1.5 shrink-0"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {restoring === singleVer ? "Restoring…" : `Restore v${singleVer}`}
                      </Button>
                    )}
                  </div>
                  {singleData.title && (
                    <h1 className="text-2xl font-bold text-foreground mb-4">
                      {singleData.title}
                    </h1>
                  )}
                  <div
                    className="note-body prose max-w-none text-foreground"
                    dangerouslySetInnerHTML={{ __html: singleHtml! }}
                  />
                </div>
              )}
            </>
          )}

          {/* 2 selected: loading */}
          {selected.length === 2 && diffWaiting && (
            <div className="flex items-center justify-center h-full p-8 text-sm text-muted-foreground">
              Loading…
            </div>
          )}

          {/* 2 selected: diff */}
          {diffReady && diffResult && (
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
