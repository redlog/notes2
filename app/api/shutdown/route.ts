import { NextResponse } from "next/server";

// Local mode only — lets the UI cleanly stop the server process. Cloud
// deployments (Supabase/GCP) serve multiple users, so exiting the process
// here would be destructive; the route doesn't exist for those providers.
export async function POST() {
  if (process.env.PROVIDER !== "sqlite") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { shutdownDb } = await import("@/lib/providers/sqlite");
  shutdownDb();

  // Delay so the response below has time to flush before the process exits.
  setTimeout(() => process.exit(0), 100);

  return NextResponse.json({ ok: true });
}
