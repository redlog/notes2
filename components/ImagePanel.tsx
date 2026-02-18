"use client";

import { useRef, useState } from "react";
import type { NoteImage } from "@/lib/types";

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
    <div className="p-3">
      <div className="font-semibold text-xs text-gray-600 uppercase mb-2">Images</div>
      {error && <p className="text-red-500 text-xs mb-2">{error}</p>}
      <div className="space-y-2">
        {images.map((img) => {
          const url = signedUrls[img.img_num];
          return (
            <div key={img.img_num} className="flex items-center gap-2">
              {url ? (
                <a href={url} target="_blank" rel="noopener">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Image ${img.img_num}`}
                    className="w-10 h-10 object-cover rounded border"
                  />
                </a>
              ) : (
                <div className="w-10 h-10 rounded border bg-gray-100 flex items-center justify-center text-xs text-gray-400">
                  {img.img_num}
                </div>
              )}
              <button
                onClick={() => copyEmbed(img.img_num)}
                className="text-xs text-gray-500 hover:text-gray-800"
                title="Copy embed code"
              >
                &lt;{img.img_num}&gt;
              </button>
              <button
                onClick={() => deleteImage(img.img_num)}
                className="text-xs text-red-500 hover:text-red-700 ml-auto"
              >
                ✕
              </button>
            </div>
          );
        })}
        {images.length === 0 && (
          <p className="text-xs text-gray-400">No images attached.</p>
        )}
      </div>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="mt-2 text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
      >
        {uploading ? "Uploading…" : "Upload PNG"}
      </button>
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
