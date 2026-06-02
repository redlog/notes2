import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getProvider } from "@/lib/providers";

const MAX_BIO_BYTES = 100_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const person = decodeURIComponent(name);

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const projectParam = url.searchParams.get("project") ?? undefined;

  const provider = await getProvider();
  const activeProject = await provider.projects.getActive(user.id, projectParam);
  if (!activeProject) return NextResponse.json({ error: "No project" }, { status: 400 });

  const data = await provider.bios.get(activeProject.id, person);
  return NextResponse.json(data);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const person = decodeURIComponent(name);

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const projectParam = url.searchParams.get("project") ?? undefined;

  const provider = await getProvider();
  const activeProject = await provider.projects.getActive(user.id, projectParam);
  if (!activeProject) return NextResponse.json({ error: "No project" }, { status: 400 });

  const { content } = await request.json();
  if (typeof content !== "string" || content.length > MAX_BIO_BYTES) {
    return NextResponse.json({ error: "Invalid content" }, { status: 400 });
  }

  const result = await provider.bios.save(activeProject.id, user.id, person, content);
  return NextResponse.json({ ok: true, updated_at: result.updated_at });
}
