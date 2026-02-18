# Localnotes v2 — Product Requirements Document

**Version:** 1.0
**Date:** 2026-02-28
**Status:** Draft

---

## 1. Overview

Localnotes v2 is a personal note-taking web application focused on fast Markdown authoring, flexible tag-based organization, and powerful full-text search. Unlike v1, notes are cloud-stored per-user with Google OAuth authentication. The application retains the same core workflow: a single-page feel with an always-visible search and filter bar, a note list, and a rich text editor. All notes are stored in Markdown format; tag and people metadata is stored in the database rather than embedded in the note body as HTML comments.

### Core Design Principles

- **Speed over polish.** Fast search, fast navigation, no loading screens.
- **Keyboard-first editing.** The editor supports power-user shortcuts for lists, links, and mentions.
- **Flat organization.** Tags and people are the primary organizational primitives — no folders, no hierarchies.
- **Portable content.** Note bodies are clean Markdown with no app-specific syntax except `note:ID` cross-references and image placeholders.

---

## 2. Authentication and Multi-User

### 2.1 Sign-In
- Google OAuth is the sole sign-in method.
- Users sign in via the standard Google OAuth consent flow.
- On first sign-in, a user account is automatically created. No separate registration step exists.
- Session tokens are managed by the auth layer; users remain signed in across browser sessions until they explicitly sign out.

### 2.2 User Identity
- Each user's data is fully isolated. Users cannot see or access each other's notes, tags, or projects.
- User identity is the Google account (email + Google user ID).

### 2.3 Sign-Out
- A sign-out link is available in the header. Signing out clears the session.

---

## 3. Projects (Workspaces)

### 3.1 What Is a Project
- A project is a named, isolated collection of notes. Each user can have multiple projects.
- Projects serve as top-level organizational containers — akin to notebooks.
- Notes, tags, people, and the search index all exist within a single project. There is no cross-project search or filtering.

### 3.2 Project Management
- The active project is shown in the header navigation.
- A dropdown in the header lists all of the user's projects and allows switching.
- Switching projects reloads the note list in the context of the newly selected project.
- Each user gets a "Default" project created automatically on first sign-in.
- Users can create additional projects by naming them. Project names must be unique per user.
- Projects can be renamed or deleted. Deleting a project permanently deletes all notes and images within it (requires explicit confirmation).

### 3.3 Project Settings
- Per-project settings (e.g., notes per page default) are stored in the database.
- A settings/config page shows the user's active project settings and allows editing.

---

## 4. Notes

### 4.1 Note Data Model

Each note has:

| Field | Description |
|---|---|
| **ID** | Unique identifier (server-assigned, e.g. timestamp or UUID) |
| **Title** | Extracted from the first `# Heading` line in the Markdown body; defaults to "(untitled)" |
| **Body** | Full Markdown text (stored as-is, no embedded metadata) |
| **Tags** | List of tag strings; stored in database, not in the Markdown |
| **People (Attendees)** | List of person strings; stored in database, not in the Markdown |
| **Created at** | Server timestamp of note creation |
| **Last edited at** | Server timestamp of most recent save |
| **Project** | Project this note belongs to |
| **Owner** | User who owns this note |
| **Version** | Monotonically increasing integer; incremented on every save (used for optimistic concurrency) |

**Important:** The note body is clean Markdown. There are no `<!-- tags: -->` or `<!-- attendees: -->` comment headers. All metadata lives in the database.

### 4.2 Creating Notes
- A "New Note" action creates a blank note and immediately opens the editor.
- Tags and people can be set during editing via the tag/people UI (see §6 Editor).
- On creation the note is saved immediately as a blank draft so it has a valid ID.

### 4.3 Reading Notes
- The read view renders the Markdown body to HTML.
- Markdown features supported:
  - Standard CommonMark formatting (headings, bold, italic, code, blockquote, horizontal rule)
  - Fenced code blocks with optional language hints
  - Ordered and unordered lists, including nested lists
  - Tables (rendered with borders and padding)
  - Inline code
  - External hyperlinks
- Post-render enrichment:
  - `note:ID` patterns become clickable links to the referenced note, showing the target note's title. If the target note does not exist, an inline "Note not found" warning is shown.
  - `#tag` patterns in the body become clickable links that activate a tag filter.
  - `@person` patterns in the body become clickable links that activate a people filter.
  - `<N>` patterns (e.g. `<1>`, `<2>`) are replaced by embedded images from the note's image attachments.
- The right sidebar shows: tags, people, created date, last-edited date, edit/clone/delete buttons, inlinks (notes that reference this note), and attached images.

