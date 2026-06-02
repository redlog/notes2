"use client";

import { useRouter } from "next/navigation";
import type { Project } from "@/lib/types";
import Link from "next/link";
import { Menu, Plus, Settings, LogOut, ChevronDown, User, LayoutGrid } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "./ui/dropdown-menu";

interface Props {
  projects: Project[];
  activeProject: Project;
  userEmail: string;
  localMode?: boolean;
  onMenuToggle?: () => void;
}

export default function Header({ projects, activeProject, userEmail, localMode, onMenuToggle }: Props) {
  const router = useRouter();

  async function signOut() {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function switchProject(projectId: string) {
    router.push(`/?project=${projectId}`);
  }

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex h-full items-center gap-3 px-4">
        {/* Hamburger — mobile only */}
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden shrink-0"
          onClick={onMenuToggle}
          aria-label="Open sidebar"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Logo */}
        <Link
          href="/"
          className="font-semibold text-base tracking-tight text-foreground shrink-0 hover:text-primary transition-colors"
        >
          Localnotes
        </Link>

        {/* Project switcher — desktop */}
        {projects.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="hidden sm:flex items-center gap-1.5 text-muted-foreground hover:text-foreground max-w-[180px]"
              >
                <span className="truncate text-sm">{activeProject.name}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuLabel>Projects</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={activeProject.id} onValueChange={switchProject}>
                {projects.map((p) => (
                  <DropdownMenuRadioItem key={p.id} value={p.id} className="cursor-pointer">
                    {p.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="hidden sm:block text-sm text-muted-foreground truncate max-w-[160px]">
            {activeProject.name}
          </span>
        )}

        <div className="flex-1" />

        {/* Gallery */}
        <Button asChild variant="ghost" size="icon" className="shrink-0" title="Image gallery">
          <Link href={`/images?project=${activeProject.id}`}>
            <LayoutGrid className="h-4 w-4" />
          </Link>
        </Button>

        {/* New Note */}
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/new">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Note</span>
          </Link>
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0" aria-label="User menu">
              <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold">
                {userEmail.charAt(0).toUpperCase()}
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-0.5">
                <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* Project switcher in user menu — mobile */}
            {projects.length > 1 && (
              <>
                <DropdownMenuLabel>Switch project</DropdownMenuLabel>
                {projects.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => switchProject(p.id)}
                    className={`cursor-pointer ${p.id === activeProject.id ? "font-semibold text-primary" : ""}`}
                  >
                    {p.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem asChild>
              <Link href="/config" className="cursor-pointer flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            {!localMode && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={signOut}
                  className="cursor-pointer text-destructive focus:text-destructive flex items-center gap-2"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
