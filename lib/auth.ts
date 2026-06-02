export const LOCAL_USER_ID = "local";
export const LOCAL_USER_EMAIL = "local@localhost";

export type AuthUser = { id: string; email: string };

export async function getAuthUser(): Promise<AuthUser | null> {
  if (process.env.PROVIDER === "sqlite") {
    return { id: LOCAL_USER_ID, email: LOCAL_USER_EMAIL };
  }
  const { createClient } = await import("./supabase/server");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? "" };
}
