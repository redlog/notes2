"use client";

import { useRef, useState } from "react";
import type { NoteImage } from "@/lib/types";
import { Upload, Copy, Trash2, ImageOff } from "lucide-react";
import { Button } from "./ui/button";

interface Props {
  noteId: number;
  images: NoteImage[];
  signedUrls: Record<number, string>;
  onImagesChange: (images: NoteImage[], urls: Record<number, string>) => void;
}

export default function ImagePanel({ noteId, images, signedUrls, onImagesChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    if (!file.type.includes("png")) {
      setError("Only PNG images are accepted.");
      return;
    }
    setUploading(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("noteId", String(noteId));
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (data.ok) {
      onImagesChange(data.images, data.signedUrls);
    } else {
      setError(data.error ?? "Upload failed.");
    }
    setUploading(false);
  }

  async function deleteImage(imgNum: number) {
    const res = await fetch(`/api/image/${noteId}/${imgNum}`, { method: "DELETE" });
    const data = await res.json();
    if (data.ok) onImagesChange(data.images, data.signedUrls);
  }

  function copyEmbed(imgNum: number) {
    navigator.clipboard.writeText(`<${imgNum}>`);
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Images</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="h-7 text-xs gap-1"
        >
          <Upload className="h-3 w-3" />
          {uploading ? "Uploading…" : "Upload PNG"}
        </Button>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      <div className="space-y-2">
        {images.map((img) => {
          const url = signedUrls[img.img_num];
          return (
            <div key={img.img_num} className="flex items-center gap-2 p-1.5 rounded-md border border-border/50 bg-muted/20">
              {url ? (
                <a href={url} target="_blank" rel="noopener" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Image ${img.img_num}`}
                    className="w-10 h-10 object-cover rounded border border-border"
                  />
                </a>
              ) : (
                <div className="w-10 h-10 rounded border border-border bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                  <ImageOff className="h-4 w-4" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <code className="text-xs text-muted-foreground">&lt;{img.img_num}&gt;</code>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => copyEmbed(img.img_num)}
                title="Copy embed code"
              >
                <Copy className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => deleteImage(img.img_num)}
                title="Delete image"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
        {images.length === 0 && (
          <p className="text-xs text-muted-foreground py-1">No images attached.</p>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