### 4.4 Editing Notes
- The editor is a plain textarea containing the raw Markdown.
- Tags and people are edited via a dedicated UI panel alongside the textarea (not by typing into the Markdown).
- On save: the server parses the Markdown, extracts the title from the first `# ` heading, saves the body and metadata atomically, updates the search index, and returns the new version number.
- Conflict detection uses **optimistic concurrency**: the client tracks the `version` number it last received. On save, the server rejects the write if the stored version has changed since the client loaded the note, and returns an error with the current content so the user can merge manually.

### 4.5 Autosave
- The editor supports optional autosave on a configurable interval (default 30 seconds, minimum 15 seconds).
- A checkbox in the editor toolbar toggles autosave on/off.
- Autosave fires only when the note body has changed since the last save.
- On each autosave:
  1. Client sends the current body, current tags/people, and the known `version`.
  2. Server saves and returns the new `version` and last-edit timestamp.
  3. Client updates its tracked version and shows "Saved at HH:MM:SS" in the title bar.
- If autosave encounters a version conflict, it shows an error alert and stops autosaving. The user must manually resolve the conflict.

### 4.6 Cloning Notes
- "Clone" creates a new note pre-populated with the same tags and people as the source. The body starts with a reference to the source note (`note:ID`).
- The clone immediately opens in the editor.

### 4.7 Deleting Notes
- Deletion requires an explicit confirmation step: the user must type the word "delete" into a confirmation input before the action is accepted.
- Deletion permanently removes the note, its search index entries, all attached images, and all inlink records where this note is the source. Notes that link *to* the deleted note will show the "Note not found" warning in their rendered view.

---

## 5. Search and Filtering

The main list view always has a search bar and filter bar visible at the top.

### 5.1 Full-Text Search
- The user types a query into the search box and presses Enter (or submits the form).
- The search engine matches the query against the full text of all note bodies in the active project.
- **Partial-word matching** is supported: searching "test" will find "testing" and "untested".
- **Multi-word queries**: all terms must match (implicit AND).
- **Stopwords** (common words: the, a, is, it, etc.) are excluded from indexing and ignored in queries.
- Results are returned ranked by relevance (search score).
- When a search is active, the default sort order changes to "Relevance" (highest score first). The user can override this.
- The search is case-insensitive.
- Clearing the search box and resubmitting returns to the full note list.

### 5.2 Tag and People Filtering
- Filters are applied via a filter bar or by clicking tag/people links throughout the UI.
- Multiple filters are ANDed together.
- Filter tokens:

| Syntax | Meaning |
|---|---|
| `#tag` | Note must have this tag (includes tags mentioned only in the body) |
| `@person` | Note must have this person (includes body mentions) |
| `+#tag` | Note must have this as a "header" tag AND no other tags |
| `+@person` | Note must have this as an "attendee" AND no other people |
| `~#tag` | Note must NOT have this tag |

- Filter tokens are space- or comma-separated.
- Filters are applied after full-text search, narrowing the search results further.

### 5.3 Date Range Filtering
- A date range picker allows filtering notes by their creation timestamp.
- Both start and end dates are inclusive (end date includes the full day).
- Dates are entered via a datepicker UI control.
- Either bound can be left blank to mean "from the earliest" or "to the latest."

### 5.4 Tag/People Sidebar
- The left sidebar lists all tags and all people across the active project with their occurrence counts.
- Tags panel:
  - Sortable by name (alphabetical) or by count (descending).
  - A filter input narrows the list in real-time as the user types.
  - Clicking a tag adds it to the active filter.
  - Each tag has a "TL" (Tagline) link to the tagline view for that tag.
- People panel:
  - Same sorting and filtering behavior as tags.
  - Clicking a person adds them to the active filter.

### 5.5 Taglines View
- `/tagline/<tag>` shows every individual line (from every note in the project) that mentions the given tag.
- Each result shows the source note's title, the date, and the matching line rendered as Markdown.
- Lines that contain only metadata (e.g. blank lines) are excluded.
- The tagline view is useful for finding all uses of a tag in context without reading full notes.
- Results are limited to 25 lines.

---

## 6. Editor

### 6.1 Textarea
- Raw Markdown is edited in a resizable plain textarea.
- The textarea fills the available vertical space dynamically (viewport minus toolbar height).
- Font can be toggled between monospace, sans-serif, and serif.

### 6.2 Keyboard Shortcuts

