"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Note, NoteImage } from "@/lib/types";
import NoteLinkSearch from "./NoteLinkSearch";

interface Props {
  note: Note;
  allTags: string[];
  allPeople: string[];
  autosaveEnabled: boolean;
  autosaveInterval: number;
  initialSignedUrls: Record<number, string>;
}

export default function Editor({
  note,
  allTags,
  allPeople,
  autosaveEnabled,
  autosaveInterval,
  initialSignedUrls,
}: Props) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState<string[]>(
    note.tags.filter((t) => t.is_header).map((t) => t.tag)
  );
  const [people, setPeople] = useState<string[]>(
    note.people.filter((p) => p.is_header).map((p) => p.person)
  );
  const [version, setVersion] = useState(note.version);
  const [images, setImages] = useState<NoteImage[]>(note.images);
  const [signedUrls, setSignedUrls] = useState<Record<number, string>>(initialSignedUrls);
  const [saveStatus, setSaveStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [autoSave, setAutoSave] = useState(autosaveEnabled);
  const [showImages, setShowImages] = useState(false);
  const [showNoteSearch, setShowNoteSearch] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [personInput, setPersonInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [personSuggestions, setPersonSuggestions] = useState<string[]>([]);
  const [font, setFont] = useState<"mono" | "sans" | "serif">("mono");

  const lastSavedBody = useRef(note.body);

  // BroadcastChannel: warn if same note open in another tab
  useEffect(() => {
    const channel = new BroadcastChannel("localnotes_editing");
    channel.postMessage({ noteId: note.id });
    channel.onmessage = (e) => {
      if (e.data.noteId === note.id) {
        setSaveStatus("⚠️ This note is open in another tab.");
      }
    };
    return () => channel.close();
  }, [note.id]);

  // Autosave
  useEffect(() => {
    if (!autoSave) return;
    const interval = setInterval(async () => {
      if (body !== lastSavedBody.current) {
        await doSave(false);
      }
    }, autosaveInterval * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave, body, autosaveInterval]);

  async function doSave(navigate = true) {
    setSaving(true);
    const res = await fetch(`/api/notes/${note.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, tags, people, version }),
    });
    const data = await res.json();
    setSaving(false);
    if (data.ok) {
      setVersion(data.version);
      lastSavedBody.current = body;
      const t = new Date(data.updated_at);
      setSaveStatus(
        `Saved at ${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}:${t.getSeconds().toString().padStart(2, "0")}`
      );
      if (navigate) router.push(`/note/${note.id}`);
    } else if (data.conflict) {
      setSaveStatus("⚠️ Conflict: note was modified elsewhere. Resolve manually.");
      setAutoSave(false);
    } else {
      setSaveStatus("Save failed.");
    }
  }

  // Keyboard shortcuts in textarea
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = textareaRef.current!;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const lines = body.split("\n");
      const beforeCursor = body.slice(0, start);
      const lineStart = beforeCursor.lastIndexOf("\n") + 1;
      const currentLine = body.slice(lineStart, end);

      // Ctrl+. → note link search
      if (e.key === "." && e.ctrlKey) {
        e.preventDefault();
        setShowNoteSearch(true);
        return;
      }

      // Tab → indent bullet
      if (e.key === "Tab") {
        e.preventDefault();
        const bulletMatch = currentLine.match(/^(\s*)\* /);
        if (bulletMatch) {
          const indent = e.shiftKey
            ? currentLine.replace(/^    /, "")
            : "    " + currentLine;
          const newBody =
            body.slice(0, lineStart) + indent + body.slice(lineStart + currentLine.length);
          setBody(newBody);
          setTimeout(() => {
            ta.selectionStart = ta.selectionEnd = start + (e.shiftKey ? -4 : 4);
          }, 0);
        } else {
          const newBody = body.slice(0, start) + "    " + body.slice(end);
          setBody(newBody);
          setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + 4; }, 0);
        }
        return;
      }

      // Enter → continue bullet list
      if (e.key === "Enter" && !e.shiftKey) {
        const bulletMatch = currentLine.match(/^(\s*)\* (.*)$/);
        if (bulletMatch) {
          e.preventDefault();
          const [, indent, content] = bulletMatch;
          if (!content.trim()) {
            // Empty bullet → remove it
            const newBody = body.slice(0, lineStart) + body.slice(lineStart + currentLine.length + 1);
            setBody(newBody);
            setTimeout(() => { ta.selectionStart = ta.selectionEnd = lineStart; }, 0);
          } else {
            const continuation = `\n${indent}* `;
            const newBody = body.slice(0, start) + continuation + body.slice(end);
            setBody(newBody);
            setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + continuation.length; }, 0);
          }
          return;
        }
      }

      // @ → person autocomplete
      if (e.key === "@") {
        setPersonSuggestions(allPeople.slice(0, 10));
      }
    },
    [body, allPeople]
  );

  function insertAtCursor(text: string) {
    const ta = textareaRef.current!;
    const start = ta.selectionStart;
    const newBody = body.slice(0, start) + text + body.slice(ta.selectionEnd);
    setBody(newBody);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; }, 0);
    setShowNoteSearch(false);
  }

  function addTag(tag: string) {
    const clean = tag.replace(/^#/, "").trim();
    if (clean && !tags.includes(clean)) setTags([...tags, clean]);
    setTagInput("");
    setTagSuggestions([]);
  }

  function addPerson(person: string) {
    const clean = person.replace(/^@/, "").trim();
    if (clean && !people.includes(clean)) setPeople([...people, clean]);
    setPersonInput("");
    setPersonSuggestions([]);
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  function removePerson(person: string) {
    setPeople(people.filter((p) => p !== person));
  }

  const fontClass = font === "mono" ? "font-mono" : font === "serif" ? "font-serif" : "font-sans";

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white text-sm flex-wrap">
        <span className="font-medium text-gray-700 truncate max-w-xs">{note.title || "(untitled)"}</span>
        <span className="flex-1" />
        {saveStatus && <span className="text-xs text-gray-500">{saveStatus}</span>}
        <label className="flex items-center gap-1 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={autoSave}
            onChange={(e) => setAutoSave(e.target.checked)}
            className="rounded"
          />
          Autosave
        </label>
        <select
          value={font}
          onChange={(e) => setFont(e.target.value as "mono" | "sans" | "serif")}
          className="text-xs border border-gray-200 rounded px-1 py-0.5"
        >
          <option value="mono">Mono</option>
          <option value="sans">Sans</option>
          <option value="serif">Serif</option>
        </select>
        <button
          onClick={() => setShowImages((v) => !v)}
          className="text-xs text-gray-500 hover:text-gray-800"
        >
          Images {showImages ? "▲" : "▼"}
        </button>
        <button
          onClick={() => doSave(false)}
          disabled={saving}
          className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => doSave(true)}
          disabled={saving}
          className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Save & Close
        </button>
        <a href={`/note/${note.id}`} className="text-gray-500 hover:text-gray-800">
          Cancel
        </a>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Main editor area */}
        <div className="flex-1 flex flex-col min-h-0 relative">
          {showNoteSearch && (
            <NoteLinkSearch
              onInsert={insertAtCursor}
              onClose={() => setShowNoteSearch(false)}
            />
          )}
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={handleKeyDown}
            className={`flex-1 p-4 text-sm resize-none outline-none border-none bg-white ${fontClass}`}
            placeholder="# Note title&#10;&#10;Write your note here…"
            spellCheck
          />
        </div>

        {/* Right panel */}
        <div className="w-64 border-l border-gray-200 bg-gray-50 flex flex-col overflow-y-auto">
          {/* Tags */}
          <div className="p-3 border-b border-gray-200">
            <div className="font-semibold text-xs text-gray-600 uppercase mb-2">Tags</div>
            <div className="flex flex-wrap gap-1 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full"
                >
                  #{tag}
                  <button onClick={() => removeTag(tag)} className="text-blue-400 hover:text-blue-700">×</button>
                </span>
              ))}
            </div>
            <div className="relative">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => {
                  setTagInput(e.target.value);
                  const q = e.target.value.replace(/^#/, "").toLowerCase();
                  setTagSuggestions(
                    q ? allTags.filter((t) => t.toLowerCase().includes(q)).slice(0, 8) : []
                  );
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tagInput.trim()) {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                }}
                placeholder="Add tag…"
                className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
              />
              {tagSuggestions.length > 0 && (
                <ul className="absolute z-20 bg-white border border-gray-200 rounded shadow w-full text-xs">
                  {tagSuggestions.map((t) => (
                    <li
                      key={t}
                      onClick={() => addTag(t)}
                      className="px-2 py-1 cursor-pointer hover:bg-blue-50"
                    >
                      #{t}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* People */}
          <div className="p-3 border-b border-gray-200">
            <div className="font-semibold text-xs text-gray-600 uppercase mb-2">People</div>
            <div className="flex flex-wrap gap-1 mb-2">
              {people.map((person) => (
                <span
                  key={person}
                  className="inline-flex items-center gap-1 bg-purple-100 text-purple-800 text-xs px-2 py-0.5 rounded-full"
                >
                  @{person}
                  <button onClick={() => removePerson(person)} className="text-purple-400 hover:text-purple-700">×</button>
                </span>
              ))}
            </div>
            <div className="relative">
              <input
                type="text"
                value={personInput}
                onChange={(e) => {
                  setPersonInput(e.target.value);
                  const q = e.target.value.replace(/^@/, "").toLowerCase();
                  setPersonSuggestions(
                    q ? allPeople.filter((p) => p.toLowerCase().includes(q)).slice(0, 8) : []
                  );
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && personInput.trim()) {
                    e.preventDefault();
                    addPerson(personInput);
                  }
                }}
                placeholder="Add person…"
                className="w-full border border-gray-300 rounded px-2 py-1 text-xs"
              />
              {personSuggestions.length > 0 && (
                <ul className="absolute z-20 bg-white border border-gray-200 rounded shadow w-full text-xs">
                  {personSuggestions.map((p) => (
                    <li
                      key={p}
                      onClick={() => addPerson(p)}
                      className="px-2 py-1 cursor-pointer hover:bg-purple-50"
                    >
                      @{p}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Image panel */}
          {showImages && (
            <ImagePanel
              noteId={note.id}
              images={images}
              signedUrls={signedUrls}
              onImagesChange={(imgs, urls) => { setImages(imgs); setSignedUrls(urls); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Image panel ────────────────────────────────────────────────────────────────

import ImagePanel from "./ImagePanel";
