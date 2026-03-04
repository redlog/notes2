"use client";

import { useState } from "react";
import Header from "./Header";
import Sidebar from "./Sidebar";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import type { Project, TagCount, PersonCount } from "@/lib/types";

interface Props {
  projects: Project[];
  activeProject: Project;
  userEmail: string;
  tags: TagCount[];
  people: PersonCount[];
  currentSearch?: string;
  currentFilter?: string;
  children: React.ReactNode;
}

export default function AppShell({
  projects,
  activeProject,
  userEmail,
  tags,
  people,
  currentSearch,
  currentFilter,
  children,
}: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Header
        projects={projects}
        activeProject={activeProject}
        userEmail={userEmail}
        onMenuToggle={() => setSidebarOpen(true)}
      />

      {/* Mobile sidebar sheet */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="px-4 pt-5 pb-2">
            <SheetTitle className="text-base">Browse</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6 overflow-y-auto">
            <Sidebar
              tags={tags}
              people={people}

              currentSearch={currentSearch}
              currentFilter={currentFilter}
              onNavigate={() => setSidebarOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex">
        {/* Desktop sidebar — always visible at lg+ */}
        <aside className="hidden lg:block w-56 xl:w-64 shrink-0 border-r border-border bg-muted/20">
          <div className="sticky top-14 overflow-y-auto h-[calc(100vh-3.5rem)] p-4">
            <Sidebar
              tags={tags}
              people={people}

              currentSearch={currentSearch}
              currentFilter={currentFilter}
            />
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
