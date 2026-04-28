import React, { useEffect } from 'react';
import { Sparkles, Scan, Search, TrendingUp, Plus, Share2, RefreshCw, Zap, ZapOff, AlertTriangle, ArrowLeft, Check, Eye, Tag, Info, Camera, Upload, ChevronRight, Shield, Loader2, Rocket, Box, Database, MoreVertical, Barcode, TrendingUp as TrendingUpIcon, X, Keyboard } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { camLog } from '../contexts/AppContext';
import { Card, Btn, Badge, FadeIn } from '../components/ui';
import { formatPrice, isSerialEligible } from '../lib/utils';

// ═══════════════════════════════════════════════════════
// STITCH DESIGN TOKENS — ported from HTML tailwind.config
// ═══════════════════════════════════════════════════════
const STITCH = {
  background:              '#131313',
  primary:                 '#6FEEE1',
  primaryContainer:        '#4FD1C5',
  onPrimary:               '#003733',
  onSurface:               '#e5e2e1',
  onSurfaceVariant:        '#BBC9C7',
  surfaceContainerLowest:  '#0e0e0e',
  surfaceContainerLow:     '#1C1B1B',
  surfaceContainer:        '#201f1f',
  surfaceContainerHigh:    '#2A2A2A',
  surfaceContainerHighest: '#353534',
  outlineVariant:          '#3c4947',
  GRADIENT_PRIMARY: 'linear-gradient(135deg, #6FEEE1 0%, #4FD1C5 100%)',
  GLASS_BG:    'rgba(53, 53, 52, 0.6)',
  GLASS_BLUR:  'blur(24px)',
  FONT_HEADLINE: '"Manrope", system-ui, -apple-system, sans-serif',
  FONT_BODY:     '"Inter", system-ui, -apple-system, sans-serif',
};

// ═══════════════════════════════════════════════════════
// POPULAR BRANDS PER CATEGORY — for quick-select chips
// ═══════════════════════════════════════════════════════
const BRAND_SUGGESTIONS = {
  Electronics: ['Apple', 'Samsung', 'Sony', 'LG', 'Xiaomi', 'Huawei', 'Google', 'Dyson', 'JBL', 'Bose'],
  Smoking:     ['Amy Deluxe', 'Khalil Mamoon', 'Mya', 'Adalya', 'Al Fakher', 'Fumari'],
  Clothing:    ['Nike', 'Adidas', 'Zara', 'H&M', 'The North Face', 'New Balance', 'Puma'],
  Furniture:   ['IKEA', 'Natuzzi', 'Keter', 'Aminach', 'Hagit', 'BoConcept'],
  Sports:      ['Nike', 'Adidas', 'Under Armour', 'Puma', 'Reebok', 'Decathlon'],
  Toys:        ['LEGO', 'Playmobil', 'Fisher-Price', 'Mattel', 'Hasbro', 'Melissa & Doug'],
  Home:        ['Dyson', 'De\'Longhi', 'Kenwood', 'Philips', 'Breville', 'iRobot'],
  Beauty:      ['Dyson', 'GHD', 'Revlon', 'BaByliss', 'Braun', 'Philips'],
  Tools:       ['Bosch', 'Makita', 'DeWalt', 'Black+Decker', 'Milwaukee', 'Stanley'],
  Vehicles:    ['Micro', 'Xiaomi', 'Segway', 'Razor', 'iNokim'],
  Watches:     ['Casio', 'Seiko', 'Citizen', 'Orient', 'Tissot', 'Fossil', 'Apple'],
  Books:       [],
  Other:       [],
};

function getBrandSuggestions(category) {
  if (!category) return [];
  // Exact match first, then partial match
  if (BRAND_SUGGESTIONS[category]) return BRAND_SUGGESTIONS[category];
  const key = Object.keys(BRAND_SUGGESTIONS).find(k => category.toLowerCase().includes(k.toLowerCase()));
  return key ? BRAND_SUGGESTIONS[key] : [];
}

