import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/");

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 p-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-primary rounded-xl mb-4 shadow-sm">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-white fill-current">
              <path d="M9 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7l5-5zM8 3.5L4.5 7H8V3.5zM6 9v2h12V9H6zm0 4v2h8v-2H6z"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Localnotes</h1>
          <p className="text-muted-foreground text-sm mt-1">Personal Markdown notes, cloud-backed</p>
        </div>

        {/* Sign-in card */}
        <div className="bg-background rounded-2xl shadow-lg border border-border/50 p-6">
          <p className="text-sm text-center text-muted-foreground mb-5">
            Sign in to access your notes
          </p>
          <a
            href="/auth/google"
            className="flex items-center justify-center gap-3 w-full border border-border rounded-xl px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors shadow-sm"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </a>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-5">
          Your notes are private and only accessible to you
        </p>
      </div>
    </div>
  );
}
