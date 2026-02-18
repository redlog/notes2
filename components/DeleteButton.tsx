"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  noteId: number;
}

export default function DeleteButton({ noteId }: Props) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (confirm !== "delete") return;
    setLoading(true);
    const res = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setLoading(false);
      alert("Delete failed.");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1 border border-red-300 text-red-600 rounded text-sm hover:bg-red-50"
      >
        Delete
      </button>
    );
  }

  return (
    <div className="border border-red-300 rounded p-3 space-y-2 bg-red-50">
      <p className="text-sm text-red-700">Type <strong>delete</strong> to confirm:</p>
      <input
        type="text"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className="border border-red-300 rounded px-2 py-1 text-sm w-full"
        autoFocus
      />
      <div className="flex gap-2">
        <button
          onClick={handleDelete}
          disabled={confirm !== "delete" || loading}
          className="px-3 py-1 bg-red-600 text-white rounded text-sm disabled:opacity-40 hover:bg-red-700"
        >
          {loading ? "Deleting…" : "Confirm Delete"}
        </button>
        <button
          onClick={() => { setOpen(false); setConfirm(""); }}
          className="px-3 py-1 border rounded text-sm hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
