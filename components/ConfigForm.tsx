"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Project, UserSettings } from "@/lib/types";

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
      <section>
        <h2 className="font-semibold text-gray-700 mb-3 border-b pb-1">Account</h2>
        <p className="text-sm text-gray-600">Signed in as <strong>{userEmail}</strong></p>
      </section>

      {/* Active project settings */}
      <section>
        <h2 className="font-semibold text-gray-700 mb-3 border-b pb-1">
          Project: {activeProject.name}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Project name</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="mt-1 block w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={trigramSearch}
              onChange={(e) => setTrigramSearch(e.target.checked)}
              className="rounded"
            />
            Enable trigram (partial-word) search
          </label>
        </div>
      </section>

      {/* User settings */}
      <section>
        <h2 className="font-semibold text-gray-700 mb-3 border-b pb-1">User preferences</h2>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Notes per page</label>
            <input
              type="number"
              min={5}
              max={200}
              value={notesPerPage}
              onChange={(e) => setNotesPerPage(Number(e.target.value))}
              className="mt-1 block w-32 border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autosaveEnabled}
              onChange={(e) => setAutosaveEnabled(e.target.checked)}
              className="rounded"
            />
            Enable autosave
          </label>
          {autosaveEnabled && (
            <div>
              <label className="text-sm font-medium text-gray-700">Autosave interval (seconds, min 15)</label>
              <input
                type="number"
                min={15}
                max={300}
                value={autosaveInterval}
                onChange={(e) => setAutosaveInterval(Number(e.target.value))}
                className="mt-1 block w-32 border border-gray-300 rounded px-3 py-1.5 text-sm"
              />
            </div>
          )}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={saveSettings}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {msg && <span className="text-sm text-gray-500">{msg}</span>}
      </div>

      {/* Create project */}
      <section>
        <h2 className="font-semibold text-gray-700 mb-3 border-b pb-1">Projects</h2>
        <ul className="text-sm mb-3 space-y-1">
          {projects.map((p) => (
            <li key={p.id} className={p.id === activeProject.id ? "font-semibold" : "text-gray-600"}>
              {p.name}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="New project name…"
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            onKeyDown={(e) => e.key === "Enter" && createProject()}
          />
          <button
            onClick={createProject}
            className="px-3 py-1 border border-gray-300 rounded text-sm hover:bg-gray-50"
          >
            Create
          </button>
        </div>
      </section>

      {/* Delete project */}
      {projects.length > 1 && (
        <section>
          <h2 className="font-semibold text-red-700 mb-3 border-b border-red-200 pb-1">
            Delete project
          </h2>
          <p className="text-sm text-gray-600 mb-3">
            Permanently deletes <strong>{activeProject.name}</strong> and all its notes and images.
          </p>
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="Type delete to confirm"
              className="border border-red-300 rounded px-2 py-1 text-sm"
            />
            <button
              onClick={deleteProject}
              disabled={deleteConfirm !== "delete"}
              className="px-3 py-1 bg-red-600 text-white rounded text-sm disabled:opacity-40 hover:bg-red-700"
            >
              Delete project
            </button>
          </div>
        </section>
      )}

      {/* App info */}
      <section>
        <h2 className="font-semibold text-gray-700 mb-2 border-b pb-1">App</h2>
        <p className="text-xs text-gray-400">Localnotes v2</p>
      </section>
    </div>
  );
}
