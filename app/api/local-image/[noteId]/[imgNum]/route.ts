import { NextResponse } from "next/server";
import { getLocalImagesDir } from "@/lib/local-storage";
import { join } from "path";
import { readFile } from "fs/promises";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ noteId: string; imgNum: string }> }
) {
  if (process.env.PROVIDER !== "sqlite") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { noteId, imgNum } = await params;
  const filePath = join(getLocalImagesDir(), noteId, `${imgNum}.png`);

  try {
    const data = await readFile(filePath);
    return new Response(data, {
      headers: { "Content-Type": "image/png" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
