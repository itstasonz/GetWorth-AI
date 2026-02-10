import React, { useState, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Camera } from 'lucide-react';

/**
 * ImageGallery — swipeable image carousel for mobile
 * Props:
 *   images: string[]     — array of image URLs
 *   aspectRatio: string  — CSS class like "aspect-square" (default)
 *   overlay: ReactNode   — optional overlay content (back button, save button, etc.)
 *   className: string    — wrapper class
 */
export default function ImageGallery({ images = [], aspectRatio = 'aspect-square', overlay, className = '' }) {
  const [current, setCurrent] = useState(0);
  const touchStartX = useRef(0);
  const touchDeltaX = useRef(0);
  const containerRef = useRef(null);
  const isDragging = useRef(false);

  const count = images.length;
  if (count === 0) return null;

  const goTo = useCallback((idx) => {
    setCurrent(Math.max(0, Math.min(idx, count - 1)));
  }, [count]);

  const next = useCallback(() => goTo(current + 1), [current, goTo]);
  const prev = useCallback(() => goTo(current - 1), [current, goTo]);

  // Touch handlers for swipe
  const onTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
    isDragging.current = true;
  };

  const onTouchMove = (e) => {
    if (!isDragging.current) return;
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  };

  const onTouchEnd = () => {
    isDragging.current = false;
    const threshold = 50;
    if (touchDeltaX.current < -threshold) next();
    else if (touchDeltaX.current > threshold) prev();
    touchDeltaX.current = 0;
  };

  return (
    <div className={`relative ${className}`}>
      {/* Image container */}
      <div
        ref={containerRef}
        className={`${aspectRatio} overflow-hidden relative`}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Sliding track */}
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${current * 100}%)`, width: `${count * 100}%` }}
        >
          {images.map((src, i) => (
            <div key={i} className="h-full flex-shrink-0" style={{ width: `${100 / count}%` }}>
              <img
                src={src}
                alt=""
                className="w-full h-full object-cover"
                loading={i === 0 ? 'eager' : 'lazy'}
              />
            </div>
          ))}
        </div>

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#060a14] via-transparent to-[#060a14]/50 pointer-events-none" />

        {/* Arrow buttons (desktop only, hidden on mobile) */}
        {count > 1 && (
          <>
            {current > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); prev(); }}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center hover:bg-black/60 transition-all hidden sm:flex"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {current < count - 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); next(); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center hover:bg-black/60 transition-all hidden sm:flex"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </>
        )}

        {/* Counter badge */}
        {count > 1 && (
          <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md text-xs font-semibold flex items-center gap-1.5 z-10">
            <Camera className="w-3.5 h-3.5" />
            {current + 1}/{count}
          </div>
        )}
      </div>

      {/* Dot indicators */}
      {count > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); goTo(i); }}
              className={`rounded-full transition-all duration-300 ${
                i === current
                  ? 'w-6 h-2 bg-white'
                  : 'w-2 h-2 bg-white/40 hover:bg-white/60'
              }`}
            />
          ))}
        </div>
      )}

      {/* Custom overlay (back button, save, etc.) */}
      {overlay}
    </div>
  );
}