| Key | Action |
|---|---|
| Tab | Indent bullet point (adds 4 spaces before `* `) |
| Shift+Tab | De-indent bullet point |
| Enter | Auto-continues bulleted lists at the same indentation level; pressing Enter on an empty bullet removes it |
| @ | Opens the people autocomplete dropdown |
| Ctrl+. | Opens the note-link search panel (search for a note title to insert `note:ID`) |

### 6.3 Tags Editor
- A dedicated UI panel (adjacent to the textarea) shows the note's current tags as removable chips.
- A text input with autocomplete (against all existing tags in the project) allows adding new tags.
- Tags are saved to the database when the note is saved; they do not appear in the Markdown body.
- Tags typed directly as `#tag` in the Markdown body are recognized as **body mentions**, not header tags. They appear in the tag sidebar with reduced weight and are filterable but do not count as "official" header tags.

### 6.4 People Editor
- Same chip-based UI as tags, but for people (attendees).
- A text input with autocomplete (against all existing people in the project).
- The `@` keyboard shortcut opens an inline autocomplete at the cursor position in the textarea to insert a `@mention` in the body text.
- People mentioned as `@person` in the Markdown body are recognized as body mentions, not header attendees.

### 6.5 Image Panel
- A collapsible image management panel is accessible from the editor toolbar ("Image pane: show | hide").
- The panel shows all images currently attached to the note.
- Images can be uploaded (PNG format only, validated client- and server-side).
- Images can be deleted individually.
- Clicking an image's number copies the `<N>` embed syntax to the clipboard.

### 6.6 Note Link Search
- Pressing Ctrl+. opens a "Note Search" panel.
- Typing in the panel queries `/api/title_search` against all note titles in the project (up to 25 results).
- Clicking a result inserts `note:ID` at the current cursor position in the textarea.

### 6.7 Concurrent Edit Warning (BroadcastChannel)
- When a note is opened for editing, the browser tab broadcasts a message via the BroadcastChannel API identifying the note ID.
- If another tab in the same browser is already editing the same note, a warning banner is displayed.
- This is advisory only — no hard lock is enforced. The version-based conflict detection on save is the authoritative safety mechanism.

---

## 7. Note List View

### 7.1 Layout
- Notes are displayed as a paginated list.
- Each row shows:
  - Note title (clickable link to read view)
  - Creation timestamp
  - Last-edited timestamp (shown when sorting by last edit)
  - Relevance score (shown when a search query is active)
  - Tags (each clickable to add as a filter)
  - People (each clickable to add as a filter)
  - Action buttons: Edit, Clone, Expand

### 7.2 Expand/Collapse
- Each note in the list has an "Expand" button that loads and shows the fully rendered Markdown body inline, without navigating away.
- The body is fetched lazily from the API only when first expanded.
- "Expand All" and "Collapse All" controls act on all visible notes.

### 7.3 Pagination
- Default notes per page is 25 (configurable per user in settings).
- Direct page links and Prev/Next navigation controls are shown.
- A count ("Showing notes X–Y of Z") is always visible.
- The per-page count (`nn`) can be changed via the URL parameter and is respected across navigation.

### 7.4 Sorting
- Sort key options: **Timestamp** (creation date), **Last Edited**, **Relevance** (only available when a search is active).
- Sort order: **Ascending** or **Descending**.
- Sorting controls are shown in the list header.
- Default: Timestamp Descending (newest first). When a search is active: Relevance Descending.

---

## 8. Images

### 8.1 Storage
- Images are stored in cloud object storage (one bucket per deployment, organized by user/project/note).
- Only PNG format is accepted.
- Images are numbered sequentially per note (1, 2, 3, ...).

### 8.2 Embedding
- In the note Markdown body, `<1>` embeds image number 1, `<2>` embeds image number 2, etc.
- In the rendered read view, these are replaced by inline `<img>` tags linking to the image URL.
- Images are clickable and open full-size in a new browser tab.

### 8.3 Management
- The image management panel (in the editor sidebar) lists all images for the note.
- Each image shows a thumbnail and a delete button.
- Upload accepts a PNG file via a file picker.
- Deleting an image removes it from storage. Any `<N>` references to deleted images in the Markdown body will render broken.
- Images are automatically deleted when their parent note is deleted.

---

## 9. Inlinks (Backlinks)

### 9.1 Creating References
- In note body Markdown, `note:ID` creates a cross-reference to another note.
- In the read view, this renders as a clickable link with the target note's title.
- If the target note does not exist, renders as "Note not found: ID" with strikethrough styling.

