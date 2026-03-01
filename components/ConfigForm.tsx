"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Project, UserSettings } from "@/lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import { Separator } from "./ui/separator";
import { Save, Plus, Trash2, Check } from "lucide-react";

interface Props {
  projects: Project[];
  activeProject: Project;
  settings: UserSettings;
  userEmail: string;
}

export default function ConfigForm({ projects, activeProject, settings, userEmail }: Props) {
  const router = useRouter();
  const [projectName, setProjectName] = useState(activeProject.name);
  const [trigramSearch, setTrigramSearch] = useState(activeProject.trigram_search);
  const [notesPerPage, setNotesPerPage] = useState(settings.notes_per_page);
  const [autosaveEnabled, setAutosaveEnabled] = useState(settings.autosave_enabled);
  const [autosaveInterval, setAutosaveInterval] = useState(settings.autosave_interval);
  const [newProjectName, setNewProjectName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function saveSettings() {
    setSaving(true);
    const res = await fetch("/api/projects", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: activeProject.id,
        name: projectName,
        trigram_search: trigramSearch,
        settings: {
          notes_per_page: notesPerPage,
          autosave_enabled: autosaveEnabled,
          autosave_interval: Math.max(15, autosaveInterval),
        },
      }),
    });
    setSaving(false);
    if (res.ok) {
      setMsg("Settings saved.");
      router.refresh();
    } else {
      setMsg("Save failed.");
    }
  }

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

  async function deleteProject() {
    if (deleteConfirm !== "delete") return;
    const res = await fetch("/api/projects", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: activeProject.id }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="space-y-8">
      {/* Account */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Account</h2>
        <Separator />
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
          <p className="text-sm text-muted-foreground">Signed in as</p>
          <p className="text-sm font-medium">{userEmail}</p>
        </div>
      </section>

      {/* Active project settings */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Project settings</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{activeProject.name}</p>
        </div>
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
            <Switch
              checked={trigramSearch}
              onCheckedChange={setTrigramSearch}
            />
          </div>
        </div>
      </section>

      {/* User preferences */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Preferences</h2>
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
            <Switch
              checked={autosaveEnabled}
              onCheckedChange={setAutosaveEnabled}
            />
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

      {/* Save button */}
      <div className="flex items-center gap-3">
        <Button onClick={saveSettings} disabled={saving} className="gap-1.5">
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : "Save settings"}
        </Button>
        {msg && (
          <span className="text-sm text-muted-foreground flex items-center gap-1">
            <Check className="h-3.5 w-3.5 text-green-600" />
            {msg}
          </span>
        )}
      </div>

      {/* Projects */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Projects</h2>
        <Separator />
        <ul className="space-y-1">
          {projects.map((p) => (
            <li
              key={p.id}
              className={`text-sm px-3 py-1.5 rounded-md ${
                p.id === activeProject.id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground"
              }`}
            >
              {p.name}
            </li>
          ))}
        </ul>
        <div className="flex gap-2 max-w-sm">
          <Input
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="New project name…"
            onKeyDown={(e) => e.key === "Enter" && createProject()}
          />
          <Button variant="outline" onClick={createProject} className="gap-1.5 shrink-0">
            <Plus className="h-4 w-4" />
            Create
          </Button>
        </div>
      </section>

      {/* Delete project */}
      {projects.length > 1 && (
        <section className="space-y-4">
          <h2 className="text-sm font-semibold text-destructive">Delete project</h2>
          <Separator className="bg-destructive/20" />
          <p className="text-sm text-muted-foreground">
            Permanently deletes <strong>{activeProject.name}</strong> and all its notes and images.
            This cannot be undone.
          </p>
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
        </section>
      )}

      {/* App info */}
      <p className="text-xs text-muted-foreground pt-2">Localnotes v2</p>
    </div>
  );
}
