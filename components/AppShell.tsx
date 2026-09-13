"use client";

import { useEffect, useState } from "react";
import Header from "./Header";
import Sidebar from "./Sidebar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import type { Project, TagCount, PersonCount } from "@/lib/types";

interface Props {
  projects: Project[];
  activeProject: Project;
  userEmail: string;
  localMode?: boolean;
  tags: TagCount[];
  people: PersonCount[];
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}

const SIDEBAR_HIDDEN_KEY = "localnotes:sidebarHidden";

export default function AppShell({
  projects,
  activeProject,
  userEmail,
  localMode,
  tags,
  people,
  toolbar,
  children,
}: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop-only preference: collapse the always-on sidebar. Read after mount so
  // server and first client render agree.
  const [sidebarHidden, setSidebarHidden] = useState(false);

  useEffect(() => {
    try {
      setSidebarHidden(localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1");
    } catch {
      // Storage unavailable (private mode, blocked cookies) — keep the default.
    }
  }, []);

  function toggleSidebarHidden() {
    setSidebarHidden((hidden) => {
      const next = !hidden;
      try {
        localStorage.setItem(SIDEBAR_HIDDEN_KEY, next ? "1" : "0");
      } catch {
        // Preference just won't persist.
      }
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <Header
        projects={projects}
        activeProject={activeProject}
        userEmail={userEmail}
        localMode={localMode}
        onMenuToggle={() => setSidebarOpen(true)}
        sidebarHidden={sidebarHidden}
        onSidebarToggle={toggleSidebarHidden}
      />

      {/* Mobile sidebar sheet */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[22rem] p-0">
          <SheetHeader className="px-4 pt-5 pb-2">
            <SheetTitle className="text-base">Browse</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6 overflow-y-auto">
            <Sidebar
              tags={tags}
              people={people}
              onNavigate={() => setSidebarOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex">
        {/* Desktop sidebar — visible at lg+ unless hidden from the header toggle */}
        {!sidebarHidden && (
          <aside className="hidden lg:block w-96 xl:w-[28rem] shrink-0 border-r border-border bg-muted/20">
            <div className="sticky top-14 overflow-hidden h-[calc(100vh-3.5rem)] p-4">
              <Sidebar
                tags={tags}
                people={people}
              />
            </div>
          </aside>
        )}

        {/* Main content */}
        <div className="flex-1 min-w-0 flex flex-col">
          {toolbar && (
            <div className="sticky top-14 z-10 bg-background/95 backdrop-blur border-b border-border px-4 sm:px-6 py-2">
              {toolbar}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
