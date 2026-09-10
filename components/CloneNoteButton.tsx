"use client";

import Link from "next/link";
import { Copy } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

interface Props {
  noteId: number;
  /** Compact icon-only trigger (used in list rows) vs. a labelled button (detail page). */
  iconOnly?: boolean;
}

function CloneMenuItems({ noteId }: { noteId: number }) {
  return (
    <DropdownMenuContent align="end">
      <DropdownMenuItem asChild>
        <Link href={`/clone/${noteId}`}>Clone (title &amp; tags only)</Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link href={`/clone/${noteId}?body=1`}>Clone with body</Link>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

export default function CloneNoteButton({ noteId, iconOnly = false }: Props) {
  if (!iconOnly) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-1.5">
            <Copy className="h-3.5 w-3.5" />
            Clone
          </Button>
        </DropdownMenuTrigger>
        <CloneMenuItems noteId={noteId} />
      </DropdownMenu>
    );
  }

  return (
    <TooltipProvider delayDuration={500}>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 lg:h-7 lg:w-7">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Clone</TooltipContent>
        </Tooltip>
        <CloneMenuItems noteId={noteId} />
      </DropdownMenu>
    </TooltipProvider>
  );
}
