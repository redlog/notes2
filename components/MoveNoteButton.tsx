"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderInput } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import type { Project } from "@/lib/types";

interface Props {
  noteId: number;
  currentProjectId: string;
  projects: Project[];
}

export default function MoveNoteButton({ noteId, currentProjectId, projects }: Props) {
  const [open, setOpen] = useState(false);
  const [targetProjectId, setTargetProjectId] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const otherProjects = projects.filter((p) => p.id !== currentProjectId);

  async function handleMove() {
    if (!targetProjectId) return;
    setLoading(true);
    const res = await fetch(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: targetProjectId }),
    });
    if (res.ok) {
      router.push(`/note/${noteId}?project=${targetProjectId}`);
      router.refresh();
    } else {
      setLoading(false);
      alert("Move failed.");
    }
  }

  function handleOpenChange(val: boolean) {
    setOpen(val);
    if (!val) setTargetProjectId("");
  }

  if (otherProjects.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FolderInput className="h-3.5 w-3.5" />
          Move
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move note</DialogTitle>
          <DialogDescription>
            Select a notebook to move this note into.
          </DialogDescription>
        </DialogHeader>
        <Select value={targetProjectId} onValueChange={setTargetProjectId}>
          <SelectTrigger>
            <SelectValue placeholder="Select a notebook…" />
          </SelectTrigger>
          <SelectContent>
            {otherProjects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={!targetProjectId || loading}>
            {loading ? "Moving…" : "Move note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
