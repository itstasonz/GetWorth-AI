import React, { useRef, useEffect, useCallback } from 'react';
import {
  Camera, Upload, ArrowRight, ArrowLeft
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { formatPrice, timeAgo, getConditionLabel } from '../lib/utils';

// ═══════════════════════════════════════════════════════════════════════
// STITCH DESIGN TOKENS — ported faithfully from the HTML tailwind.config
// ═══════════════════════════════════════════════════════════════════════
// UI-002: the file-local token object that used to live here is gone.
// Seven parallel declarations (this one, four siblings, :root and the
// Tailwind config) had already drifted — GLASS_BG shipped at 0.4 here and
// 0.6 in CameraResultsView, so glass panels were different weights on
// adjacent screens. Key names are unchanged, so no call site moved.
import { STITCH } from '../lib/tokens';

// ─── Auto-scroll hook (touch-pause) ─────────────────────────────────
function useAutoScroll(speed = 0.4) {
  const scrollRef = useRef(null);
  const animRef = useRef(null);
  const isPaused = useRef(false);
  const resumeTimer = useRef(null);

  const tick = useCallback(() => {
    const el = scrollRef.current;
    if (el && !isPaused.current) {
      el.scrollLeft += speed;
      const half = el.scrollWidth / 2;
      if (el.scrollLeft >= half) el.scrollLeft -= half;
    }
    animRef.current = requestAnimationFrame(tick);
  }, [speed]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, [tick]);

  const pause = useCallback(() => {
    isPaused.current = true;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
  }, []);
  const resume = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => { isPaused.current = false; }, 3000);
  }, []);

  return { scrollRef, pause, resume };
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════
export default function HomeView() {
  const { lang, rtl, listings, goTab, startCamera, handleFile, viewItem } = useApp();
  // Local ref — sharing the context fileRef across components orphans the
  // input when another binder unmounts (FRONTEND-003)
  const uploadFileRef = useRef(null);

  // Build carousel from real listings only (FRONTEND-005: demo items removed),
  // tripled for seamless loop
  const carouselItems = listings.slice(0, 8);
  const allItems = [...carouselItems, ...carouselItems, ...carouselItems];

  const carousel = useAutoScroll(0.4);

  return (
    <div
      className="-mx-5 relative"
      dir={rtl ? 'rtl' : 'ltr'}
      style={{ background: STITCH.background, fontFamily: STITCH.FONT_BODY }}
    >
      <input
        ref={uploadFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
      />

      {/* ════ MAIN ════ */}
      <main
        className="flex-grow flex flex-col items-center relative overflow-hidden"
        style={{
          paddingTop: 'clamp(8px, 1.5vh, 20px)',
          paddingBottom: 'clamp(96px, 16vh, 140px)',
          paddingLeft: 'clamp(16px, 5vw, 24px)',
          paddingRight: 'clamp(16px, 5vw, 24px)',
        }}
      >

        {/* Ambient Decorative Glows — ported from HTML */}
        <div
          className="absolute top-1/4 -left-20 w-64 h-64 rounded-full pointer-events-none"
          style={{ background: 'rgba(111, 238, 225, 0.05)', filter: 'blur(100px)' }}
        />
        <div
          className="absolute bottom-1/4 -right-20 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: 'rgba(79, 209, 197, 0.05)', filter: 'blur(120px)' }}
        />

        {/* ═══ HERO / SCAN SECTION ═══ */}
        <div
          className="w-full max-w-md flex flex-col items-center text-center z-10"
          style={{ gap: 'clamp(14px, 2.2vh, 28px)' }}
        >

          {/* Title + subtitle */}
          <div className="flex flex-col items-center" style={{ gap: 'clamp(4px, 0.8vh, 8px)' }}>
            <h2
              className="font-extrabold tracking-tight leading-[1.05]"
              style={{
                fontSize: 'clamp(24px, 3.6vh, 36px)',
                fontFamily: STITCH.FONT_HEADLINE,
                color: STITCH.onSurface,
              }}
            >
              GetWorth AI
            </h2>
            <p
              className="font-medium leading-snug mx-auto"
              style={{
                fontSize: 'clamp(13px, 1.8vh, 16px)',
                maxWidth: 'clamp(240px, 70vw, 300px)',
                color: STITCH.onSurfaceVariant,
              }}
            >
              {lang === 'he'
                ? 'סרוק, הערך ומכור תוך שניות'
                : 'Scan, value, and sell instantly'}
            </p>
          </div>

          {/* PRIMARY ACTION: LARGE SCAN BUTTON */}
          <div className="relative group">
            {/* Ambient glow behind button */}
            <div
              className="absolute inset-0 rounded-full opacity-40 group-active:opacity-70 transition-opacity duration-700 pointer-events-none"
              style={{
                background: 'rgba(111, 238, 225, 0.20)',
                transform: 'scale(1.10)',
                filter: 'blur(40px)',
              }}
            />
            <button
              onClick={startCamera}
              className="relative rounded-full flex flex-col items-center justify-center active:scale-95 transition-transform duration-300"
              style={{
                width: 'clamp(120px, 22vh, 200px)',
                height: 'clamp(120px, 22vh, 200px)',
                gap: 'clamp(6px, 1vh, 10px)',
                background: STITCH.GRADIENT_PRIMARY,
                boxShadow: '0 20px 40px rgba(111, 238, 225, 0.25)',
              }}
              aria-label={lang === 'he' ? 'סרוק פריט' : 'Scan Item'}
            >
              {/* Inner icon circle */}
              <div
                className="rounded-full flex items-center justify-center"
                style={{
                  width: 'clamp(44px, 8vh, 72px)',
                  height: 'clamp(44px, 8vh, 72px)',
                  background: 'rgba(0, 55, 51, 0.10)',
                }}
              >
                <Camera
                  strokeWidth={2.25}
                  style={{
                    color: STITCH.onPrimary,
                    width: 'clamp(22px, 4vh, 36px)',
                    height: 'clamp(22px, 4vh, 36px)',
                  }}
                />
              </div>
              <span
                className="font-bold tracking-tight"
                style={{
                  fontSize: 'clamp(15px, 2.2vh, 20px)',
                  fontFamily: STITCH.FONT_HEADLINE,
                  color: STITCH.onPrimary,
                }}
              >
                {lang === 'he' ? 'סרוק פריט' : 'Scan Item'}
              </span>
            </button>
          </div>

          {/* SECONDARY ACTION: UPLOAD PILL */}
          <button
            onClick={() => uploadFileRef.current?.click()}
            className="rounded-full flex items-center gap-2.5 active:scale-[0.97] transition-all"
            style={{
              paddingLeft: 'clamp(18px, 5vw, 28px)',
              paddingRight: 'clamp(18px, 5vw, 28px)',
              paddingTop: 'clamp(8px, 1.2vh, 14px)',
              paddingBottom: 'clamp(8px, 1.2vh, 14px)',
              background: 'rgba(42, 42, 42, 0.80)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
            }}
          >
            <Upload className="w-4 h-4" style={{ color: STITCH.primary }} />
            <span
              className="font-semibold tracking-wide"
              style={{
                fontSize: 'clamp(12px, 1.6vh, 14px)',
                color: STITCH.primary,
              }}
            >
              {lang === 'he' ? 'העלה מהגלריה' : 'Upload from Gallery'}
            </span>
          </button>

        </div>

        {/* ═══ HOT ITEMS / LIVE LISTINGS SECTION — hidden until real listings exist ═══ */}
        {carouselItems.length > 0 && (
        <section
          className="w-full max-w-7xl mx-auto"
          style={{ marginTop: 'clamp(16px, 2.5vh, 36px)' }}
        >

          {/* Section Header */}
          <div className="flex items-center justify-between px-2 mb-6">
            <div className="relative" style={{ [rtl ? 'marginRight' : 'marginLeft']: '16px' }}>
              {/* Live pulse indicator dot — ported from ::before */}
              <div
                className="absolute top-[10px] w-1.5 h-1.5 rounded-full animate-pulse"
                style={{
                  [rtl ? 'right' : 'left']: '-12px',
                  background: STITCH.primary,
                  boxShadow: `0 0 8px ${STITCH.primary}`,
                }}
              />
              <h3
                className="font-bold text-xl"
                style={{ fontFamily: STITCH.FONT_HEADLINE, color: STITCH.onSurface }}
              >
                {lang === 'he' ? 'פריטים חמים' : 'Hot Items'}
              </h3>
              <p
                className="text-[10px] uppercase tracking-widest font-bold mt-0.5"
                style={{ color: STITCH.onSurfaceVariant }}
              >
                {lang === 'he' ? 'פעילות שוק חיה' : 'Live Marketplace activity'}
              </p>
            </div>
            <button
              onClick={() => goTab('browse')}
              className="text-sm font-semibold flex items-center gap-1 group/viewall"
              style={{ color: STITCH.primary }}
            >
              {lang === 'he' ? 'הצג הכל' : 'View All'}
              {rtl
                ? <ArrowLeft className="w-4 h-4 group-hover/viewall:-translate-x-1 transition-transform" />
                : <ArrowRight className="w-4 h-4 group-hover/viewall:translate-x-1 transition-transform" />
              }
            </button>
          </div>

          {/* Horizontal Carousel */}
          <div className="relative group">
            <div
              ref={carousel.scrollRef}
              className="flex overflow-x-auto gap-5 px-2 pb-8 scroll-smooth scrollbar-hide"
              onTouchStart={carousel.pause} onTouchEnd={carousel.resume}
              onMouseDown={carousel.pause} onMouseUp={carousel.resume} onMouseLeave={carousel.resume}
              style={{
                WebkitOverflowScrolling: 'touch',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
              }}
            >
              {allItems.map((item, i) => (
                <HotCard
                  key={`hot-${item.id}-${i}`}
                  item={item}
                  lang={lang}
                  onClick={() => viewItem(item)}
                />
              ))}
            </div>
          </div>
        </section>
        )}

      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// HOT CARD — faithful glass-panel port
// ═══════════════════════════════════════════════════════════════════════
function HotCard({ item, lang, onClick }) {
  // FRONTEND-009: badges and meta are REAL listing facts only. The mockup port
  // rotated fabricated states by card index — "HOT DEAL", "Trending now",
  // "12 bids active" — inventing bids and demand signals the platform does
  // not have. A marketplace that fakes activity loses the user's trust the
  // moment they notice.
  const isNew = item.created_at
    && (Date.now() - new Date(item.created_at).getTime()) < 7 * 86400000;

  return (
    <div
      onClick={onClick}
      className="min-w-[280px] rounded-2xl p-4 flex flex-col gap-4 relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform"
      style={{
        background: STITCH.GLASS_BG,
        backdropFilter: STITCH.GLASS_BLUR,
        WebkitBackdropFilter: STITCH.GLASS_BLUR,
        border: STITCH.GLASS_BORDER,
      }}
    >
      {/* Badge — only the real "newly listed" fact (created within 7 days) */}
      {isNew && (
        <div className="absolute top-3 right-3 z-10">
          <span
            className="text-[10px] font-bold px-2 py-1 rounded-full backdrop-blur-md"
            style={{
              background: 'rgba(111, 238, 225, 0.20)',
              color: STITCH.primary,
              border: '1px solid rgba(111, 238, 225, 0.20)',
            }}
          >
            {lang === 'he' ? 'חדש' : 'NEWLY LISTED'}
          </span>
        </div>
      )}

      {/* Image */}
      <div
        className="w-full h-40 rounded-xl overflow-hidden"
        style={{ background: STITCH.surfaceContainerHighest }}
      >
        {item.images?.[0] && (
          <img
            src={item.images[0]}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}
      </div>

      {/* Title + Price Row */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between items-start gap-2">
          <h4
            className="font-bold text-lg truncate flex-1"
            style={{ fontFamily: STITCH.FONT_HEADLINE, color: STITCH.onSurface }}
          >
            {lang === 'he' && item.title_hebrew ? item.title_hebrew : item.title}
          </h4>
          <span
            className="font-bold text-lg whitespace-nowrap"
            style={{ color: STITCH.primary }}
          >
            {formatPrice(item.price)}
          </span>
        </div>

        {/* Meta row — real facts only: condition, location, listing age */}
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-xs font-medium truncate" style={{ color: STITCH.onSurfaceVariant }}>
            {[
              item.condition ? getConditionLabel(item.condition, lang) : null,
              item.location || null,
              item.created_at ? timeAgo(item.created_at, { ago: lang === 'he' ? 'לפני' : 'ago' }) : null,
            ].filter(Boolean).join(' • ')}
          </p>
        </div>
      </div>
    </div>
  );
}