### 9.2 Viewing Inlinks
- The read view sidebar shows a "What links here" panel listing all notes that reference the current note.
- Each entry is a clickable link to the referencing note, showing its title.
- Inlink counts are maintained in the database and updated whenever a note is saved or deleted.

---

## 10. Export

### 10.1 Trigger
- Any note list result set (with or without search/filter/date range applied) can be exported.
- An "Export this result set" link appears at the bottom of any list.

### 10.2 Output
- The export produces a single self-contained HTML file.
- The file is downloaded directly by the browser (Content-Disposition: attachment).
- The file contains:
  - A table of contents listing all exported notes (with anchor links).
  - The current search string and filter string as metadata.
  - All matching notes in the current sort order, with fully rendered Markdown.
  - Embedded image tags (images are linked by URL, not inlined as base64).
  - Navigation links from each note body back to the table of contents.

---

## 11. Configuration / Settings

### 11.1 Settings Page
- A settings page (`/config`) shows:
  - Current active project and its settings.
  - Global account settings.
  - App version information.

### 11.2 Per-User Settings
- Notes per page (default: 25)
- Autosave enabled/disabled (default: enabled)
- Autosave interval in seconds (default: 30, minimum: 15)

### 11.3 Per-Project Settings
- Project name (editable)
- Trigram (partial-word) search enabled/disabled (default: enabled)

---

## 12. Search Index

### 12.1 How Indexing Works
- The search index is built automatically when notes are created, edited, or deleted.
- Full-text indexing covers the note body, title, tags, and people.
- Stopwords are excluded.
- URLs, HTML comments, and bare numbers are stripped before indexing.
- When trigram search is enabled, words are indexed as character-level trigrams, enabling substring matching.

### 12.2 Manual Reindex
- A "Reindex" action (available from the header or settings page) rebuilds the full search index for the active project from scratch.
- This is useful if the index becomes inconsistent.

### 12.3 Search Result Scoring
- Results are scored by TF-IDF (term frequency × inverse document frequency), normalized by document length.
- Higher scores indicate more relevant notes.
- Scores are displayed in the list when a search is active and sorting by relevance.

---

## 13. Body Mentions vs. Header Metadata

This is a key distinction maintained from v1.

### 13.1 Header Tags and People
- Tags and people explicitly set via the editor UI panel are "header" tags/people.
- They are stored as first-class metadata in the database.
- They represent the user's intentional categorization.

### 13.2 Body Mentions
- `#tag` and `@person` patterns found in the Markdown body (but not set via the UI panel) are "mentions."
- They are extracted by the server when the note is saved or indexed, and stored separately from header metadata.
- They appear in the tag/people sidebar counts and are filterable, but with lower semantic weight.
- The exclusive filter (`+#tag`) matches only header tags, not body mentions.

---

## 14. Features Explicitly Removed vs. v1

| v1 Feature | Status in v2 |
|---|---|
| Local file storage (`.md` files on disk) | **Removed.** All data stored in cloud database. |
| `<!-- tags: -->` / `<!-- attendees: -->` HTML comment headers in Markdown | **Removed.** Metadata stored in database; note bodies are clean Markdown. |
| File-based note locking (`.lock` files) | **Removed.** Replaced by version-based optimistic concurrency. |
| `filelock`-based index locking | **Removed.** Database handles concurrent access natively. |
| Index stored as `index.json` | **Removed.** Database-backed search index. |
| Per-note Unix timestamp filenames as IDs | **Replaced.** Server-assigned IDs (database primary keys). |
| Multi-project stored as separate directories | **Replaced.** Projects are database records. |
| `/exit_cleanly` shutdown endpoint | **Removed.** Cloud-hosted server has no shutdown endpoint. |
| Telemetry (optional ping to AWS Lambda) | **Removed.** |
| Obfuscation build mode | **Removed.** |
| macOS/Windows desktop app (wxPython) | **Out of scope for v2.** |
| Local config file (`~/localnotes/config.json`) | **Removed.** Settings stored per-user in database. |

---

## 15. Non-Functional Requirements

- **Latency:** Note list, read, and search should respond in under 500ms for projects with up to 10,000 notes.
- **Concurrent edits:** Version-based optimistic locking prevents silent data loss. Users get a clear error message with both versions when a conflict occurs.
- **Data isolation:** Strict per-user data isolation enforced at the database query level, not just UI level.
- **Image size:** No individual image size limit is specified, but the UI only accepts PNG format.
- **Mobile:** The layout should be usable on mobile; tag/people sidebars can be hidden or collapsed on small screens.
- **No offline mode:** v2 requires a network connection. There is no local caching or offline editing capability.
