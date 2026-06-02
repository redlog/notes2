"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Project, UserSettings } from "@/lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Separator } from "./ui/separator";
import { Save, Plus, Trash2, Check, AlertTriangle, User, FolderOpen, Download, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  projects: Project[];
  activeProject: Project;
  settings: UserSettings;
  userEmail: string;
  userId: string;
}

// ─── User Settings Panel ──────────────────────────────────────────────────────

function UserSettingsPanel({
  settings,
  userEmail,
  userId,
}: {
  settings: UserSettings;
  userEmail: string;
  userId: string;
}) {
  const router = useRouter();
  const [notesPerPage, setNotesPerPage] = useState(settings.notes_per_page);
  const [autosaveEnabled, setAutosaveEnabled] = useState(settings.autosave_enabled);
  const [autosaveInterval, setAutosaveInterval] = useState(settings.autosave_interval);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setSaving(true);
    const res = await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          notes_per_page: notesPerPage,
          autosave_enabled: autosaveEnabled,
          autosave_interval: Math.max(15, autosaveInterval),
        },
      }),
    });
    setSaving(false);
    if (res.ok) {
      setMsg("Saved.");
      router.refresh();
    } else {
      setMsg("Save failed.");
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Account</h2>
        <Separator />
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-2">
          <div>
            <p className="text-xs text-muted-foreground">Signed in as</p>
            <p className="text-sm font-medium">{userEmail}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">User ID</p>
            <p className="text-xs font-mono text-foreground break-all">{userId}</p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Preferences</h2>
        <Separator />
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Notes per page</label>
            <Input
              type="number"
              min={5}
              max={200}
              value={notesPerPage}
              onChange={(e) => setNotesPerPage(Number(e.target.value))}
              className="w-28"
            />
          </div>

          <div className="flex items-center justify-between max-w-sm">
            <div>
              <p className="text-sm font-medium">Autosave</p>
              <p className="text-xs text-muted-foreground">Automatically save while editing</p>
            </div>
            <Switch checked={autosaveEnabled} onCheckedChange={setAutosaveEnabled} />
          </div>

          {autosaveEnabled && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Autosave interval (seconds)</label>
              <Input
                type="number"
                min={15}
                max={300}
                value={autosaveInterval}
                onChange={(e) => setAutosaveInterval(Number(e.target.value))}
                className="w-28"
              />
              <p className="text-xs text-muted-foreground">Minimum 15 seconds</p>
            </div>
          )}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving} className="gap-1.5">
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : "Save"}
        </Button>
        {msg && (
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <Check className="h-3.5 w-3.5 text-green-600" />
            {msg}
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground pt-2">Localnotes v2</p>
    </div>
  );
}

// ─── Export / Import Panel ────────────────────────────────────────────────────

