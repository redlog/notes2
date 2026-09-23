"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, GalleryHorizontal, X } from "lucide-react";

interface CarouselImage {
  imgNum: number;
  url: string;
}

interface Props {
  images: CarouselImage[];
}

// Swipe distance (px) needed to count as a left/right gesture on touch screens.
const SWIPE_THRESHOLD = 40;

export default function ImageCarousel({ images }: Props) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const count = images.length;

  const prev = useCallback(() => setIndex((i) => (i - 1 + count) % count), [count]);
  const next = useCallback(() => setIndex((i) => (i + 1) % count), [count]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, prev, next]);

  if (count === 0) return null;
  const current = images[Math.min(index, count - 1)];

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setIndex(0);
      }}
    >
      <DialogPrimitive.Trigger className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline mb-2">
        <GalleryHorizontal className="h-3.5 w-3.5" />
        View as carousel
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col text-white outline-none"
          onTouchStart={(e) => {
            touchStartX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            if (touchStartX.current === null) return;
            const dx = e.changedTouches[0].clientX - touchStartX.current;
            touchStartX.current = null;
            if (dx > SWIPE_THRESHOLD) prev();
            else if (dx < -SWIPE_THRESHOLD) next();
          }}
        >
          <DialogPrimitive.Title className="sr-only">Image carousel</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Use the left and right arrows to move between images.
          </DialogPrimitive.Description>

          {/* Top bar */}
          <div className="flex shrink-0 items-center justify-between px-4 py-3 text-sm">
            <span className="tabular-nums text-white/80">
              {index + 1} / {count}
              <code className="ml-3 text-white/50">&lt;{current.imgNum}&gt;</code>
            </span>
            <DialogPrimitive.Close
              className="rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          {/* Image */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={current.imgNum}
              src={current.url}
              alt={`Image ${current.imgNum}`}
              className="max-h-full max-w-full select-none object-contain"
              draggable={false}
            />

            {count > 1 && (
              <>
                <button
                  type="button"
                  onClick={prev}
                  aria-label="Previous image"
                  className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 hover:bg-white/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:left-3 sm:p-3"
                >
                  <ChevronLeft className="h-6 w-6 sm:h-8 sm:w-8" />
                </button>
                <button
                  type="button"
                  onClick={next}
                  aria-label="Next image"
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/80 hover:bg-white/15 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:right-3 sm:p-3"
                >
                  <ChevronRight className="h-6 w-6 sm:h-8 sm:w-8" />
                </button>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
