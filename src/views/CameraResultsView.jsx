import React, { useEffect, useState, useCallback } from 'react';
import { X, Sparkles, Scan, Search, TrendingUp, Plus, Share2, RefreshCw, Zap, ZapOff, Sun } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, Badge, FadeIn } from '../components/ui';
import { formatPrice } from '../lib/utils';

// ─── Camera View with Flash/Torch ───
export function CameraView() {
  const { lang, videoRef, canvasRef, capture, stopCamera, showFlash } = useApp();
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [screenLight, setScreenLight] = useState(false);

  // Check if torch is supported on this device
  useEffect(() => {
    const checkTorch = async () => {
      try {
        const stream = videoRef.current?.srcObject;
        if (!stream) return;
        const track = stream.getVideoTracks()[0];
        if (!track) return;
        const capabilities = track.getCapabilities?.();
        if (capabilities?.torch) {
          setTorchSupported(true);
        }
      } catch (e) {
        console.warn('Torch check failed:', e);
      }
    };
    // Small delay to let camera stream initialize
    const timer = setTimeout(checkTorch, 500);
    return () => clearTimeout(timer);
  }, [videoRef]);

  // Clean up on unmount: turn off torch only — do NOT stop tracks
  // Stream lifecycle is owned by AppContext (cameraStreamRef), not this component
  useEffect(() => {
    return () => {
      // Only turn off torch, don't kill the stream
      if (torchOn && videoRef.current?.srcObject) {
        const track = videoRef.current.srcObject.getVideoTracks()[0];
        try { track?.applyConstraints({ advanced: [{ torch: false }] }); } catch(e) {}
      }
      setTorchOn(false);
      setScreenLight(false);
    };
  }, [videoRef, torchOn]);

  const toggleTorch = useCallback(async () => {
    try {
      const stream = videoRef.current?.srcObject;
      if (!stream) return;
      const track = stream.getVideoTracks()[0];
      if (!track) return;

      const newState = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: newState }] });
      setTorchOn(newState);
    } catch (e) {
      console.warn('Torch toggle failed:', e);
      // Fallback: use screen as light source
      setScreenLight(!screenLight);
    }
  }, [torchOn, videoRef, screenLight]);

  const toggleLight = useCallback(() => {
    if (torchSupported) {
      toggleTorch();
    } else {
      // iOS / unsupported: use bright screen as fill light
      setScreenLight(!screenLight);
    }
  }, [torchSupported, toggleTorch, screenLight]);

  const handleCapture = useCallback(() => {
    // If screen light is on, briefly flash even brighter
    capture();
  }, [capture]);

  const handleStop = useCallback(() => {
    // Turn off torch before closing
    if (torchOn && videoRef.current?.srcObject) {
      const track = videoRef.current.srcObject.getVideoTracks()[0];
      try { track?.applyConstraints({ advanced: [{ torch: false }] }); } catch(e) {}
    }
    setTorchOn(false);
    setScreenLight(false);
    stopCamera();
  }, [torchOn, videoRef, stopCamera]);

  const isLightOn = torchOn || screenLight;

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />
      
      {/* Screen flash on capture */}
      {showFlash && <div className="absolute inset-0 bg-white animate-flash z-50" />}

      {/* Screen light mode (iOS fallback) — acts as fill light */}
      {screenLight && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-[15%] bg-white/90" />
          <div className="absolute bottom-0 left-0 right-0 h-[15%] bg-white/90" />
          <div className="absolute top-[15%] left-0 w-[10%] bottom-[15%] bg-white/90" />
          <div className="absolute top-[15%] right-0 w-[10%] bottom-[15%] bg-white/90" />
        </div>
      )}
      
      {/* Scan frame overlay */}
      <div className="absolute inset-0 pointer-events-none z-20">
        <div className="absolute inset-8 rounded-3xl border-2 border-white/30" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }} />
        <div className="absolute top-10 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/50 backdrop-blur-sm text-sm text-white">
          {lang === 'he' ? 'מקם את הפריט במסגרת' : 'Position item in frame'}
        </div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-0 inset-x-0 p-8 z-30 bg-gradient-to-t from-black via-black/80 to-transparent">
        <div className="flex justify-center items-center gap-6">
          {/* Close button */}
          <button onClick={handleStop} className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center hover:bg-white/20 transition-all">
            <X className="w-6 h-6 text-white" />
          </button>

          {/* Capture button */}
          <button onClick={handleCapture} className="w-20 h-20 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 flex items-center justify-center shadow-xl shadow-blue-500/50 active:scale-95 transition-transform">
            <div className="w-16 h-16 rounded-full border-4 border-white/30" />
          </button>

          {/* Flash/Torch button */}
          <button onClick={toggleLight}
            className={`w-14 h-14 rounded-2xl backdrop-blur flex items-center justify-center transition-all ${isLightOn ? 'bg-yellow-500/80 shadow-lg shadow-yellow-500/50' : 'bg-white/10 hover:bg-white/20'}`}>
            {isLightOn
              ? <Zap className="w-6 h-6 text-yellow-900" />
              : <Zap className="w-6 h-6 text-white" />
            }
          </button>
        </div>

        {/* Flash mode label */}
        <div className="text-center mt-3">
          {isLightOn && (
            <span className="text-xs text-yellow-400 font-medium flex items-center justify-center gap-1">
              <Sun className="w-3 h-3" />
              {torchSupported 
                ? (lang === 'he' ? 'פלאש פועל' : 'Flash ON') 
                : (lang === 'he' ? 'תאורת מסך פועלת' : 'Screen light ON')
              }
            </span>
          )}
          {!isLightOn && (
            <span className="text-xs text-slate-500">
              {lang === 'he' ? 'לחץ ⚡ להפעלת פלאש' : 'Tap ⚡ for flash'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Analyzing View ───
export function AnalyzingView() {
  const { lang, t, images, capturedImageRef } = useApp();

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-10 min-h-[70vh]">
      <div className="relative">
        <div className="absolute -inset-12 bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-cyan-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -inset-8 bg-blue-500/10 rounded-full blur-2xl animate-ping" style={{ animationDuration: '2s' }} />
        <div className="absolute -inset-3 rounded-[2rem] bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 animate-spin-slow opacity-70" style={{ animationDuration: '3s' }} />
        <div className="absolute -inset-2.5 rounded-[1.8rem] bg-[#0a1020]" />
        
        <div className="relative w-56 h-56 rounded-3xl overflow-hidden shadow-2xl shadow-blue-500/40">
          {(capturedImageRef.current || images[0]) && (
            <img src={capturedImageRef.current || images[0]} className="w-full h-full object-cover" alt="Captured item" />
          )}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent animate-scan" />
          </div>
          <div className="absolute inset-0 pointer-events-none">
            {['top-2 left-2', 'top-2 right-2', 'bottom-2 left-2', 'bottom-2 right-2'].map((pos, i) => (
              <svg key={i} className={`absolute ${pos} w-6 h-6 text-blue-400`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={i < 2 ? (i === 0 ? 'M4 8V4h4M4 16v4h4' : 'M20 8V4h-4M20 16v4h-4') : (i === 2 ? 'M4 8V4h4M4 16v4h4' : 'M20 8V4h-4M20 16v4h-4')} />
              </svg>
            ))}
          </div>
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer-fast" />
        </div>
        
        <div className="absolute -inset-8 pointer-events-none">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="absolute w-2 h-2 rounded-full bg-blue-400 animate-float"
              style={{ left: `${20 + (i * 15)}%`, top: `${10 + (i % 3) * 30}%`, animationDelay: `${i * 0.3}s`, animationDuration: `${2 + (i % 2)}s` }} />
          ))}
        </div>
      </div>
      
      <div className="mt-10 text-center space-y-5">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30">
          <Sparkles className="w-4 h-4 text-blue-400 animate-pulse" />
          <span className="text-sm font-semibold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            {lang === 'he' ? 'AI מנתח' : 'AI Analyzing'}
          </span>
        </div>
        <div>
          <h3 className="text-xl font-bold text-white mb-1">{t.analyzing}</h3>
          <p className="text-sm text-slate-400">{lang === 'he' ? 'מזהה פריט וחוקר שוק...' : 'Identifying item & researching market...'}</p>
        </div>
        <div className="w-48 mx-auto">
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 rounded-full animate-progress" />
          </div>
        </div>
        <div className="flex items-center justify-center gap-6 text-xs text-slate-500">
          <div className="flex items-center gap-1.5 animate-pulse"><Scan className="w-3.5 h-3.5 text-blue-400" /><span>{lang === 'he' ? 'סריקה' : 'Scanning'}</span></div>
          <div className="flex items-center gap-1.5 animate-pulse" style={{ animationDelay: '0.5s' }}><Search className="w-3.5 h-3.5 text-purple-400" /><span>{lang === 'he' ? 'חיפוש' : 'Matching'}</span></div>
          <div className="flex items-center gap-1.5 animate-pulse" style={{ animationDelay: '1s' }}><TrendingUp className="w-3.5 h-3.5 text-cyan-400" /><span>{lang === 'he' ? 'הערכה' : 'Pricing'}</span></div>
        </div>
      </div>
    </div>
  );
}