// ═══════════════════════════════════════════════════════
// CAMERA VIEW — with real torch toggle
// ═══════════════════════════════════════════════════════
export function CameraView() {
  const {
    videoRef, canvasRef, capture, stopCamera, showFlash,
    torchSupported, torchOn, toggleTorch, lang, rtl, releaseCamera,
    addPhotoMode,
  } = useApp();

  const [cameraReady, setCameraReady] = React.useState(false);

  // Inject Manrope + Inter fonts
  useEffect(() => {
    if (document.getElementById('stitch-fonts')) return;
    const link = document.createElement('link');
    link.id = 'stitch-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Inter:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    camLog(`CameraView mounted — videoRef=${!!video}`);
    if (!video) return;

    const checkReady = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        camLog(`cameraReady=true — ${video.videoWidth}×${video.videoHeight} rs=${video.readyState} srcObj=${!!video.srcObject}`);
        setCameraReady(true);
      }
    };

    checkReady();
    video.addEventListener('loadeddata', checkReady);
    video.addEventListener('playing', checkReady);

    const interval = setInterval(checkReady, 200);
    const timeout = setTimeout(() => {
      camLog(`5s timeout — srcObj=${!!video.srcObject} rs=${video.readyState}`);
      if (video.srcObject) setCameraReady(true); // only enable capture if stream actually exists
    }, 5000);

    return () => {
      camLog('CameraView unmounting — removing video listeners');
      video.removeEventListener('loadeddata', checkReady);
      video.removeEventListener('playing', checkReady);
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [videoRef]);

  useEffect(() => {
    return () => releaseCamera();
  }, [releaseCamera]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      style={{ background: STITCH.background, fontFamily: STITCH.FONT_BODY }}
      dir={rtl ? 'rtl' : 'ltr'}
    >
      {/* ═══ BACKGROUND: Live camera feed (slightly dimmed) ═══ */}
      <div className="fixed inset-0 z-0">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ filter: 'brightness(0.85)' }}
        />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-0" style={{ background: 'rgba(19, 19, 19, 0.35)', backdropFilter: 'blur(1px)' }} />
      </div>

      {/* Flash overlay on capture */}
      {showFlash && <div className="absolute inset-0 bg-white animate-flash z-[60]" />}

      {/* Radial vignette */}
      <div
        className="fixed inset-0 pointer-events-none z-10"
        style={{ background: 'radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.6) 100%)' }}
      />

      {/* ═══ SCANNER FRAME with corner brackets ═══ */}
      <div className="fixed inset-0 z-20 flex flex-col items-center justify-center pointer-events-none">
        <div
          className="relative aspect-square flex items-center justify-center"
          style={{
            width: '75vw',
            maxWidth: '28rem',
            border: '1.5px solid rgba(111, 238, 225, 0.30)',
            borderRadius: '1rem',
          }}
        >
          {/* Four corner brackets with pulse */}
          {[
            { pos: 'top-0 left-0', border: 'border-t-[3px] border-l-[3px] rounded-tl-xl' },
            { pos: 'top-0 right-0', border: 'border-t-[3px] border-r-[3px] rounded-tr-xl' },
            { pos: 'bottom-0 left-0', border: 'border-b-[3px] border-l-[3px] rounded-bl-xl' },
            { pos: 'bottom-0 right-0', border: 'border-b-[3px] border-r-[3px] rounded-br-xl' },
          ].map((c, i) => (
            <div
              key={i}
              className={`absolute ${c.pos} w-8 h-8 ${c.border} animate-pulse`}
              style={{ borderColor: STITCH.primary, animationDuration: '3s' }}
            />
          ))}

          {/* Center label */}
          <div className="text-center">
            <p
              className="font-bold tracking-widest text-xs uppercase mb-2"
              style={{ color: STITCH.primary, fontFamily: STITCH.FONT_HEADLINE }}
            >
              {addPhotoMode
                ? (lang === 'he' ? 'צלם תווית' : 'CAPTURE LABEL')
                : (lang === 'he' ? 'יישר פריט' : 'ALIGN ITEM')}
            </p>
            <p
              className="font-medium text-[10px] tracking-wide"
              style={{ color: STITCH.onSurfaceVariant }}
            >
              {addPhotoMode
                ? (lang === 'he' ? 'מקם את התווית או הלוגו' : 'Position the label or logo')
                : (lang === 'he' ? 'מקם את הפריט במסגרת' : 'Position the item within the frame')}
            </p>
          </div>
        </div>
      </div>

      {/* ═══ TOP BAR: back + flash ═══ */}
      <nav
        className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-6 bg-transparent"
        style={{
          paddingTop: 'max(env(safe-area-inset-top), 16px)',
          height: 'calc(max(env(safe-area-inset-top), 16px) + 56px)',
        }}
      >
        <button
          onClick={stopCamera}
          className="flex items-center gap-2 px-3 py-2 rounded-full transition-all active:scale-95"
          style={{
            background: 'rgba(19, 19, 19, 0.50)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
          }}
          aria-label={lang === 'he' ? 'חזור' : 'Back'}
        >
          {rtl
            ? <ChevronRight className="w-5 h-5" style={{ color: STITCH.onSurface }} />
            : <ArrowLeft className="w-5 h-5" style={{ color: STITCH.onSurface }} />
          }
          <span className="text-sm font-medium" style={{ color: STITCH.onSurface }}>
            {lang === 'he' ? 'חזור' : 'Back'}
          </span>
        </button>

        <div className="flex items-center gap-3">
          {torchSupported && (
            <button
              onClick={toggleTorch}
              className="w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-95"
              style={{
                background: torchOn
                  ? 'rgba(111, 238, 225, 0.20)'
                  : 'rgba(19, 19, 19, 0.40)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                border: torchOn ? `1px solid ${STITCH.primary}` : 'none',
              }}
              aria-label={torchOn ? (lang === 'he' ? 'כבה פלאש' : 'Flash off') : (lang === 'he' ? 'הדלק פלאש' : 'Flash on')}
            >
              {torchOn
                ? <Zap className="w-5 h-5" style={{ color: STITCH.primary }} />
                : <ZapOff className="w-5 h-5" style={{ color: STITCH.onSurface }} />
              }
            </button>
          )}
        </div>
      </nav>

      {/* ═══ BOTTOM PANEL: shutter ═══ */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 flex flex-col items-center"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom), 40px)',
          paddingTop: '48px',
          background: 'linear-gradient(to top, #131313 0%, rgba(19,19,19,0.85) 50%, transparent 100%)',
        }}
      >
        {/* Shutter button with outer ring */}
        <div className="relative flex items-center justify-center">
          <div
            className="absolute w-24 h-24 rounded-full pointer-events-none"
            style={{ border: '1.5px solid rgba(111, 238, 225, 0.20)', transform: 'scale(1.25)' }}
          />
          <button
            onClick={capture}
            disabled={!cameraReady}
            className="group relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90"
            style={{
              background: cameraReady ? STITCH.primaryContainer : STITCH.surfaceContainerHigh,
              boxShadow: cameraReady ? '0 0 30px rgba(111, 238, 225, 0.40)' : 'none',
              opacity: cameraReady ? 1 : 0.5,
            }}
            aria-label={lang === 'he' ? 'צלם' : 'Capture'}
          >
            <div
              className="absolute rounded-full"
              style={{ inset: '6px', border: '3px solid rgba(19, 19, 19, 0.20)' }}
            />
            {cameraReady ? (
              <Camera className="w-8 h-8 relative z-10" style={{ color: STITCH.onPrimary }} strokeWidth={2.5} />
            ) : (
              <div
                className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin relative z-10"
                style={{ borderColor: STITCH.onSurfaceVariant, borderTopColor: 'transparent' }}
              />
            )}
          </button>
        </div>
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ANALYZING VIEW — with pipeline progress
// ═══════════════════════════════════════════════════════
export function AnalyzingView() {
  const {
    lang, t, images, capturedImageRef, rtl,
    pipelineState, pipelineError,
    retryPipeline, cancelPipeline,
  } = useApp();

  const isError = pipelineState === 'compress_error' || pipelineState === 'analysis_error';
  const isCompressing = pipelineState === 'compressing';
  const isIdentifying = pipelineState === 'identifying';
  const isPricing = pipelineState === 'pricing';

  // ═══ ERROR STATE ═══
  if (isError) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6"
        style={{ background: STITCH.background, fontFamily: STITCH.FONT_BODY }}
        dir={rtl ? 'rtl' : 'ltr'}
      >
        {/* Captured image preview */}
        <div
          className="relative w-48 h-48 rounded-2xl overflow-hidden mb-8 opacity-60"
          style={{ background: STITCH.surfaceContainerLowest }}
        >
          {(capturedImageRef.current || images[0]) && (
            <img src={capturedImageRef.current || images[0]} className="w-full h-full object-cover" alt="" />
          )}
          <div className="absolute inset-0" style={{ background: 'rgba(127, 29, 29, 0.30)' }} />
        </div>

        <div className="text-center space-y-4 max-w-xs">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
            style={{ background: 'rgba(255, 180, 171, 0.15)' }}
          >
            <AlertTriangle className="w-8 h-8" style={{ color: '#ffb4ab' }} />
          </div>

          <h3 className="text-xl font-bold" style={{ fontFamily: STITCH.FONT_HEADLINE, color: STITCH.onSurface }}>
            {pipelineState === 'compress_error'
              ? (lang === 'he' ? 'שגיאה בעיבוד התמונה' : 'Image Processing Failed')
              : (lang === 'he' ? 'שגיאה בניתוח' : 'Analysis Failed')
            }
          </h3>

          <p className="text-sm" style={{ color: STITCH.onSurfaceVariant }}>
            {pipelineError || (lang === 'he' ? 'משהו השתבש, נסה שוב' : 'Something went wrong, please try again')}
          </p>

          <div className="flex gap-3 pt-2">
            <button
              onClick={cancelPipeline}
              className="flex-1 py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2"
              style={{
                background: STITCH.surfaceContainerHigh,
                color: STITCH.onSurfaceVariant,
                border: '1px solid rgba(255, 255, 255, 0.05)',
              }}
            >
              {rtl ? <ArrowLeft className="w-4 h-4 rotate-180" /> : <ArrowLeft className="w-4 h-4" />}
              {lang === 'he' ? 'חזור' : 'Back'}
            </button>
            <button
              onClick={retryPipeline}
              className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 active:scale-[0.97]"
              style={{
                background: STITCH.GRADIENT_PRIMARY,
                color: STITCH.onPrimary,
                boxShadow: '0 10px 25px rgba(111, 238, 225, 0.25)',
              }}
            >
              <RefreshCw className="w-4 h-4" />
              {lang === 'he' ? 'נסה שוב' : 'Retry'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══ ANALYZING STATE ═══
  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      style={{ background: STITCH.background, fontFamily: STITCH.FONT_BODY }}
      dir={rtl ? 'rtl' : 'ltr'}
    >
      {/* Captured image as blurred background */}
      <div className="fixed inset-0 z-0">
        {(capturedImageRef.current || images[0]) && (
          <img
            src={capturedImageRef.current || images[0]}
            className="w-full h-full object-cover"
            alt=""
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            backdropFilter: 'blur(40px) brightness(0.4)',
            WebkitBackdropFilter: 'blur(40px) brightness(0.4)',
            background: 'rgba(19, 19, 19, 0.55)',
          }}
        />
      </div>

      {/* ═══ TOP BAR: back arrow + Marketplace + AI ACTIVE ═══ */}
      <header
        className="sticky top-0 w-full z-50"
        style={{
          background: 'rgba(19, 19, 19, 0.60)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
      >
        <div className="flex items-center justify-between px-6 h-16 max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <button onClick={cancelPipeline} className="active:scale-95 transition-all hover:opacity-80">
              {rtl
                ? <ChevronRight className="w-6 h-6" style={{ color: STITCH.primary }} />
                : <ArrowLeft className="w-6 h-6" style={{ color: STITCH.primary }} />
              }
            </button>
            <h1
              className="text-lg font-semibold tracking-tight"
              style={{ fontFamily: STITCH.FONT_HEADLINE, color: STITCH.primary }}
            >
              {lang === 'he' ? 'שוק' : 'Marketplace'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: STITCH.primary }} />
            <span className="text-[10px] font-medium tracking-widest uppercase" style={{ color: STITCH.onSurfaceVariant }}>
              {lang === 'he' ? 'AI פעיל' : 'AI Active'}
            </span>
          </div>
        </div>
      </header>

      {/* ═══ MAIN SCANNING CANVAS ═══ */}
      <main className="relative z-10 flex flex-col items-center justify-center px-6" style={{ minHeight: 'calc(100vh - 128px)' }}>
        {/* Scanning frame — item photo fills the box */}
        <div className="relative w-full max-w-md aspect-square flex items-center justify-center">
          {/* ── Item photo layer — fills and clips to rounded box ── */}
          <div className="absolute inset-0 rounded-2xl overflow-hidden z-0">
            {(capturedImageRef.current || images[0]) ? (
              <>
                <img
                  src={capturedImageRef.current || images[0]}
                  className="w-full h-full object-cover"
                  alt=""
                />
                {/* Subtle overlay so teal rings/line remain readable */}
                <div
                  className="absolute inset-0"
                  style={{ background: 'rgba(6, 10, 20, 0.48)' }}
                />
              </>
            ) : (
              <div className="w-full h-full" style={{ background: STITCH.surfaceContainerLow }} />
            )}
          </div>

          {/* Outer frame — slightly brighter to frame the photo */}
          <div
            className="absolute inset-0 rounded-2xl z-10"
            style={{ border: '1px solid rgba(111, 238, 225, 0.28)' }}
          />

          {/* Pulse rings */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div
              className="w-64 h-64 rounded-full stitch-pulse-ring"
              style={{ border: `2px solid rgba(111, 238, 225, 0.35)` }}
            />
            <div
              className="absolute w-48 h-48 rounded-full stitch-pulse-ring"
              style={{ border: `1px solid rgba(111, 238, 225, 0.55)`, animationDelay: '1.3s' }}
            />
            <div
              className="absolute w-32 h-32 rounded-full stitch-pulse-ring"
              style={{ border: `1px solid rgba(111, 238, 225, 0.45)`, animationDelay: '2.6s' }}
            />
          </div>


          {/* Horizontal scan line — sweeps vertically */}
          <div
            className="absolute left-0 right-0 z-20 pointer-events-none stitch-scan-sweep"
            style={{
              height: '2px',
              background: `linear-gradient(90deg, transparent, ${STITCH.primary}, transparent)`,
              boxShadow: `0 0 20px 2px ${STITCH.primary}`,
            }}
          />

          {/* Keyframes injected inline — guaranteed to run regardless of global CSS */}
          <style>{`
            @keyframes stitchPulseRing {
              0%   { transform: scale(0.85); opacity: 0.00; }
              30%  { opacity: 0.70; }
              100% { transform: scale(1.35); opacity: 0.00; }
            }
            .stitch-pulse-ring {
              animation: stitchPulseRing 3.6s cubic-bezier(0.4, 0, 0.6, 1) infinite;
            }
            @keyframes stitchBreathe {
              0%, 100% {
                box-shadow: 0 0 30px rgba(111, 238, 225, 0.15), inset 0 0 20px rgba(111, 238, 225, 0.05);
                transform: scale(1);
              }
              50% {
                box-shadow: 0 0 60px rgba(111, 238, 225, 0.35), inset 0 0 30px rgba(111, 238, 225, 0.10);
                transform: scale(1.04);
              }
            }
            .stitch-breathe {
              animation: stitchBreathe 2.4s ease-in-out infinite;
            }
            @keyframes stitchScanSweep {
              0%   { top: 15%; opacity: 0; }
              10%  { opacity: 1; }
              90%  { opacity: 1; }
              100% { top: 85%; opacity: 0; }
            }
            .stitch-scan-sweep {
              animation: stitchScanSweep 2.8s ease-in-out infinite;
            }
          `}</style>

          {/* Floating chip: Texture Map (top-left) */}
          <div
            className="absolute top-12 left-0 p-3 rounded-2xl flex items-center gap-3"
            style={{
              background: STITCH.GLASS_BG,
              backdropFilter: STITCH.GLASS_BLUR,
              WebkitBackdropFilter: STITCH.GLASS_BLUR,
              border: '1px solid rgba(111, 238, 225, 0.10)',
            }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(111, 238, 225, 0.10)' }}
            >
              <Sparkles className="w-4 h-4" style={{ color: STITCH.primary }} />
            </div>
            <div>
              <div className="text-[10px] leading-none uppercase tracking-tighter" style={{ color: STITCH.onSurfaceVariant }}>
                {lang === 'he' ? 'טקסטורה' : 'Texture Map'}
              </div>
              <div className="text-xs font-semibold" style={{ color: STITCH.primary }}>
                {(isCompressing || isIdentifying)
                  ? (lang === 'he' ? 'מנתח...' : 'ANALYZING...')
                  : (lang === 'he' ? 'הושלם' : 'COMPLETE')
                }
              </div>
            </div>
          </div>

          {/* Floating chip: Database (bottom-right) */}
          <div
            className="absolute bottom-12 right-0 p-3 rounded-2xl flex items-center gap-3"
            style={{
              background: STITCH.GLASS_BG,
              backdropFilter: STITCH.GLASS_BLUR,
              WebkitBackdropFilter: STITCH.GLASS_BLUR,
              border: '1px solid rgba(111, 238, 225, 0.10)',
            }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(111, 238, 225, 0.10)' }}
            >
              <Database className="w-4 h-4" style={{ color: STITCH.primary }} />
            </div>
            <div>
              <div className="text-[10px] leading-none uppercase tracking-tighter" style={{ color: STITCH.onSurfaceVariant }}>
                {lang === 'he' ? 'מסד נתונים' : 'Database'}
              </div>
              <div className="text-xs font-semibold" style={{ color: STITCH.primary }}>
                {isPricing
                  ? (lang === 'he' ? 'מתמחר...' : 'PRICING...')
                  : (lang === 'he' ? 'מחפש...' : 'MATCHING...')
                }
              </div>
            </div>
          </div>

          {/* Multi-photo indicator */}
          {images.length > 1 && (
            <div
              className="absolute -bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold shadow-lg"
              style={{ background: STITCH.primary, color: STITCH.onPrimary }}
            >
              {images.length} {lang === 'he' ? 'תמונות' : 'photos'}
            </div>
          )}
        </div>

        {/* ═══ STATUS + STEPPER ═══ */}
        <div className="mt-12 w-full max-w-sm flex flex-col items-center gap-8">
          {/* Editorial status */}
          <div className="text-center">
            <h2
              className="text-2xl font-bold mb-2"
              style={{ fontFamily: STITCH.FONT_HEADLINE, color: STITCH.onSurface }}
            >
              {isCompressing
                ? (lang === 'he' ? 'מעבד תמונה...' : 'Processing image...')
                : isPricing
                ? (lang === 'he' ? 'מעריך מחיר...' : 'Estimating price...')
                : (lang === 'he' ? 'מזהה פריט...' : 'Identifying item...')
              }
            </h2>
            <p className="text-sm" style={{ color: STITCH.onSurfaceVariant }}>
              {isCompressing
                ? (lang === 'he' ? 'מכווץ ומכין את התמונה' : 'Compressing and preparing your image')
                : isPricing
                ? (lang === 'he' ? 'בודק מחירים בשוק הישראלי' : 'Checking Israeli market prices')
                : (lang === 'he' ? 'הרשת הנוירונית מצליבה מיליוני מודעות' : 'Our neural network is cross-referencing millions of marketplace listings.')
              }
            </p>
          </div>

          {/* Stepper — 3 dashes */}
          <div className="flex gap-4 items-center">
            {/* Processing */}
            <div className="flex flex-col items-center gap-2" style={{ opacity: isCompressing || isIdentifying || isPricing ? 1 : 0.3 }}>
              <div className="w-12 h-1 rounded-full" style={{ background: STITCH.primary }} />
              <span className="text-[10px] font-medium" style={{ color: STITCH.primary }}>
                {lang === 'he' ? 'עיבוד' : 'Processing'}
              </span>
            </div>
            {/* Identifying */}
            <div className="flex flex-col items-center gap-2" style={{ opacity: isIdentifying || isPricing ? 1 : 0.3 }}>
              <div
                className="w-12 h-1 rounded-full relative overflow-hidden"
                style={{ background: isIdentifying || isPricing ? STITCH.primary : STITCH.onSurfaceVariant }}
              >
                {isIdentifying && (
                  <div
                    className="absolute inset-0 animate-pulse"
                    style={{ background: 'rgba(255, 255, 255, 0.30)', animationDuration: '2s' }}
                  />
                )}
              </div>
              <span
                className="text-[10px] font-medium"
                style={{ color: isIdentifying || isPricing ? STITCH.primary : STITCH.onSurfaceVariant }}
              >
                {lang === 'he' ? 'זיהוי' : 'Identifying'}
              </span>
            </div>
            {/* Pricing */}
            <div className="flex flex-col items-center gap-2" style={{ opacity: isPricing ? 1 : 0.3 }}>
              <div
                className="w-12 h-1 rounded-full relative overflow-hidden"
                style={{ background: isPricing ? STITCH.primary : STITCH.onSurfaceVariant }}
              >
                {isPricing && (
                  <div
                    className="absolute inset-0 animate-pulse"
                    style={{ background: 'rgba(255, 255, 255, 0.30)', animationDuration: '2s' }}
                  />
                )}
              </div>
              <span
                className="text-[10px] font-medium"
                style={{ color: isPricing ? STITCH.primary : STITCH.onSurfaceVariant }}
              >
                {lang === 'he' ? 'תמחור' : 'Pricing'}
              </span>
            </div>
          </div>

          {/* Cancel */}
          <button
            onClick={cancelPipeline}
            className="text-xs transition-colors"
            style={{ color: STITCH.onSurfaceVariant }}
          >
            {lang === 'he' ? 'ביטול' : 'Cancel'}
          </button>
        </div>
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// CONFIDENCE TIER HELPERS
// ═══════════════════════════════════════════════════════

function getConfidenceTier(confidence) {
  if (confidence >= 0.80) return 'high';
  if (confidence >= 0.60) return 'moderate';
  if (confidence >= 0.40) return 'low';
  return 'very_low';
}

function getConfidenceStyles(tier) {
  switch (tier) {
    case 'high':
      return { color: 'text-green-400', barColor: 'bg-green-500', badgeBg: 'bg-green-500/20 text-green-300', gradient: 'linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.02))' };
    case 'moderate':
      return { color: 'text-amber-400', barColor: 'bg-amber-500', badgeBg: 'bg-amber-500/20 text-amber-300', gradient: 'linear-gradient(135deg, rgba(251,191,36,0.1), rgba(251,191,36,0.02))' };
    case 'low':
      return { color: 'text-orange-400', barColor: 'bg-orange-500', badgeBg: 'bg-orange-500/20 text-orange-300', gradient: 'linear-gradient(135deg, rgba(249,115,22,0.1), rgba(249,115,22,0.02))' };
    case 'very_low':
    default:
      return { color: 'text-red-400', barColor: 'bg-red-500', badgeBg: 'bg-red-500/20 text-red-300', gradient: 'linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.02))' };
  }
}

function getConfidenceLabel(tier, lang) {
  const labels = {
    high:     { en: 'High confidence', he: 'ביטחון גבוה' },
    moderate: { en: 'Verify identification', he: 'אמת את הזיהוי' },
    low:      { en: 'Low confidence', he: 'ביטחון נמוך' },
    very_low: { en: 'Rough estimate', he: 'הערכה גסה' },
  };
  return labels[tier]?.[lang === 'he' ? 'he' : 'en'] || labels.moderate.en;
}

// ═══════════════════════════════════════════════════════
// HELP IDENTIFY MODAL — brand picker + text input + photo
// ═══════════════════════════════════════════════════════
function HelpIdentifyModal() {
  const {
    lang, result, images,
    helpModalOpen, setHelpModalOpen,
    addPhoto, submitBrandHint, handleAdditionalFile,
    fileRef,
  } = useApp();

  const [brandInput, setBrandInput] = React.useState('');
  const [showAllBrands, setShowAllBrands] = React.useState(false);

  if (!helpModalOpen || !result) return null;

  const category = result.category || result.classification?.category || 'Other';
  const suggestions = getBrandSuggestions(category);
  const visibleSuggestions = showAllBrands ? suggestions : suggestions.slice(0, 6);
  const canAddPhoto = images.length < 3;

  const handleBrandChip = (brand) => {
    submitBrandHint(brand);
  };

  const handleSubmit = () => {
    if (brandInput.trim()) {
      submitBrandHint(brandInput.trim());
      setBrandInput('');
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleAdditionalFile(file);
      setHelpModalOpen(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setHelpModalOpen(false)}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg mx-4 mb-4 rounded-3xl overflow-hidden bg-[#0f1729] border border-white/10 shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div className="p-5 pb-3">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-lg font-bold">
              {lang === 'he' ? 'עזור לנו לזהות' : 'Help us identify'}
            </h3>
            <button onClick={() => setHelpModalOpen(false)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
          <p className="text-sm text-slate-400">
            {lang === 'he'
              ? `אנחנו רואים שזה ${result.nameHebrew || result.category} אבל לא הצלחנו לקרוא את המותג`
              : `We can see this is a ${result.name || result.category} but couldn't read the brand clearly`}
          </p>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Option 1: Photo of label */}
          {canAddPhoto && (
            <div>
              <p className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wider">
                {lang === 'he' ? 'אפשרות 1: צלם תווית' : 'Option 1: Photo of label'}
              </p>
              <div className="flex gap-2">
                <button onClick={() => { setHelpModalOpen(false); addPhoto('camera'); }}
                  className="flex-1 py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all active:scale-[0.97] hover:opacity-80"
                  style={{ background: 'rgba(111,238,225,0.1)', border: '1px solid rgba(111,238,225,0.25)', color: '#6FEEE1' }}>
                  <Camera className="w-4 h-4" />
                  {lang === 'he' ? 'צלם תווית' : 'Take photo'}
                </button>
                <button onClick={() => fileRef.current?.click()}
                  className="py-3 px-4 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-300 flex items-center justify-center gap-2 hover:bg-white/10 transition-all">
                  <Upload className="w-4 h-4" />
                  {lang === 'he' ? 'העלה' : 'Upload'}
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
              </div>
              <p className="text-[10px] text-slate-600 mt-1.5">
                {lang === 'he'
                  ? `${images.length}/3 תמונות — צלם את התווית, הלוגו או מספר הדגם`
                  : `${images.length}/3 photos — capture the label, logo, or model number`}
              </p>
            </div>
          )}

          {/* Option 2: Brand quick-select */}
          {suggestions.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wider">
                {lang === 'he' ? 'אפשרות 2: בחר מותג' : 'Option 2: Select brand'}
              </p>
              <div className="flex flex-wrap gap-2">
                {visibleSuggestions.map((brand) => (
                  <button key={brand} onClick={() => handleBrandChip(brand)}
                    className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/15 hover:border-[#6FEEE1]/30 transition-all active:scale-95">
                    {brand}
                  </button>
                ))}
                {suggestions.length > 6 && !showAllBrands && (
                  <button onClick={() => setShowAllBrands(true)}
                    className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-slate-500 hover:text-slate-300 transition-all">
                    +{suggestions.length - 6} {lang === 'he' ? 'עוד' : 'more'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Option 3: Type manually */}
          <div>
            <p className="text-xs text-slate-500 font-medium mb-2 uppercase tracking-wider">
              {suggestions.length > 0
                ? (lang === 'he' ? 'אפשרות 3: הקלד ידנית' : 'Option 3: Type manually')
                : (lang === 'he' ? 'הקלד מותג ודגם' : 'Type brand & model')}
            </p>
            <div className="flex gap-2">
              <input type="text" value={brandInput} onChange={(e) => setBrandInput(e.target.value)}
                placeholder={lang === 'he' ? 'מותג ודגם...' : 'Brand & model...'}
                className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm focus:border-[#6FEEE1]/50 transition-all"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              />
              <button onClick={handleSubmit} disabled={!brandInput.trim()}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-30 transition-all active:scale-95 hover:opacity-80"
                style={{ background: '#6FEEE1', color: '#003733' }}>
                {lang === 'he' ? 'עדכן' : 'Update'}
              </button>
            </div>
          </div>

          {/* Skip */}
          <button onClick={() => setHelpModalOpen(false)}
            className="w-full py-2.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
            {lang === 'he' ? 'דלג — הצג הערכה בלבד' : 'Skip — show estimate only'}
          </button>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════
// MULTI-PHOTO THUMBNAIL STRIP
// ═══════════════════════════════════════════════════════
function PhotoStrip({ images, canAdd, onAddPhoto, lang, activeIndex = 0, onSelect }) {
  if (images.length <= 1 && !canAdd) return null;

  return (
    <div className="flex items-center gap-2 px-1">
      {images.map((img, i) => (
        <button key={i} onClick={() => onSelect?.(i)}
          className={`relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 transition-all ${
            i === activeIndex
              ? 'border-2 border-[#6FEEE1] ring-2 ring-[#6FEEE1]/30 scale-105'
              : 'border-2 border-white/20 opacity-60 hover:opacity-90'
          }`}>
          <img src={img} className="w-full h-full object-cover" alt={`Photo ${i + 1}`} />
          <div className="absolute bottom-0 right-0 bg-black/60 text-[8px] text-white px-1 rounded-tl">
            {i + 1}
          </div>
        </button>
      ))}
      {canAdd && (
        <button onClick={onAddPhoto}
          className="w-14 h-14 rounded-xl border-2 border-dashed border-white/20 flex items-center justify-center hover:border-[#6FEEE1]/50 hover:bg-[#6FEEE1]/10 transition-all flex-shrink-0">
          <Plus className="w-5 h-5 text-slate-500" />
        </button>
      )}
      {images.length > 1 && (
        <span className="text-[10px] text-slate-500 ml-1">
          {images.length}/3 {lang === 'he' ? 'תמונות' : 'photos'}
        </span>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════
// RESULTS VIEW — confidence-tiered UI + multi-photo + help
// ═══════════════════════════════════════════════════════
export function ResultsView() {
  const {
    lang, t, images, result, startListing, reset,
    refineResult, confirmResult, correctResult,
    addPhoto, setHelpModalOpen, helpModalOpen, fileRef,
    handleAdditionalFile,
    serialData, serialLoading, submitSerialPhoto, clearSerialData, submitSerialText,
  } = useApp();

  const [showCorrection, setShowCorrection] = React.useState(false);
  const [correctionInput, setCorrectionInput] = React.useState('');
  const [refining, setRefining] = React.useState(false);
  const [showDetails, setShowDetails] = React.useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = React.useState(0);
  const [serialTextMode, setSerialTextMode] = React.useState(false);
  const [serialTextValue, setSerialTextValue] = React.useState('');
  const addPhotoFileRef = React.useRef(null);
  const serialFileRef = React.useRef(null);

  // Auto-select newest photo when images array grows; clamp if shrinks
  React.useEffect(() => {
    if (images.length > 0) {
      setActivePhotoIndex(images.length - 1);
    } else {
      setActivePhotoIndex(0);
    }
  }, [images.length]);

  if (!result) return null;

  const confidence = result.confidence || 0;
  const confidencePercent = Math.round(confidence * 100);
  const recognition = result.recognition || {};
  const alternatives = recognition.alternatives || [];
  const isConfirmed = result.userConfirmed;

  // Confidence tier system
  const tier = getConfidenceTier(confidence);
  const styles = getConfidenceStyles(tier);
  const needsConfirmation = result.needsConfirmation && !isConfirmed;

  // Structured data from improved pipeline
  const identification = result.identification || {};
  const ocr = result.ocr || {};
  const classification = result.classification || {};
  const confidenceReasoning = result.confidence_reasoning || '';
  const priceMethod = result.marketValue?.price_method || '';
  const brandConf = classification.brand_confidence || recognition.brandConfidence || 'unidentified';

  // Multi-photo
  const canAddPhoto = images.length < 3 && !isConfirmed;

  // Serial eligibility — resolve from multiple possible field locations
  const resolvedSubcategory = classification.subcategory || result.subcategory || '';
  const resolvedName = result.name || result.nameHebrew || identification.generic_name || '';

  const handleSelectAlternative = async (alt) => {
    setRefining(true);
    await refineResult(alt.name);
    setRefining(false);
  };

  const handleSubmitCorrection = async () => {
    if (!correctionInput.trim()) return;
    setRefining(true);
    setShowCorrection(false);
    await correctResult(correctionInput.trim());
    setCorrectionInput('');
    setRefining(false);
  };

  const handleAddPhotoClick = () => {
    addPhoto('camera');
  };

  const handleAddPhotoFile = (e) => {
    const file = e.target.files?.[0];
    if (file) handleAdditionalFile(file);
  };

  if (refining) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4 animate-pulse" style={{ background: 'rgba(111,238,225,0.15)' }}>
          <Search className="w-6 h-6" style={{ color: '#6FEEE1' }} />
        </div>
        <p className="text-sm text-slate-400">{lang === 'he' ? 'מעדכן זיהוי ומחירים...' : 'Updating identification & prices...'}</p>
      </div>
    );
  }

  return (
    <div
      className="space-y-4 pb-4"
      style={{ fontFamily: STITCH.FONT_BODY, color: STITCH.onSurface }}
    >
      {/* Help modal */}
      <HelpIdentifyModal />

      {/* Hidden file input for add-photo from results */}
      <input ref={addPhotoFileRef} type="file" accept="image/*" className="hidden" onChange={handleAddPhotoFile} />

      {/* Item image + name — swipeable when multiple photos */}
      <FadeIn>
        <div
          className="relative rounded-2xl overflow-hidden"
          style={{ background: STITCH.surfaceContainerLowest }}
          onTouchStart={(e) => { e.currentTarget._touchX = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - (e.currentTarget._touchX || 0);
            if (Math.abs(dx) > 50 && images.length > 1) {
              if (dx < 0) setActivePhotoIndex(prev => Math.min(prev + 1, images.length - 1));
              else setActivePhotoIndex(prev => Math.max(prev - 1, 0));
            }
          }}>
          <div className="aspect-[4/5]">
            <img src={images[activePhotoIndex] || images[0]} className="w-full h-full object-cover" />
          </div>
          {/* AUTHENTICATED glass pill — only shown when high confidence */}
          {tier === 'high' && (
            <div
              className="absolute top-4 right-4 px-3 py-1.5 rounded-full flex items-center gap-2"
              style={{
                background: STITCH.GLASS_BG,
                backdropFilter: STITCH.GLASS_BLUR,
                WebkitBackdropFilter: STITCH.GLASS_BLUR,
              }}
            >
              <Check className="w-3.5 h-3.5" style={{ color: STITCH.primary }} strokeWidth={3} />
              <span
                className="text-xs font-medium uppercase tracking-widest"
                style={{ color: STITCH.primary }}
              >
                {lang === 'he' ? 'מאומת' : 'Authenticated'}
              </span>
            </div>
          )}
          {/* Photo counter dots — bottom center like Stitch */}
          {images.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
              {images.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActivePhotoIndex(i)}
                  className="rounded-full transition-all"
                  style={{
                    height: '4px',
                    width: i === activePhotoIndex ? '32px' : '6px',
                    background: i === activePhotoIndex ? STITCH.primary : 'rgba(187, 201, 199, 0.30)',
                  }}
                />
              ))}
            </div>
          )}
          {/* Category + confidence badges — top left, small overlay */}
          <div className="absolute top-4 left-4 flex items-center gap-2 flex-wrap">
            <Badge color="blue">{result.category}</Badge>
            {/* Multi-photo badge */}
            {images.length > 1 && (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold bg-purple-500/15 text-purple-400 backdrop-blur-md">
                <Camera className="w-2.5 h-2.5" />
                {images.length}
              </div>
            )}
            {/* Brand confidence indicator */}
            {brandConf === 'confirmed_by_text' && (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold bg-green-500/15 text-green-400 backdrop-blur-md">
                <Eye className="w-2.5 h-2.5" />
                OCR
              </div>
            )}
            {brandConf === 'inferred_from_visuals' && (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold backdrop-blur-md" style={{ background: 'rgba(111,238,225,0.12)', color: '#6FEEE1' }}>
                <Eye className="w-2.5 h-2.5" />
                {lang === 'he' ? 'חזותי' : 'Visual'}
              </div>
            )}
          </div>
        </div>
      </FadeIn>

      {/* Multi-photo thumbnail strip */}
      {(images.length > 1 || (canAddPhoto && confidence < 0.80)) && (
        <FadeIn delay={30}>
          <PhotoStrip
            images={images}
            canAdd={canAddPhoto}
            onAddPhoto={handleAddPhotoClick}
            lang={lang}
            activeIndex={activePhotoIndex}
            onSelect={setActivePhotoIndex}
          />
        </FadeIn>
      )}

      {/* ═══ STITCH ESTIMATED VALUE — centered editorial display ═══ */}
      <FadeIn delay={100}>
        <div className="text-center px-4">
          <h2
            className="text-base font-medium tracking-wide"
            style={{ fontFamily: STITCH.FONT_HEADLINE, color: STITCH.onSurfaceVariant }}
          >
            {tier === 'very_low'
              ? (lang === 'he' ? 'טווח מחירים משוער' : 'Estimated Price Range')
              : (lang === 'he' ? 'ערך משוער' : 'Estimated Value')}
          </h2>
          <div className="mt-1 flex items-baseline justify-center gap-1">
            <span
              className="text-5xl md:text-6xl font-extrabold tracking-tighter"
              style={{ fontFamily: STITCH.FONT_HEADLINE, color: STITCH.onSurface }}
            >
              {formatPrice(result.marketValue?.mid)}
            </span>
          </div>
          <p
            className="mt-4 text-2xl font-bold tracking-tight"
            style={{ fontFamily: STITCH.FONT_HEADLINE, color: STITCH.onSurface }}
          >
            {lang === 'he' && result.nameHebrew ? result.nameHebrew : result.name}
          </p>
          {(recognition.modelNumber || (identification.model && identification.model !== 'unidentified')) && (
            <p
              className="text-sm mt-1 uppercase tracking-[0.2em] font-medium"
              style={{ color: STITCH.onSurfaceVariant }}
            >
              {lang === 'he' ? 'דגם' : 'Ref.'} {recognition.modelNumber || identification.model}
            </p>
          )}
          {result.marketValue?.low > 0 && (
            <p className="text-sm mt-3" style={{ color: STITCH.onSurfaceVariant }}>
              {t.range}: {formatPrice(result.marketValue.low)} - {formatPrice(result.marketValue.high)}
            </p>
          )}
          {result.marketValue?.newRetailPrice > 0 && (
            <p className="text-[11px] mt-1.5" style={{ color: STITCH.onSurfaceVariant, opacity: 0.6 }}>
              {lang === 'he' ? 'מחיר חדש: ' : 'New retail: '}{formatPrice(result.marketValue.newRetailPrice)}
            </p>
          )}
          {priceMethod && (
            <p className="text-[10px] mt-1" style={{ color: STITCH.onSurfaceVariant, opacity: 0.5 }}>
              {priceMethod === 'comp_based'
                ? (lang === 'he' ? 'מבוסס על מחירי שוק' : 'Based on market data')
                : (lang === 'he' ? 'הערכת AI' : 'AI estimate')}
            </p>
          )}
        </div>
      </FadeIn>

      {/* ═══ STITCH CONFIDENCE SCORE CARD ═══ */}
      <FadeIn delay={50}>
        <div
          className="relative overflow-hidden rounded-2xl p-4"
          style={{ background: STITCH.surfaceContainerLow }}
        >
          <div className="flex justify-between items-end relative z-10">
            <div>
              <p
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: STITCH.onSurfaceVariant }}
              >
                {lang === 'he' ? 'ציון ביטחון' : 'Confidence Score'}
              </p>
              <p
                className="text-3xl font-bold mt-1"
                style={{ fontFamily: STITCH.FONT_HEADLINE, color: STITCH.primary }}
              >
                {confidencePercent}%
              </p>
              <p className={`text-[10px] font-medium mt-0.5 ${styles.color}`}>
                {getConfidenceLabel(tier, lang)}
              </p>
            </div>
            <div className="text-right">
              <p
                className="text-[10px] font-medium uppercase mb-2"
                style={{ color: STITCH.onSurfaceVariant }}
              >
                {lang === 'he' ? 'דיוק סריקה' : 'Scanning precision'}
              </p>
              {/* Bar visualizer — heights proportional to confidence */}
              <div className="flex gap-0.5 items-end">
                {[0.45, 0.70, 0.95, 0.55, 0.80, 1.0].map((h, i) => (
                  <div
                    key={i}
                    className={`w-1 rounded-full ${i === 5 ? 'animate-pulse' : ''}`}
                    style={{
                      height: `${Math.max(8, Math.round(h * confidencePercent * 0.4))}px`,
                      background: STITCH.primary,
                      animationDuration: '2s',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `linear-gradient(to right, rgba(111, 238, 225, 0.05), transparent)`,
            }}
          />
        </div>
      </FadeIn>

      {/* Confidence reasoning — more prominent for low/moderate confidence */}
      {confidenceReasoning && (
        <FadeIn delay={60}>
          <div className={`px-3 py-2.5 rounded-xl flex items-start gap-2 ${
            tier === 'high' ? '' : 'bg-white/[0.03] border border-white/5'
          }`}>
            <Info className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
              tier === 'high' ? 'text-slate-500' : tier === 'moderate' ? 'text-amber-400/70' : 'text-orange-400/70'
            }`} />
            <p className={`text-[11px] leading-relaxed ${
              tier === 'high' ? 'text-slate-500' : 'text-slate-400'
            }`}>{confidenceReasoning}</p>
          </div>
        </FadeIn>
      )}

      {/* ═══ STITCH ACTION GRID: Add Photo + Add Serial ═══ */}
      {/* Hidden file input for serial — kept with the grid for clarity */}
      <input
        ref={serialFileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => submitSerialPhoto(reader.result);
          reader.readAsDataURL(file);
          e.target.value = '';
        }}
      />

      {(() => {
        const serialEligible = isSerialEligible(result.category, resolvedSubcategory, resolvedName);
        const hasSerialData = !!(serialData?.serial || serialData?.type === 'submitted');
        const showPhotoButton = canAddPhoto; // images.length < 3 && !isConfirmed
        const showSerialButton = serialEligible;

        // If neither is available, render nothing
        if (!showPhotoButton && !showSerialButton) return null;

        const gridCols = showPhotoButton && showSerialButton ? 'grid-cols-2' : 'grid-cols-1';

        return (
          <FadeIn delay={65}>
            <div className={`grid ${gridCols} gap-4`}>
              {/* ─── ADD PHOTO BUTTON ─── */}
              {showPhotoButton && (
                <button
                  onClick={handleAddPhotoClick}
                  className="flex flex-col items-center justify-center gap-3 py-4 rounded-2xl active:scale-95 transition-all duration-200"
                  style={{
                    background: STITCH.surfaceContainerHigh,
                    border: '1px solid rgba(255, 255, 255, 0.03)',
                  }}
                >
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center"
                    style={{ background: STITCH.background, color: STITCH.primary }}
                  >
                    <Camera className="w-6 h-6" strokeWidth={2} />
                  </div>
                  <span
                    className="text-sm font-semibold"
                    style={{ color: STITCH.onSurface, fontFamily: STITCH.FONT_BODY }}
                  >
                    {lang === 'he' ? 'הוסף תמונה' : 'Add Photo'}
                  </span>
                </button>
              )}

              {/* ─── ADD SERIAL BUTTON (3 states: empty / loading / success) ─── */}
              {showSerialButton && (
                hasSerialData && serialData.serial ? (
                  /* SUCCESS STATE — masked serial displayed */
                  <button
                    onClick={clearSerialData}
                    className="flex flex-col items-center justify-center gap-2 py-4 rounded-2xl active:scale-95 transition-all duration-200 relative"
                    style={{
                      background: 'rgba(111, 238, 225, 0.08)',
                      border: '1px solid rgba(111, 238, 225, 0.25)',
                    }}
                    title={lang === 'he' ? 'הסר' : 'Remove'}
                  >
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center"
                      style={{ background: STITCH.background, color: STITCH.primary }}
                    >
                      <Shield className="w-6 h-6" strokeWidth={2} fill="currentColor" fillOpacity={0.15} />
                    </div>
                    <div className="text-center">
                      <span
                        className="block text-xs font-semibold"
                        style={{ color: STITCH.primary, fontFamily: STITCH.FONT_BODY }}
                      >
                        {serialData.type === 'imei' ? 'IMEI ✓' : (lang === 'he' ? 'מספר סידורי ✓' : 'Serial ✓')}
                      </span>
                      <span
                        className="block text-[10px] font-mono mt-0.5"
                        style={{ color: STITCH.onSurfaceVariant }}
                      >
                        {serialData.masked}
                      </span>
                    </div>
                    <X
                      className="absolute top-2 right-2 w-3.5 h-3.5"
                      style={{ color: STITCH.onSurfaceVariant }}
                    />
                  </button>
                ) : hasSerialData && serialData?.type === 'submitted' ? (
                  /* SUBMITTED STATE — photo saved but OCR couldn't extract */
                  <button
                    onClick={clearSerialData}
                    className="flex flex-col items-center justify-center gap-2 py-4 rounded-2xl active:scale-95 transition-all duration-200 relative"
                    style={{
                      background: STITCH.surfaceContainerHigh,
                      border: '1px solid rgba(255, 255, 255, 0.03)',
                    }}
                  >
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center"
                      style={{ background: STITCH.background, color: STITCH.onSurfaceVariant }}
                    >
                      <Shield className="w-6 h-6" strokeWidth={2} />
                    </div>
                    <div className="text-center">
                      <span
                        className="block text-xs font-semibold"
                        style={{ color: STITCH.onSurface, fontFamily: STITCH.FONT_BODY }}
                      >
                        {lang === 'he' ? 'תמונה נשמרה' : 'Photo saved'}
                      </span>
                      <span className="block text-[9px] mt-0.5" style={{ color: STITCH.onSurfaceVariant }}>
                        {lang === 'he' ? 'ללא זיהוי' : 'no serial found'}
                      </span>
                    </div>
                    <X
                      className="absolute top-2 right-2 w-3.5 h-3.5"
                      style={{ color: STITCH.onSurfaceVariant }}
                    />
                  </button>
                ) : serialTextMode ? (
                  /* TEXT INPUT STATE */
                  <div
                    className="flex flex-col gap-2 p-3 rounded-2xl"
                    style={{
                      background: STITCH.surfaceContainerHigh,
                      border: '1px solid rgba(111, 238, 225, 0.2)',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Barcode className="w-4 h-4 flex-shrink-0" style={{ color: STITCH.primary }} />
                      <input
                        autoFocus
                        type="text"
                        value={serialTextValue}
                        onChange={e => setSerialTextValue(e.target.value.toUpperCase())}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && serialTextValue.trim()) {
                            submitSerialText(serialTextValue);
                            setSerialTextMode(false);
                            setSerialTextValue('');
                          }
                          if (e.key === 'Escape') {
                            setSerialTextMode(false);
                            setSerialTextValue('');
                          }
                        }}
                        placeholder={lang === 'he' ? 'הזן מספר סידורי...' : 'Enter serial number...'}
                        className="flex-1 bg-transparent text-[13px] font-mono outline-none min-w-0 placeholder-slate-600"
                        style={{ color: STITCH.onSurface, caretColor: STITCH.primary }}
                      />
                      <button
                        onClick={() => { setSerialTextMode(false); setSerialTextValue(''); }}
                        style={{ color: STITCH.onSurfaceVariant }}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {serialTextValue.trim().length >= 5 && (
                      <button
                        onClick={() => {
                          submitSerialText(serialTextValue);
                          setSerialTextMode(false);
                          setSerialTextValue('');
                        }}
                        className="w-full py-1.5 rounded-xl text-xs font-semibold active:scale-95 transition-all"
                        style={{ background: STITCH.primary, color: STITCH.background }}
                      >
                        {lang === 'he' ? 'אמת' : 'Verify'}
                      </button>
                    )}
                  </div>
                ) : (
                  /* DEFAULT STATE — dual mode: Scan label + Type serial */
                  <div
                    className="flex flex-col items-center gap-2.5 py-3 rounded-2xl"
                    style={{
                      background: STITCH.surfaceContainerHigh,
                      border: '1px solid rgba(255, 255, 255, 0.03)',
                    }}
                  >
                    <span
                      className="text-[11px] font-medium"
                      style={{ color: STITCH.onSurfaceVariant, fontFamily: STITCH.FONT_BODY }}
                    >
                      {lang === 'he' ? 'הוסף מספר סידורי' : 'Add Serial'}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => !serialLoading && serialFileRef.current?.click()}
                        disabled={serialLoading}
                        className="flex flex-col items-center gap-1.5 px-4 py-2 rounded-xl active:scale-95 transition-all"
                        style={{
                          background: STITCH.background,
                          color: serialLoading ? STITCH.onSurfaceVariant : STITCH.primary,
                        }}
                      >
                        {serialLoading
                          ? <Loader2 className="w-5 h-5 animate-spin" strokeWidth={2} />
                          : <Camera className="w-5 h-5" strokeWidth={2} />
                        }
                        <span className="text-[10px] font-semibold">
                          {serialLoading
                            ? (lang === 'he' ? 'קורא...' : 'Reading...')
                            : (lang === 'he' ? 'סרוק' : 'Scan')
                          }
                        </span>
                      </button>
                      <button
                        onClick={() => setSerialTextMode(true)}
                        className="flex flex-col items-center gap-1.5 px-4 py-2 rounded-xl active:scale-95 transition-all"
                        style={{ background: STITCH.background, color: STITCH.onSurface }}
                      >
                        <Keyboard className="w-5 h-5" strokeWidth={2} />
                        <span className="text-[10px] font-semibold">
                          {lang === 'he' ? 'הקלד' : 'Type'}
                        </span>
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </FadeIn>
        );
      })()}

      {/* ═══ STITCH MARKET INSIGHT CARD ═══ */}
      {(() => {
        const insightText = result.israeliMarketNotes
          || result.sellingTips
          || (result.demandLevel === 'high'
            ? (lang === 'he'
              ? 'ביקוש גבוה בישראל. פריטים כאלה נמכרים בדרך כלל במהירות.'
              : 'High demand detected in your region. Items like this typically sell quickly.')
            : result.demandLevel === 'low'
            ? (lang === 'he'
              ? 'ביקוש נמוך. שקול מחיר תחרותי לזמן מכירה מהיר יותר.'
              : 'Lower demand for this category. Consider a competitive price for faster sale.')
            : (lang === 'he'
              ? 'ביקוש יציב. רשום במחיר המשוער לקבלת הצעות טובות.'
              : 'Steady demand. List at the estimated price for strong offers.')
          );

        if (!insightText) return null;

        return (
          <FadeIn delay={85}>
            <div
              className="p-5 rounded-2xl"
              style={{
                background: STITCH.surfaceContainerLowest,
                borderLeft: `4px solid rgba(111, 238, 225, 0.40)`,
              }}
            >
              <h3
                className="font-semibold text-sm mb-2"
                style={{ color: STITCH.onSurface, fontFamily: STITCH.FONT_BODY }}
              >
                {lang === 'he' ? 'תובנת שוק' : 'Market Insight'}
              </h3>
              <p
                className="text-sm leading-relaxed"
                style={{ color: STITCH.onSurfaceVariant }}
              >
                {insightText}
              </p>
            </div>
          </FadeIn>
        );
      })()}

      {/* Actions — Stitch gradient CTA */}
      <FadeIn delay={200}>
        <button
          onClick={startListing}
          className="w-full h-16 rounded-full flex items-center justify-center gap-3 font-extrabold text-lg active:scale-[0.97] transition-all"
          style={{
            background: STITCH.GRADIENT_PRIMARY,
            color: STITCH.onPrimary,
            fontFamily: STITCH.FONT_HEADLINE,
            boxShadow: '0 20px 40px rgba(111, 238, 225, 0.20)',
          }}
        >
          <span>{t.listItem}</span>
          <Rocket className="w-5 h-5" strokeWidth={2.5} />
        </button>
      </FadeIn>

      <FadeIn delay={300}>
        <button
          onClick={reset}
          className="w-full py-3 text-sm flex items-center justify-center gap-2 transition-colors"
          style={{ color: STITCH.onSurfaceVariant, fontFamily: STITCH.FONT_BODY }}
        >
          <RefreshCw className="w-4 h-4" />{t.scanAnother}
        </button>
      </FadeIn>

      {/* ═══ TIER: Very Low (<40%) — Broad estimate, need help ═══ */}
      {tier === 'very_low' && !isConfirmed && (
        <FadeIn delay={75}>
          <Card className="p-4 space-y-3" gradient={styles.gradient}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  {lang === 'he'
                    ? `זה נראה כמו ${identification.generic_name_hebrew || result.category}, אבל לא הצלחנו לזהות את המותג`
                    : `This looks like a ${identification.generic_name || result.category}, but we couldn't identify the brand`}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {lang === 'he' ? 'המחירים הם הערכה גסה — עזור לנו לדייק' : 'Prices are a rough estimate — help us be more accurate'}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <input type="text" value={correctionInput} onChange={(e) => setCorrectionInput(e.target.value)}
                placeholder={lang === 'he' ? 'הקלד מותג ודגם...' : 'Type brand & model...'}
                className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm focus:border-[#6FEEE1]/50 transition-all"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitCorrection(); }}
                autoFocus
              />
              <button onClick={handleSubmitCorrection} disabled={!correctionInput.trim()}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-30 transition-all" style={{ background: '#6FEEE1', color: '#003733' }}>
                {lang === 'he' ? 'עדכן' : 'Update'}
              </button>
            </div>

            {/* Brand quick-select chips */}
            {getBrandSuggestions(result.category).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {getBrandSuggestions(result.category).slice(0, 4).map((brand) => (
                  <button key={brand} onClick={() => { setCorrectionInput(brand); }}
                    className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] text-slate-400 hover:bg-white/10 hover:text-white transition-all">
                    {brand}
                  </button>
                ))}
                <button onClick={() => setHelpModalOpen(true)}
                  className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] hover:bg-[#6FEEE1]/10 transition-all" style={{ color: '#6FEEE1' }}>
                  {lang === 'he' ? 'עוד...' : 'More...'}
                </button>
              </div>
            )}

            <button onClick={confirmResult} className="w-full py-2 text-xs text-slate-500 hover:text-slate-300 transition-colors">
              {lang === 'he' ? 'דלג — הצג הערכה בלבד' : 'Skip — show estimate only'}
            </button>
          </Card>
        </FadeIn>
      )}

      {/* ═══ TIER: Low (40-59%) — Help needed ═══ */}
      {tier === 'low' && !isConfirmed && (
        <FadeIn delay={75}>
          <Card className="p-4 space-y-3" gradient={styles.gradient}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                <Search className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  {lang === 'he'
                    ? `אנחנו חושבים שזה ${result.nameHebrew || result.name} — נכון?`
                    : `We think this might be ${result.name} — is that right?`}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {lang === 'he' ? 'אשר או תקן לקבלת מחיר מדויק יותר' : 'Confirm or correct for more accurate pricing'}
                </p>
              </div>
            </div>

            <button onClick={confirmResult}
              className="w-full py-2.5 rounded-xl bg-green-600/20 border border-green-500/30 text-sm font-semibold text-green-300 flex items-center justify-center gap-2 hover:bg-green-600/30 transition-all">
              <Check className="w-4 h-4" />
              {lang === 'he' ? 'כן, זה נכון' : 'Yes, this is correct'}
            </button>

            {alternatives.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">{lang === 'he' ? 'או שזה...' : 'Or is it...'}</p>
                {alternatives.map((alt, i) => (
                  <button key={i} onClick={() => handleSelectAlternative(alt)}
                    className="w-full py-2.5 px-3 rounded-xl bg-white/5 border border-white/10 text-sm flex items-center justify-between hover:bg-white/10 transition-all">
                    <div className="text-left">
                      <span className="font-medium">{lang === 'he' && alt.nameHebrew ? alt.nameHebrew : alt.name}</span>
                      {alt.estimatedMid > 0 && <span className="text-xs text-slate-400 ml-2">~₪{alt.estimatedMid.toLocaleString()}</span>}
                    </div>
                    <span className="text-[10px] text-slate-500">{Math.round(alt.confidence * 100)}%</span>
                  </button>
                ))}
              </div>
            )}

            {!showCorrection ? (
              <div className="flex items-center gap-3">
                <button onClick={() => setShowCorrection(true)} className="text-xs transition-colors" style={{ color: '#6FEEE1' }}>
                  {lang === 'he' ? 'זה משהו אחר — הקלד ידנית' : 'Something else — type it manually'}
                </button>
                <span className="text-slate-700">|</span>
                <button onClick={() => setHelpModalOpen(true)} className="text-xs text-purple-400 hover:text-purple-300 transition-colors">
                  {lang === 'he' ? 'עזרה בזיהוי' : 'Help identify'}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input type="text" value={correctionInput} onChange={(e) => setCorrectionInput(e.target.value)}
                  placeholder={lang === 'he' ? 'הקלד שם המוצר...' : 'Type product name...'}
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:border-[#6FEEE1]/50 transition-all"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitCorrection(); }}
                  autoFocus
                />
                <button onClick={handleSubmitCorrection} disabled={!correctionInput.trim()}
                  className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-30 transition-all" style={{ background: '#6FEEE1', color: '#003733' }}>
                  {lang === 'he' ? 'עדכן' : 'Update'}
                </button>
              </div>
            )}
          </Card>
        </FadeIn>
      )}

      {/* ═══ TIER: Moderate (60-79%) — Soft confirmation ═══ */}
      {tier === 'moderate' && !isConfirmed && (
        <FadeIn delay={75}>
          <Card className="p-4 space-y-3" gradient={styles.gradient}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold">{lang === 'he' ? 'האם הזיהוי נכון?' : 'Is this identification correct?'}</p>
                <p className="text-xs text-slate-400 mt-0.5">{lang === 'he' ? 'בחר את המוצר הנכון לקבלת מחיר מדויק' : 'Confirm for accurate pricing'}</p>
              </div>
            </div>

            <button onClick={confirmResult}
              className="w-full py-2.5 rounded-xl bg-green-600/20 border border-green-500/30 text-sm font-semibold text-green-300 flex items-center justify-center gap-2 hover:bg-green-600/30 transition-all">
              <Check className="w-4 h-4" />
              {lang === 'he' ? 'כן, זה נכון' : 'Yes, this is correct'}
            </button>

            {alternatives.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">{lang === 'he' ? 'או שזה...' : 'Or is it...'}</p>
                {alternatives.map((alt, i) => (
                  <button key={i} onClick={() => handleSelectAlternative(alt)}
                    className="w-full py-2.5 px-3 rounded-xl bg-white/5 border border-white/10 text-sm flex items-center justify-between hover:bg-white/10 transition-all">
                    <div className="text-left">
                      <span className="font-medium">{lang === 'he' && alt.nameHebrew ? alt.nameHebrew : alt.name}</span>
                      {alt.estimatedMid > 0 && <span className="text-xs text-slate-400 ml-2">~₪{alt.estimatedMid.toLocaleString()}</span>}
                    </div>
                    <span className="text-[10px] text-slate-500">{Math.round(alt.confidence * 100)}%</span>
                  </button>
                ))}
              </div>
            )}

            {!showCorrection ? (
              <button onClick={() => setShowCorrection(true)} className="text-xs transition-colors" style={{ color: '#6FEEE1' }}>
                {lang === 'he' ? 'זה משהו אחר — הקלד ידנית' : 'Something else — type it manually'}
              </button>
            ) : (
              <div className="flex gap-2">
                <input type="text" value={correctionInput} onChange={(e) => setCorrectionInput(e.target.value)}
                  placeholder={lang === 'he' ? 'הקלד שם המוצר...' : 'Type product name...'}
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:border-[#6FEEE1]/50 transition-all"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitCorrection(); }}
                  autoFocus
                />
                <button onClick={handleSubmitCorrection} disabled={!correctionInput.trim()}
                  className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-30 transition-all" style={{ background: '#6FEEE1', color: '#003733' }}>
                  {lang === 'he' ? 'עדכן' : 'Update'}
                </button>
              </div>
            )}
          </Card>
        </FadeIn>
      )}

      {/* Confirmed badge */}
      {isConfirmed && (
        <FadeIn delay={50}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/10 border border-green-500/20">
            <Check className="w-4 h-4 text-green-400" />
            <span className="text-xs text-green-300 font-medium">{lang === 'he' ? 'הזיהוי אושר' : 'Identification confirmed'}</span>
          </div>
        </FadeIn>
      )}

      {/* OCR extracted text — pill tags */}
      {ocr.text_found && ocr.text_found.length > 0 && (
        <FadeIn delay={150}>
          <Card className="p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Tag className="w-3 h-3 text-slate-500" />
              <p className="text-[10px] text-slate-500 font-medium">{lang === 'he' ? 'טקסט שזוהה בתמונה' : 'Text detected in image'}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ocr.text_found.map((text, i) => (
                <span key={i} className="inline-block px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-xs text-slate-300 font-mono">
                  {text}
                </span>
              ))}
            </div>
            {ocr.logos_found && ocr.logos_found.length > 0 && (
              <p className="text-[10px] text-slate-500 mt-1.5">
                {lang === 'he' ? 'לוגו: ' : 'Logo: '}{ocr.logos_found.join(', ')}
              </p>
            )}
          </Card>
        </FadeIn>
      )}

      {/* Backward-compat: old OCR text fallback */}
      {!ocr.text_found?.length && recognition.ocrText && recognition.identifiedBy !== 'visual' && (
        <FadeIn delay={150}>
          <Card className="p-3">
            <p className="text-[10px] text-slate-500 mb-1">{lang === 'he' ? 'טקסט שזוהה בתמונה' : 'Text extracted from image'}</p>
            <p className="text-xs text-slate-300 font-mono break-all">{recognition.ocrText}</p>
          </Card>
        </FadeIn>
      )}

      {/* Expandable details */}
      {(result.details?.description || result.israeliMarketNotes || result.sellingTips) && (
        <FadeIn delay={175}>
          <button onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white/5 hover:bg-white/8 transition-all text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" />
              {lang === 'he' ? 'פרטים נוספים' : 'More details'}
            </span>
            <span className="text-[10px]">{showDetails ? '▲' : '▼'}</span>
          </button>
          {showDetails && (
            <Card className="p-3 space-y-2 mt-1">
              {result.details?.description && <p className="text-xs text-slate-300">{result.details.description}</p>}
              {result.sellingTips && (
                <div>
                  <p className="text-[10px] text-slate-500 mb-0.5">{lang === 'he' ? 'טיפ למכירה' : 'Selling tip'}</p>
                  <p className="text-xs text-slate-400">{result.sellingTips}</p>
                </div>
              )}
              {result.israeliMarketNotes && (
                <div>
                  <p className="text-[10px] text-slate-500 mb-0.5">{lang === 'he' ? 'שוק ישראלי' : 'Israeli market'}</p>
                  <p className="text-xs text-slate-400">{result.israeliMarketNotes}</p>
                </div>
              )}
              {result.priceFactors && result.priceFactors.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-500 mb-0.5">{lang === 'he' ? 'גורמי מחיר' : 'Price factors'}</p>
                  {result.priceFactors.map((pf, i) => (
                    <p key={i} className="text-xs text-slate-400">{pf.factor}: {pf.impact}</p>
                  ))}
                </div>
              )}
            </Card>
          )}
        </FadeIn>
      )}

    </div>
  );
}