function ExportImportPanel({ projectId }: { projectId: string }) {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    total: number;
    errors: string[];
  } | null>(null);
  const [importError, setImportError] = useState("");

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setImporting(true);
    setImportResult(null);
    setImportError("");

    try {
      const text = await file.text();
      const res = await fetch(`/api/import-json?project=${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? "Import failed");
      } else {
        setImportResult(data);
      }
    } catch {
      setImportError("Failed to read or upload file.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold">Export / Import</h2>
      <Separator />

      <div className="space-y-4">
        {/* Export */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Export notes</p>
          <p className="text-xs text-muted-foreground">
            Download all notes as a JSON file, including images (base64-encoded).
          </p>
          <Button variant="outline" className="gap-1.5" asChild>
            <a href={`/api/export-json?project=${projectId}`} download>
              <Download className="h-4 w-4" />
              Download JSON
            </a>
          </Button>
        </div>

        {/* Import */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Import notes</p>
          <p className="text-xs text-muted-foreground">
            Import notes from a Localnotes JSON export. Notes are added to this project; existing notes are not affected. Original timestamps are preserved.
          </p>
          <label className="inline-block">
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={importing}
              asChild
            >
              <span>
                <Upload className="h-4 w-4" />
                {importing ? "Importing…" : "Choose JSON file…"}
                <input
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  onChange={handleImport}
                  disabled={importing}
                />
              </span>
            </Button>
          </label>

          {importResult && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm space-y-1">
              <p className="flex items-center gap-1.5 text-green-700 dark:text-green-400 font-medium">
                <Check className="h-3.5 w-3.5" />
                Imported {importResult.imported} of {importResult.total} notes
              </p>
              {importResult.errors.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    {importResult.errors.length} error{importResult.errors.length !== 1 ? "s" : ""}
                  </summary>
                  <ul className="mt-1 space-y-0.5 list-disc list-inside">
                    {importResult.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {importError && (
            <p className="text-sm text-destructive flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />
              {importError}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Project Settings Panel ───────────────────────────────────────────────────

function ProjectSettingsPanel({
  project,
  projects,
}: {
  project: Project;
  projects: Project[];
}) {
  const router = useRouter();
  const [projectName, setProjectName] = useState(project.name);
  const [trigramSearch, setTrigramSearch] = useState(project.trigram_search);
  const [clearConfirm, setClearConfirm] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [clearing, setClearing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setSaving(true);
    const res = await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        name: projectName,
        trigram_search: trigramSearch,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setMsg("Saved.");
      router.refresh();
    } else {
      setMsg("Save failed.");
    }
  }

  async function clearNotes() {
    if (clearConfirm !== "clear") return;
    setClearing(true);
    const res = await fetch("/api/projects/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id }),
    });
    setClearing(false);
    if (res.ok) {
      setClearConfirm("");
      router.refresh();
    }
  }

  async function deleteProject() {
    if (deleteConfirm !== "delete") return;
    const res = await fetch("/api/projects", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="space-y-8">
      {/* Project info */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Project info</h2>
        <Separator />
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-2">
          <div>
            <p className="text-xs text-muted-foreground">Project ID</p>
            <p className="text-xs font-mono text-foreground break-all">{project.id}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Created</p>
            <p className="text-sm text-foreground">
              {new Date(project.created_at).toLocaleString()}
            </p>
          </div>
        </div>
      </section>

      {/* Project settings */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Project settings</h2>
        <Separator />
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Project name</label>
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="max-w-sm"
            />
          </div>

          <div className="flex items-center justify-between max-w-sm">
            <div>
              <p className="text-sm font-medium">Trigram search</p>
              <p className="text-xs text-muted-foreground">Enables partial-word matching</p>
            </div>
            <Switch checked={trigramSearch} onCheckedChange={setTrigramSearch} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving} className="gap-1.5">
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save"}
          </Button>
          {msg && (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Check className="h-3.5 w-3.5 text-green-600" />
              {msg}
            </span>
          )}
        </div>
      </section>

      {/* Export / Import */}
      <ExportImportPanel projectId={project.id} />

      {/* Danger zone */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
        <Separator className="bg-destructive/20" />

        <div className="space-y-3 rounded-lg border border-destructive/20 p-4">
          <div>
            <p className="text-sm font-medium">Clear all notes</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Permanently deletes all notes, tags, and people from this project. The project itself is kept. This cannot be undone.
            </p>
          </div>
          <div className="flex gap-2 items-center max-w-sm">
            <Input
              value={clearConfirm}
              onChange={(e) => setClearConfirm(e.target.value)}
              placeholder='Type "clear" to confirm'
              className="border-destructive/40 focus-visible:ring-destructive/40"
            />
            <Button
              variant="destructive"
              onClick={clearNotes}
              disabled={clearConfirm !== "clear" || clearing}
              className="gap-1.5 shrink-0"
            >
              <AlertTriangle className="h-4 w-4" />
              {clearing ? "Clearing…" : "Clear"}
            </Button>
          </div>
        </div>

        {projects.length > 1 && (
          <div className="space-y-3 rounded-lg border border-destructive/20 p-4">
            <div>
              <p className="text-sm font-medium">Delete project</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Permanently deletes this project and all its notes and images. This cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 items-center max-w-sm">
              <Input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder='Type "delete" to confirm'
                className="border-destructive/40 focus-visible:ring-destructive/40"
              />
              <Button
                variant="destructive"
                onClick={deleteProject}
                disabled={deleteConfirm !== "delete"}
                className="gap-1.5 shrink-0"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export default function ConfigForm({ projects, activeProject, settings, userEmail, userId }: Props) {
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState<"user" | string>("user");
  const [newProjectName, setNewProjectName] = useState("");

  const selectedProject = projects.find((p) => p.id === selectedTab);

  async function createProject() {
    if (!newProjectName.trim()) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newProjectName.trim() }),
    });
    if (res.ok) {
      setNewProjectName("");
      router.refresh();
    }
  }

  return (
    <div className="flex gap-0">
      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <nav className="w-52 shrink-0 border-r border-border pr-3 space-y-1">
        <button
          onClick={() => setSelectedTab("user")}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left",
            selectedTab === "user"
              ? "bg-primary/10 text-primary font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          <User className="h-4 w-4 shrink-0" />
          User settings
        </button>

        <Separator className="!my-3" />

        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 pb-1">
          Projects
        </p>

        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedTab(p.id)}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left",
              selectedTab === p.id
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <FolderOpen className="h-4 w-4 shrink-0" />
            <span className="truncate">{p.name}</span>
          </button>
        ))}

        <div className="!mt-4 space-y-1.5 pt-1">
          <Input
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="New project…"
            onKeyDown={(e) => e.key === "Enter" && createProject()}
            className="h-7 text-xs"
          />
          <Button
            variant="outline"
            onClick={createProject}
            className="w-full gap-1.5 h-7 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Create project
          </Button>
        </div>
      </nav>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <main className="flex-1 pl-8 min-w-0">
        {selectedTab === "user" ? (
          <UserSettingsPanel
            settings={settings}
            userEmail={userEmail}
            userId={userId}
          />
        ) : selectedProject ? (
          <ProjectSettingsPanel
            key={selectedProject.id}
            project={selectedProject}
            projects={projects}
          />
        ) : null}
      </main>
    </div>
  );
}