// ─── Results View ───
export function ResultsView() {
  const { lang, t, images, result, startListing, reset } = useApp();

  if (!result) return null;

  return (
    <div className="space-y-5 pb-4">
      <FadeIn>
        <div className="relative rounded-3xl overflow-hidden shadow-2xl">
          <div className="aspect-[4/3]">
            <img src={images[0]} className="w-full h-full object-cover" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-5">
            <Badge color="blue">{result.category}</Badge>
            <h2 className="text-2xl font-bold mt-2">{lang === 'he' && result.nameHebrew ? result.nameHebrew : result.name}</h2>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={100}>
        <Card className="p-6 text-center" gradient="linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1))" glow>
          <p className="text-sm text-blue-300 font-medium mb-2">{t.marketValue}</p>
          <p className="text-5xl font-bold bg-gradient-to-r from-blue-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">
            {formatPrice(result.marketValue?.mid)}
          </p>
          {result.marketValue?.low > 0 && (
            <p className="text-sm text-slate-400 mt-3">{t.range}: {formatPrice(result.marketValue.low)} - {formatPrice(result.marketValue.high)}</p>
          )}
        </Card>
      </FadeIn>

      <FadeIn delay={200} className="flex gap-3">
        <Btn primary className="flex-1 py-4" onClick={startListing}><Plus className="w-5 h-5" />{t.listItem}</Btn>
        <Btn className="px-5"><Share2 className="w-5 h-5" /></Btn>
      </FadeIn>

      <FadeIn delay={300}>
        <button onClick={reset} className="w-full py-3 text-slate-400 text-sm flex items-center justify-center gap-2 hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />{t.scanAnother}
        </button>
      </FadeIn>
    </div>
  );
}
