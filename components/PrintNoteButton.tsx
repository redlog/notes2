"use client";

import { Printer } from "lucide-react";
import { Button } from "./ui/button";

/**
 * Opens the bare print view in a new tab. The print view has no scripts, so the
 * viewer's time zone is passed along for it to format the timestamps in.
 */
export default function PrintNoteButton({ noteId }: { noteId: number }) {
  function open() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    window.open(`/note/${noteId}/print?tz=${encodeURIComponent(tz)}`, "_blank", "noopener");
  }

  return (
    <Button variant="outline" className="gap-1.5" onClick={open}>
      <Printer className="h-3.5 w-3.5" />
      Print
    </Button>
  );
}
