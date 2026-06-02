import { join, dirname } from "path";

export function getLocalDbPath(): string {
  return process.env.SQLITE_DB_PATH ?? join(process.cwd(), "local-data", "notes.db");
}

export function getLocalImagesDir(): string {
  if (process.env.LOCAL_IMAGES_DIR) return process.env.LOCAL_IMAGES_DIR;
  const dbPath = process.env.SQLITE_DB_PATH;
  if (dbPath) return join(dirname(dbPath), "images");
  return join(process.cwd(), "local-data", "images");
}
