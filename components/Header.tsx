"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Project } from "@/lib/types";
import Link from "next/link";

interface Props {
  projects: Project[];
  activeProject: Project;
  userEmail: string;
}

export default function Header({ projects, activeProject, userEmail }: Props) {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function switchProject(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(`/?project=${e.target.value}`);
  }

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-4 sticky top-0 z-10">
      <Link href="/" className="font-bold text-lg tracking-tight text-gray-900 shrink-0">
        Localnotes
      </Link>

      {/* Project switcher */}
      <select
        value={activeProject.id}
        onChange={switchProject}
        className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
        aria-label="Switch project"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <div className="flex-1" />

      <Link href="/new" className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition">
        + New Note
      </Link>

      <Link href="/config" className="text-sm text-gray-600 hover:text-gray-900">
        Settings
      </Link>

      <div className="text-sm text-gray-500 hidden sm:block">{userEmail}</div>

      <button
        onClick={signOut}
        className="text-sm text-gray-600 hover:text-gray-900"
      >
        Sign out
      </button>
    </header>
  );
}
