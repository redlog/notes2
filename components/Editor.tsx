"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Note, NoteImage } from "@/lib/types";
import NoteLinkSearch from "./NoteLinkSearch";
import ImagePanel from "./ImagePanel";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { ScrollArea } from "./ui/scroll-area";
import { Save, X, Tag, Users, SlidersHorizontal, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

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

  const [title, setTitle] = useState(note.title);
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
  const [saveStatus, setSaveStatus] = useState<string>(() => {
    const t = new Date(note.updated_at);
    return `Saved ${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}`;
  });
  const [justSaved, setJustSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoSave, setAutoSave] = useState(autosaveEnabled);
  const [showNoteSearch, setShowNoteSearch] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [personInput, setPersonInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [personSuggestions, setPersonSuggestions] = useState<string[]>([]);
  const [font, setFont] = useState<"mono" | "sans" | "serif">("mono");
  const [metaOpen, setMetaOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [mentionState, setMentionState] = useState<{
    type: "tag" | "person";
    query: string;
    triggerPos: number;
    popupTop: number;
  } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const lastSavedBody = useRef(note.body);
  const lastSavedTitle = useRef(note.title);
  const hasMounted = useRef(false);
  const suppressedTriggerPos = useRef<number | null>(null);

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

  // Tags/people: always save immediately on change, regardless of autosave setting
  useEffect(() => {
    if (!hasMounted.current) { hasMounted.current = true; return; }
    if (saving) return;
    doSave(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tags, people]);

  // Autosave body+title on interval
  useEffect(() => {
    if (!autoSave) return;
    const interval = setInterval(async () => {
      if (body !== lastSavedBody.current || title !== lastSavedTitle.current) {
        await doSave(false);
      }
    }, autosaveInterval * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave, body, title, autosaveInterval]);

  async function doSave(navigate = true) {
    setSaving(true);
    const res = await fetch(`/api/notes/${note.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, tags, people, version }),
    });
    const data = await res.json();
    setSaving(false);
    if (data.ok) {
      setVersion(data.version);
      lastSavedBody.current = body;
      lastSavedTitle.current = title;
      const t = new Date(data.updated_at);
      setSaveStatus(
        `Saved ${t.getHours().toString().padStart(2, "0")}:${t.getMinutes().toString().padStart(2, "0")}`
      );
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      if (navigate) router.push(`/note/${note.id}`);
    } else if (data.conflict) {
      setSaveStatus("⚠️ Conflict: modified elsewhere.");
      setAutoSave(false);
    } else {
      setSaveStatus("Save failed.");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // ── Mention popup navigation ──────────────────────────────────────────────
    if (mentionState) {
      const hasCreate = mentionState.query.length > 0 && !mentionResults.includes(mentionState.query);
      const total = mentionResults.length + (hasCreate ? 1 : 0);
      if (e.key === "ArrowDown" && total > 0) {
        e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, total - 1)); return;
      }
      if (e.key === "ArrowUp" && total > 0) {
        e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && total > 0) {
        e.preventDefault();
        insertMention(mentionIndex < mentionResults.length ? mentionResults[mentionIndex] : mentionState.query);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        suppressedTriggerPos.current = mentionState.triggerPos;
        setMentionState(null);
        return;
      }
    }

    // ── Existing key handling ─────────────────────────────────────────────────
    const ta = textareaRef.current!;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const beforeCursor = body.slice(0, start);
    const lineStart = beforeCursor.lastIndexOf("\n") + 1;
    const currentLine = body.slice(lineStart, end);

    if (e.key === "." && e.ctrlKey) {
      e.preventDefault();
      setShowNoteSearch(true);
      return;
    }

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

    if (e.key === "Enter" && !e.shiftKey) {
      const bulletMatch = currentLine.match(/^(\s*)\* (.*)$/);
      if (bulletMatch) {
        e.preventDefault();
        const [, indent, content] = bulletMatch;
        if (!content.trim()) {
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
  }

  function insertAtCursor(text: string) {
    const ta = textareaRef.current!;
    const start = ta.selectionStart;
    const newBody = body.slice(0, start) + text + body.slice(ta.selectionEnd);
    setBody(newBody);
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = start + text.length; }, 0);
    setShowNoteSearch(false);
  }

  const SLUG_RE = /^[a-z0-9_-]+$/;

  function addTag(tag: string) {
    const clean = tag.replace(/^#/, "").trim();
    if (clean && SLUG_RE.test(clean) && !tags.includes(clean)) setTags([...tags, clean]);
    setTagInput("");
    setTagSuggestions([]);
  }

  function addPerson(person: string) {
    const clean = person.replace(/^@/, "").trim();
    if (clean && SLUG_RE.test(clean) && !people.includes(clean)) setPeople([...people, clean]);
    setPersonInput("");
    setPersonSuggestions([]);
  }

  function removeTag(tag: string) { setTags(tags.filter((t) => t !== tag)); }
  function removePerson(person: string) { setPeople(people.filter((p) => p !== person)); }

  // ── Mention popup helpers ───────────────────────────────────────────────────

  function detectMentionTrigger(textBefore: string) {
    let i = textBefore.length - 1;
    while (i >= 0 && /[a-z0-9_-]/.test(textBefore[i])) i--;
    if (i < 0) return null;
    const ch = textBefore[i];
    if (ch !== "#" && ch !== "@") return null;
    const prev = i > 0 ? textBefore[i - 1] : null;
    if (prev !== null && !/[\s\n]/.test(prev)) return null;
    return { type: (ch === "#" ? "tag" : "person") as "tag" | "person", query: textBefore.slice(i + 1), triggerPos: i };
  }

  function getMentionPopupTop(textarea: HTMLTextAreaElement, cursorPos: number): number {
    const TITLE_HEIGHT = 80;
    const LINE_HEIGHT = 22;
    const lines = (textarea.value.slice(0, cursorPos).match(/\n/g) || []).length;
    return TITLE_HEIGHT + lines * LINE_HEIGHT - textarea.scrollTop;
  }

  function insertMention(item: string) {
    if (!mentionState) return;
    const ta = textareaRef.current!;
    const prefix = mentionState.type === "tag" ? "#" : "@";
    const newBody = body.slice(0, mentionState.triggerPos) + prefix + item + body.slice(ta.selectionStart);
    setBody(newBody);
    const newPos = mentionState.triggerPos + 1 + item.length;
    setTimeout(() => { ta.selectionStart = ta.selectionEnd = newPos; ta.focus(); }, 0);
    setMentionState(null);
    suppressedTriggerPos.current = null;
  }

  function handleBodyChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setBody(value);
    const trigger = detectMentionTrigger(value.slice(0, e.target.selectionStart));
    if (!trigger) {
      suppressedTriggerPos.current = null;
      setMentionState(null);
    } else if (trigger.triggerPos === suppressedTriggerPos.current) {
      setMentionState(null);
    } else {
      suppressedTriggerPos.current = null;
      setMentionState({ ...trigger, popupTop: getMentionPopupTop(e.target, e.target.selectionStart) });
      setMentionIndex(0);
    }
  }

  const fontClass = font === "mono" ? "font-mono" : font === "serif" ? "font-serif" : "font-sans";

  // Body mention tags/people (live from body text, excluding already-added header ones)
  const bodyMentionTags = useMemo(() => {
    const found = [...body.matchAll(/#([a-z0-9_-]+)/g)].map((m) => m[1]);
    return [...new Set(found)].filter((t) => !tags.includes(t));
  }, [body, tags]);

  const bodyMentionPeople = useMemo(() => {
    const found = [...body.matchAll(/@([a-z0-9_-]+)/g)].map((m) => m[1]);
    return [...new Set(found)].filter((p) => !people.includes(p));
  }, [body, people]);

  const mentionResults = useMemo(() => {
    if (!mentionState) return [];
    const list = mentionState.type === "tag" ? allTags : allPeople;
    const q = mentionState.query.toLowerCase();
    const filtered = q ? list.filter((t) => t.toLowerCase().includes(q)) : list;
    return filtered.slice(0, 8);
  }, [mentionState, allTags, allPeople]);

  const metaPanel = (
    <div className="flex flex-col divide-y divide-border">
      {/* Tags */}
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Tag className="h-3.5 w-3.5 text-blue-500" />
          Tags
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-800 text-xs px-2 py-0.5 rounded-full"
            >
              #{tag}
              <button
                onClick={() => removeTag(tag)}
                className="text-blue-400 hover:text-blue-700 leading-none"
              >
                ×
              </button>
            </span>
          ))}
          {bodyMentionTags.map((tag) => (
            <span
              key={`body-${tag}`}
              title="Mentioned in body"
              className="inline-flex items-center gap-1 bg-blue-50/50 border border-dashed border-blue-200 text-blue-600 text-xs px-2 py-0.5 rounded-full"
            >
              #{tag}
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
              if (e.key === "Enter" && tagInput.trim()) { e.preventDefault(); addTag(tagInput); }
            }}
            placeholder="Add tag…"
            className="w-full h-8 border border-input rounded-md px-2.5 py-1 text-xs bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {tagSuggestions.length > 0 && (
            <ul className="absolute z-20 bg-popover border border-border rounded-md shadow-md w-full text-xs mt-1 overflow-hidden">
              {tagSuggestions.map((t) => (
                <li
                  key={t}
                  onClick={() => addTag(t)}
                  className="px-2.5 py-1.5 cursor-pointer hover:bg-accent transition-colors"
                >
                  #{t}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* People */}
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Users className="h-3.5 w-3.5 text-violet-500" />
          People
        </div>
        <div className="flex flex-wrap gap-1.5">
          {people.map((person) => (
            <span
              key={person}
              className="inline-flex items-center gap-1 bg-violet-50 border border-violet-200 text-violet-800 text-xs px-2 py-0.5 rounded-full"
            >
              @{person}
              <button
                onClick={() => removePerson(person)}
                className="text-violet-400 hover:text-violet-700 leading-none"
              >
                ×
              </button>
            </span>
          ))}
          {bodyMentionPeople.map((person) => (
            <span
              key={`body-${person}`}
              title="Mentioned in body"
              className="inline-flex items-center gap-1 bg-violet-50/50 border border-dashed border-violet-200 text-violet-600 text-xs px-2 py-0.5 rounded-full"
            >
              @{person}
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
              if (e.key === "Enter" && personInput.trim()) { e.preventDefault(); addPerson(personInput); }
            }}
            placeholder="Add person…"
            className="w-full h-8 border border-input rounded-md px-2.5 py-1 text-xs bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {personSuggestions.length > 0 && (
            <ul className="absolute z-20 bg-popover border border-border rounded-md shadow-md w-full text-xs mt-1 overflow-hidden">
              {personSuggestions.map((p) => (
                <li
                  key={p}
                  onClick={() => addPerson(p)}
                  className="px-2.5 py-1.5 cursor-pointer hover:bg-accent transition-colors"
                >
                  @{p}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Images */}
      <div>
        <ImagePanel
          noteId={note.id}
          images={images}
          signedUrls={signedUrls}
          onImagesChange={(imgs, urls) => { setImages(imgs); setSignedUrls(urls); }}
        />
      </div>

      {/* Autosave toggle */}
      <div className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Autosave</span>
          <Switch checked={autoSave} onCheckedChange={setAutoSave} />
        </div>
      </div>
    </div>
  );

  return (
    <div className={cn("flex flex-col", focusMode ? "fixed inset-0 z-50 bg-background" : "h-[calc(100vh-3.5rem)]")}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-border bg-muted/20 flex-wrap">
        <span className={cn(
          "text-xs shrink-0 transition-colors duration-300",
          saveStatus.startsWith("⚠️") ? "text-destructive"
            : justSaved ? "text-green-600 font-medium"
            : "text-muted-foreground"
        )}>
          {saving ? "Saving…" : saveStatus}
        </span>

        <div className="flex-1 hidden sm:block" />

        {/* Font selector */}
        <Select value={font} onValueChange={(v) => setFont(v as "mono" | "sans" | "serif")}>
          <SelectTrigger className="h-9 lg:h-7 w-[80px] text-xs border-0 bg-transparent shadow-none focus:ring-0 text-muted-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mono">Mono</SelectItem>
            <SelectItem value="sans">Sans</SelectItem>
            <SelectItem value="serif">Serif</SelectItem>
          </SelectContent>
        </Select>

        {/* Meta panel toggle — mobile/tablet only */}
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 lg:hidden"
          onClick={() => setMetaOpen(true)}
          title="Tags, People & Images"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>

        {/* Focus mode toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 lg:h-7 lg:w-7 shrink-0"
          onClick={() => setFocusMode((f) => !f)}
          title={focusMode ? "Exit focus mode" : "Expand editor"}
        >
          {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => doSave(false)}
            disabled={saving}
            className="h-9 lg:h-7 text-xs gap-1"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            onClick={() => doSave(true)}
            disabled={saving}
            className="h-9 lg:h-7 text-xs"
          >
            Save & Close
          </Button>
          <Button variant="ghost" size="icon" className="h-10 w-10 lg:h-7 lg:w-7" asChild>
            <a href={`/note/${note.id}`} title="Cancel">
              <X className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Title + body */}
        <div className="flex-1 flex flex-col min-h-0 relative">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Note title"
            className={cn(
              "w-full px-4 sm:px-6 pt-5 pb-3 text-2xl font-bold bg-transparent outline-none border-b border-border/40 text-foreground placeholder:text-muted-foreground/40",
              fontClass
            )}
          />
          {showNoteSearch && (
            <NoteLinkSearch
              onInsert={insertAtCursor}
              onClose={() => setShowNoteSearch(false)}
            />
          )}
          {/* Mention popup */}
          {mentionState && (mentionResults.length > 0 || mentionState.query) && (
            <ul
              className="absolute z-30 left-4 sm:left-6 bg-popover border border-border rounded-md shadow-lg w-56 max-h-52 overflow-auto py-1"
              style={{ top: mentionState.popupTop }}
            >
              {mentionResults.map((item, idx) => (
                <li
                  key={item}
                  onMouseDown={(e) => { e.preventDefault(); insertMention(item); }}
                  className={cn(
                    "flex items-center gap-1 px-3 py-2 cursor-pointer text-sm select-none",
                    idx === mentionIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <span className={mentionState.type === "tag" ? "text-blue-500" : "text-violet-500"}>
                    {mentionState.type === "tag" ? "#" : "@"}
                  </span>
                  {item}
                </li>
              ))}
              {mentionState.query && !mentionResults.includes(mentionState.query) && (
                <li
                  onMouseDown={(e) => { e.preventDefault(); insertMention(mentionState.query); }}
                  className={cn(
                    "flex items-center gap-1 px-3 py-2 cursor-pointer text-sm select-none text-muted-foreground",
                    mentionIndex === mentionResults.length ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <span className="text-xs">Add</span>
                  <span className={mentionState.type === "tag" ? "text-blue-500" : "text-violet-500"}>
                    {mentionState.type === "tag" ? "#" : "@"}{mentionState.query}
                  </span>
                </li>
              )}
            </ul>
          )}
          <textarea
            ref={textareaRef}
            value={body}
            onChange={handleBodyChange}
            onKeyDown={handleKeyDown}
            className={cn(
              "flex-1 p-4 sm:p-6 text-sm resize-none outline-none border-none bg-background leading-relaxed",
              fontClass
            )}
            placeholder="Write your note here…"
            spellCheck
          />
        </div>

        {/* Right meta panel — desktop only */}
        <div className="hidden lg:flex w-64 xl:w-72 border-l border-border bg-muted/10 flex-col">
          <ScrollArea className="flex-1">
            {metaPanel}
          </ScrollArea>
        </div>
      </div>

      {/* Mobile meta sheet */}
      <Sheet open={metaOpen} onOpenChange={setMetaOpen}>
        <SheetContent side="right" className="w-80 p-0">
          <SheetHeader className="px-4 pt-5 pb-2">
            <SheetTitle className="text-base">Tags, People & Images</SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-5rem)]">
            {metaPanel}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}
