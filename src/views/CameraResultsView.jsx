import React, { useEffect } from 'react';
import { X, Sparkles, Scan, Search, TrendingUp, Plus, Share2, RefreshCw, Zap, ZapOff, AlertTriangle, ArrowLeft, Check, Eye, Tag, Info, Camera, Upload, ChevronRight } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, Badge, FadeIn } from '../components/ui';
import { formatPrice } from '../lib/utils';

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
    torchSupported, torchOn, toggleTorch, lang, releaseCamera,
    addPhotoMode,
  } = useApp();

  const [cameraReady, setCameraReady] = React.useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const checkReady = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        setCameraReady(true);
      }
    };

    checkReady();
    video.addEventListener('loadeddata', checkReady);
    video.addEventListener('playing', checkReady);

    const interval = setInterval(checkReady, 200);
    const timeout = setTimeout(() => { setCameraReady(true); }, 5000);

    return () => {
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
    <div className="fixed inset-0 z-50 bg-black">
      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />
      
      {showFlash && <div className="absolute inset-0 bg-white animate-flash z-50" />}
      
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-8 rounded-3xl border-2 border-white/30" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }} />
        <div className="absolute top-10 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/50 backdrop-blur-sm text-sm text-white">
          {addPhotoMode
            ? (lang === 'he' ? 'צלם את התווית או הלוגו' : 'Take a photo of the label or logo')
            : (lang === 'he' ? 'מקם את הפריט במסגרת' : 'Position item in frame')
          }
        </div>
      </div>

      {/* Add-photo indicator */}
      {addPhotoMode && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-xs text-blue-300 flex items-center gap-1.5">
          <Camera className="w-3 h-3" />
          {lang === 'he' ? 'תמונה נוספת' : 'Additional photo'}
        </div>
      )}

      <div className="absolute bottom-0 inset-x-0 p-8 flex justify-center gap-6 bg-gradient-to-t from-black via-black/80 to-transparent">
        <button onClick={stopCamera} className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center hover:bg-white/20 transition-all">
          <X className="w-6 h-6 text-white" />
        </button>

        <button onClick={capture} disabled={!cameraReady}
          className={`w-20 h-20 rounded-full flex items-center justify-center shadow-xl active:scale-95 transition-all ${cameraReady ? 'bg-gradient-to-r from-blue-500 to-blue-600 shadow-blue-500/50' : 'bg-white/10 opacity-50'}`}>
          {cameraReady ? (
            <div className="w-16 h-16 rounded-full border-4 border-white/30" />
          ) : (
            <div className="w-6 h-6 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />
          )}
        </button>

        {torchSupported ? (
          <button
            onClick={toggleTorch}
            className={`w-14 h-14 rounded-2xl backdrop-blur flex items-center justify-center transition-all ${
              torchOn ? 'bg-yellow-500/30 border border-yellow-400/50' : 'bg-white/10 hover:bg-white/20'
            }`}
            title={torchOn ? (lang === 'he' ? 'כבה פלאש' : 'Turn off flash') : (lang === 'he' ? 'הדלק פלאש' : 'Turn on flash')}
          >
            {torchOn ? <Zap className="w-6 h-6 text-yellow-300" /> : <ZapOff className="w-6 h-6 text-white/70" />}
          </button>
        ) : (
          <div className="w-14 h-14" />
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ANALYZING VIEW — with pipeline progress
// ═══════════════════════════════════════════════════════
export function AnalyzingView() {
  const {
    lang, t, images, capturedImageRef,
    pipelineState, pipelineError,
    retryPipeline, cancelPipeline,
  } = useApp();

  const isError = pipelineState === 'compress_error' || pipelineState === 'analysis_error';
  const isCompressing = pipelineState === 'compressing';
  const isAnalyzing = pipelineState === 'analyzing';

  if (isError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-10 min-h-[70vh]">
        <div className="relative w-48 h-48 rounded-3xl overflow-hidden shadow-2xl mb-8 opacity-60">
          {(capturedImageRef.current || images[0]) && (
            <img src={capturedImageRef.current || images[0]} className="w-full h-full object-cover" alt="" />
          )}
          <div className="absolute inset-0 bg-red-900/30" />
        </div>

        <div className="text-center space-y-4 max-w-xs">
          <div className="w-16 h-16 rounded-2xl bg-red-500/20 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-8 h-8 text-red-400" />
          </div>

          <h3 className="text-xl font-bold text-white">
            {pipelineState === 'compress_error'
              ? (lang === 'he' ? 'שגיאה בעיבוד התמונה' : 'Image Processing Failed')
              : (lang === 'he' ? 'שגיאה בניתוח' : 'Analysis Failed')
            }
          </h3>

          <p className="text-sm text-slate-400">
            {pipelineError || (lang === 'he' ? 'משהו השתבש, נסה שוב' : 'Something went wrong, please try again')}
          </p>

          <div className="flex items-center justify-center gap-3 text-xs">
            <div className={`flex items-center gap-1.5 ${pipelineState === 'compress_error' ? 'text-red-400' : 'text-green-400'}`}>
              <div className={`w-2 h-2 rounded-full ${pipelineState === 'compress_error' ? 'bg-red-400' : 'bg-green-400'}`} />
              {lang === 'he' ? 'עיבוד' : 'Processing'}
            </div>
            <div className="w-4 h-px bg-slate-600" />
            <div className={`flex items-center gap-1.5 ${pipelineState === 'analysis_error' ? 'text-red-400' : 'text-slate-500'}`}>
              <div className={`w-2 h-2 rounded-full ${pipelineState === 'analysis_error' ? 'bg-red-400' : 'bg-slate-600'}`} />
              {lang === 'he' ? 'ניתוח AI' : 'AI Analysis'}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={cancelPipeline}
              className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all flex items-center justify-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              {lang === 'he' ? 'חזור' : 'Back'}
            </button>
            <button onClick={retryPipeline}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 hover:from-blue-500 hover:to-blue-400 transition-all flex items-center justify-center gap-2 active:scale-[0.97]">
              <RefreshCw className="w-4 h-4" />
              {lang === 'he' ? 'נסה שוב' : 'Retry'}
            </button>
          </div>
        </div>
      </div>
    );
  }

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

        {/* Multi-photo indicator */}
        {images.length > 1 && (
          <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-blue-600 text-xs font-bold text-white shadow-lg">
            {images.length} {lang === 'he' ? 'תמונות' : 'photos'}
          </div>
        )}
        
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
            {isCompressing
              ? (lang === 'he' ? 'מכין תמונה' : 'Preparing Image')
              : (lang === 'he' ? 'AI מנתח' : 'AI Analyzing')
            }
          </span>
        </div>
        <div>
          <h3 className="text-xl font-bold text-white mb-1">
            {isCompressing ? (lang === 'he' ? 'מעבד תמונה...' : 'Processing image...') : t.analyzing}
          </h3>
          <p className="text-sm text-slate-400">
            {isCompressing
              ? (lang === 'he' ? 'מכווץ ומכין לניתוח...' : 'Compressing and preparing...')
              : (lang === 'he' ? 'קורא טקסט, מזהה מותג ומעריך שווי...' : 'Reading text, identifying brand & estimating value...')
            }
          </p>
        </div>
        <div className="w-48 mx-auto">
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 rounded-full animate-progress" />
          </div>
        </div>

        <div className="flex items-center justify-center gap-6 text-xs text-slate-500">
          <div className={`flex items-center gap-1.5 ${isCompressing ? 'animate-pulse text-blue-400' : (isAnalyzing ? 'text-green-400' : 'text-slate-500')}`}>
            <div className={`w-2 h-2 rounded-full ${isCompressing ? 'bg-blue-400 animate-pulse' : (isAnalyzing ? 'bg-green-400' : 'bg-slate-600')}`} />
            <Scan className="w-3.5 h-3.5" />
            <span>{lang === 'he' ? 'עיבוד' : 'Processing'}</span>
          </div>
          <div className={`flex items-center gap-1.5 ${isAnalyzing ? 'animate-pulse text-blue-400' : 'text-slate-500'}`}>
            <div className={`w-2 h-2 rounded-full ${isAnalyzing ? 'bg-blue-400 animate-pulse' : 'bg-slate-600'}`} />
            <Search className="w-3.5 h-3.5" />
            <span>{lang === 'he' ? 'זיהוי' : 'Identifying'}</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-500">
            <div className="w-2 h-2 rounded-full bg-slate-600" />
            <TrendingUp className="w-3.5 h-3.5" />
            <span>{lang === 'he' ? 'הערכה' : 'Pricing'}</span>
          </div>
        </div>

        <button onClick={cancelPipeline} className="text-slate-500 text-xs hover:text-slate-300 transition-colors mt-2">
          {lang === 'he' ? 'ביטול' : 'Cancel'}
        </button>
      </div>
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
                  className="flex-1 py-3 rounded-xl bg-blue-600/20 border border-blue-500/30 text-sm font-medium text-blue-300 flex items-center justify-center gap-2 hover:bg-blue-600/30 transition-all active:scale-[0.97]">
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
                    className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/15 hover:border-blue-500/30 transition-all active:scale-95">
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
                className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm focus:border-blue-500/50 transition-all"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              />
              <button onClick={handleSubmit} disabled={!brandInput.trim()}
                className="px-4 py-2.5 rounded-xl bg-blue-600 text-sm font-semibold disabled:opacity-30 hover:bg-blue-500 transition-all active:scale-95">
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
              ? 'border-2 border-blue-400 ring-2 ring-blue-400/30 scale-105'
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
          className="w-14 h-14 rounded-xl border-2 border-dashed border-white/20 flex items-center justify-center hover:border-blue-500/50 hover:bg-blue-500/10 transition-all flex-shrink-0">
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
  } = useApp();

  const [showCorrection, setShowCorrection] = React.useState(false);
  const [correctionInput, setCorrectionInput] = React.useState('');
  const [refining, setRefining] = React.useState(false);
  const [showDetails, setShowDetails] = React.useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = React.useState(0);
  const addPhotoFileRef = React.useRef(null);

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
        <div className="w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center mb-4 animate-pulse">
          <Search className="w-6 h-6 text-blue-400" />
        </div>
        <p className="text-sm text-slate-400">{lang === 'he' ? 'מעדכן זיהוי ומחירים...' : 'Updating identification & prices...'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      {/* Help modal */}
      <HelpIdentifyModal />

      {/* Hidden file input for add-photo from results */}
      <input ref={addPhotoFileRef} type="file" accept="image/*" className="hidden" onChange={handleAddPhotoFile} />

      {/* Item image + name — swipeable when multiple photos */}
      <FadeIn>
        <div className="relative rounded-3xl overflow-hidden shadow-2xl"
          onTouchStart={(e) => { e.currentTarget._touchX = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - (e.currentTarget._touchX || 0);
            if (Math.abs(dx) > 50 && images.length > 1) {
              if (dx < 0) setActivePhotoIndex(prev => Math.min(prev + 1, images.length - 1));
              else setActivePhotoIndex(prev => Math.max(prev - 1, 0));
            }
          }}>
          <div className="aspect-[4/3]">
            <img src={images[activePhotoIndex] || images[0]} className="w-full h-full object-cover" />
          </div>
          {/* Photo counter dots — only when multiple photos */}
          {images.length > 1 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
              {images.map((_, i) => (
                <button key={i} onClick={() => setActivePhotoIndex(i)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === activePhotoIndex ? 'bg-white scale-125' : 'bg-white/40'
                  }`} />
              ))}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge color="blue">{result.category}</Badge>
              {/* Confidence badge — tier-colored */}
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold backdrop-blur-md ${styles.badgeBg}`}>
                {isConfirmed || tier === 'high' ? <Check className="w-3 h-3" /> : <Search className="w-3 h-3" />}
                {confidencePercent}%
              </div>
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
                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold bg-blue-500/15 text-blue-400 backdrop-blur-md">
                  <Eye className="w-2.5 h-2.5" />
                  {lang === 'he' ? 'חזותי' : 'Visual'}
                </div>
              )}
            </div>
            <h2 className="text-2xl font-bold mt-2">{lang === 'he' && result.nameHebrew ? result.nameHebrew : result.name}</h2>
            {(recognition.modelNumber || (identification.model && identification.model !== 'unidentified')) && (
              <p className="text-xs text-slate-400 mt-1">
                {lang === 'he' ? 'דגם: ' : 'Model: '}{recognition.modelNumber || identification.model}
                {brandConf === 'confirmed_by_text' ? ' ✓' : ''}
              </p>
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

      {/* Confidence bar */}
      <FadeIn delay={50}>
        <div className="px-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className={`text-xs font-semibold ${styles.color}`}>{getConfidenceLabel(tier, lang)}</span>
            <span className="text-xs text-slate-500">{confidencePercent}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${styles.barColor}`} style={{ width: `${confidencePercent}%` }} />
          </div>
        </div>
      </FadeIn>

      {/* Confidence reasoning */}
      {confidenceReasoning && (
        <FadeIn delay={60}>
          <div className="px-1 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-slate-500 mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-slate-500 leading-relaxed">{confidenceReasoning}</p>
          </div>
        </FadeIn>
      )}

      {/* ═══ "ADD PHOTO" PROMPT — shown for <80% confidence ═══ */}
      {confidence < 0.80 && canAddPhoto && !isConfirmed && (
        <FadeIn delay={65}>
          <button onClick={handleAddPhotoClick}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/15 transition-all active:scale-[0.98]">
            <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <Camera className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-left flex-1 min-w-0">
              <p className="text-sm font-medium text-blue-300">
                {lang === 'he' ? 'הוסף תמונה של התווית' : 'Add photo of the label'}
              </p>
              <p className="text-[10px] text-slate-500">
                {lang === 'he' ? 'צלם את הלוגו או מספר הדגם לזיהוי מדויק יותר' : 'Capture the logo or model number for better identification'}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
          </button>
        </FadeIn>
      )}

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
                className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm focus:border-blue-500/50 transition-all"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitCorrection(); }}
                autoFocus
              />
              <button onClick={handleSubmitCorrection} disabled={!correctionInput.trim()}
                className="px-4 py-2.5 rounded-xl bg-blue-600 text-sm font-semibold disabled:opacity-30 hover:bg-blue-500 transition-all">
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
                  className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] text-blue-400 hover:bg-blue-500/10 transition-all">
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
                <button onClick={() => setShowCorrection(true)} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
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
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:border-blue-500/50 transition-all"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitCorrection(); }}
                  autoFocus
                />
                <button onClick={handleSubmitCorrection} disabled={!correctionInput.trim()}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-sm font-semibold disabled:opacity-30 hover:bg-blue-500 transition-all">
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
              <button onClick={() => setShowCorrection(true)} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                {lang === 'he' ? 'זה משהו אחר — הקלד ידנית' : 'Something else — type it manually'}
              </button>
            ) : (
              <div className="flex gap-2">
                <input type="text" value={correctionInput} onChange={(e) => setCorrectionInput(e.target.value)}
                  placeholder={lang === 'he' ? 'הקלד שם המוצר...' : 'Type product name...'}
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm focus:border-blue-500/50 transition-all"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitCorrection(); }}
                  autoFocus
                />
                <button onClick={handleSubmitCorrection} disabled={!correctionInput.trim()}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-sm font-semibold disabled:opacity-30 hover:bg-blue-500 transition-all">
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

      {/* Price card */}
      <FadeIn delay={100}>
        <Card className="p-6 text-center" gradient="linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1))" glow>
          <p className="text-sm text-blue-300 font-medium mb-2">
            {tier === 'very_low'
              ? (lang === 'he' ? 'טווח מחירים משוער' : 'Estimated Price Range')
              : t.marketValue}
          </p>
          <p className="text-5xl font-bold bg-gradient-to-r from-blue-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">
            {formatPrice(result.marketValue?.mid)}
          </p>
          {result.marketValue?.low > 0 && (
            <p className="text-sm text-slate-400 mt-3">{t.range}: {formatPrice(result.marketValue.low)} - {formatPrice(result.marketValue.high)}</p>
          )}
          {result.marketValue?.newRetailPrice > 0 && (
            <p className="text-[11px] text-slate-500 mt-1.5">
              {lang === 'he' ? 'מחיר חדש: ' : 'New retail: '}{formatPrice(result.marketValue.newRetailPrice)}
            </p>
          )}
          {priceMethod && (
            <p className="text-[10px] text-slate-600 mt-1">
              {priceMethod === 'comp_based'
                ? (lang === 'he' ? 'מבוסס על מחירי שוק' : 'Based on market data')
                : (lang === 'he' ? 'הערכת AI' : 'AI estimate')}
            </p>
          )}
        </Card>
      </FadeIn>

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

      {/* Actions */}
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