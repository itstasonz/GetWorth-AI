import React, { useEffect } from 'react';
import { X, Sparkles, Scan, Search, TrendingUp, Plus, Share2, RefreshCw, Zap, ZapOff, AlertTriangle, ArrowLeft, Check } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, Badge, FadeIn } from '../components/ui';
import { formatPrice } from '../lib/utils';

// ═══════════════════════════════════════════════════════
// CAMERA VIEW — with real torch toggle
// ═══════════════════════════════════════════════════════
export function CameraView() {
  const {
    videoRef, canvasRef, capture, stopCamera, showFlash,
    torchSupported, torchOn, toggleTorch, lang,
  } = useApp();

  // Release camera on unmount (tab switch, navigation, etc.)
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />
      
      {showFlash && <div className="absolute inset-0 bg-white animate-flash z-50" />}
      
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-8 rounded-3xl border-2 border-white/30" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }} />
        <div className="absolute top-10 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/50 backdrop-blur-sm text-sm text-white">
          {lang === 'he' ? 'מקם את הפריט במסגרת' : 'Position item in frame'}
        </div>
      </div>
      <div className="absolute bottom-0 inset-x-0 p-8 flex justify-center gap-6 bg-gradient-to-t from-black via-black/80 to-transparent">
        {/* Close button */}
        <button onClick={stopCamera} className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center hover:bg-white/20 transition-all">
          <X className="w-6 h-6 text-white" />
        </button>

        {/* Capture button */}
        <button onClick={capture} className="w-20 h-20 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 flex items-center justify-center shadow-xl shadow-blue-500/50 active:scale-95 transition-transform">
          <div className="w-16 h-16 rounded-full border-4 border-white/30" />
        </button>

        {/* Torch button — only shown if device supports it */}
        {torchSupported ? (
          <button
            onClick={toggleTorch}
            className={`w-14 h-14 rounded-2xl backdrop-blur flex items-center justify-center transition-all ${
              torchOn
                ? 'bg-yellow-500/30 border border-yellow-400/50'
                : 'bg-white/10 hover:bg-white/20'
            }`}
            title={torchOn ? (lang === 'he' ? 'כבה פלאש' : 'Turn off flash') : (lang === 'he' ? 'הדלק פלאש' : 'Turn on flash')}
          >
            {torchOn
              ? <Zap className="w-6 h-6 text-yellow-300" />
              : <ZapOff className="w-6 h-6 text-white/60" />
            }
          </button>
        ) : (
          <div className="w-14" /> // Spacer when torch unavailable
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ANALYZING VIEW — pipeline-state-aware with error/retry UI
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

  // ─── Error state ───
  if (isError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-10 min-h-[70vh]">
        {/* Image preview */}
        <div className="relative w-48 h-48 rounded-3xl overflow-hidden shadow-2xl mb-8 opacity-60">
          {(capturedImageRef.current || images[0]) && (
            <img src={capturedImageRef.current || images[0]} className="w-full h-full object-cover" alt="" />
          )}
          <div className="absolute inset-0 bg-red-900/30" />
        </div>

        {/* Error icon + message */}
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

          {/* Which step failed */}
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

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={cancelPipeline}
              className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              {lang === 'he' ? 'חזור' : 'Back'}
            </button>
            <button
              onClick={retryPipeline}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 hover:from-blue-500 hover:to-blue-400 transition-all flex items-center justify-center gap-2 active:scale-[0.97]"
            >
              <RefreshCw className="w-4 h-4" />
              {lang === 'he' ? 'נסה שוב' : 'Retry'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Loading state (compressing or analyzing) ───
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
              : (lang === 'he' ? 'מזהה פריט וחוקר שוק...' : 'Identifying item & researching market...')
            }
          </p>
        </div>
        <div className="w-48 mx-auto">
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 rounded-full animate-progress" />
          </div>
        </div>

        {/* Step indicators */}
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

        {/* Cancel button */}
        <button
          onClick={cancelPipeline}
          className="text-slate-500 text-xs hover:text-slate-300 transition-colors mt-2"
        >
          {lang === 'he' ? 'ביטול' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// RESULTS VIEW — with multi-stage recognition UI
// ═══════════════════════════════════════════════════════
export function ResultsView() {
  const { lang, t, images, result, startListing, reset, refineResult, confirmResult, correctResult } = useApp();
  const [showCorrection, setShowCorrection] = React.useState(false);
  const [correctionInput, setCorrectionInput] = React.useState('');
  const [refining, setRefining] = React.useState(false);

  if (!result) return null;

  const confidence = result.confidence || 0;
  const confidencePercent = Math.round(confidence * 100);
  const recognition = result.recognition || {};
  const alternatives = recognition.alternatives || [];
  const needsConfirmation = result.needsConfirmation && !result.userConfirmed;
  const isConfirmed = result.userConfirmed;

  const confidenceColor = confidence >= 0.9 ? 'text-green-400' : confidence >= 0.75 ? 'text-blue-400' : confidence >= 0.5 ? 'text-amber-400' : 'text-red-400';
  const confidenceBarColor = confidence >= 0.9 ? 'bg-green-500' : confidence >= 0.75 ? 'bg-blue-500' : confidence >= 0.5 ? 'bg-amber-500' : 'bg-red-500';
  const confidenceLabel = confidence >= 0.9
    ? (lang === 'he' ? 'זיהוי מדויק' : 'Exact match')
    : confidence >= 0.75
      ? (lang === 'he' ? 'ביטחון גבוה' : 'High confidence')
      : confidence >= 0.5
        ? (lang === 'he' ? 'ביטחון בינוני' : 'Moderate confidence')
        : (lang === 'he' ? 'ביטחון נמוך' : 'Low confidence');

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

  // Show refining state
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
      {/* Item image + name */}
      <FadeIn>
        <div className="relative rounded-3xl overflow-hidden shadow-2xl">
          <div className="aspect-[4/3]">
            <img src={images[0]} className="w-full h-full object-cover" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge color="blue">{result.category}</Badge>
              {/* Confidence badge */}
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold backdrop-blur-md ${confidence >= 0.9 ? 'bg-green-500/20 text-green-300' : confidence >= 0.75 ? 'bg-blue-500/20 text-blue-300' : 'bg-amber-500/20 text-amber-300'}`}>
                {isConfirmed ? <Check className="w-3 h-3" /> : <Search className="w-3 h-3" />}
                {confidencePercent}%
              </div>
            </div>
            <h2 className="text-2xl font-bold mt-2">{lang === 'he' && result.nameHebrew ? result.nameHebrew : result.name}</h2>
            {/* Model / OCR info */}
            {(recognition.modelNumber || result.details?.model) && (
              <p className="text-xs text-slate-400 mt-1">
                {lang === 'he' ? 'דגם: ' : 'Model: '}{recognition.modelNumber || result.details?.model}
                {recognition.identifiedBy === 'ocr' || recognition.identifiedBy === 'both' ? ' 📷' : ''}
              </p>
            )}
          </div>
        </div>
      </FadeIn>

      {/* Confidence bar */}
      <FadeIn delay={50}>
        <div className="px-1">
          <div className="flex items-center justify-between mb-1.5">
            <span className={`text-xs font-semibold ${confidenceColor}`}>{confidenceLabel}</span>
            <span className="text-xs text-slate-500">{confidencePercent}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${confidenceBarColor}`} style={{ width: `${confidencePercent}%` }} />
          </div>
        </div>
      </FadeIn>

      {/* Confirmation prompt — shown when AI isn't sure */}
      {needsConfirmation && (
        <FadeIn delay={75}>
          <Card className="p-4 space-y-3" gradient="linear-gradient(135deg, rgba(251,191,36,0.1), rgba(251,191,36,0.02))">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold">{lang === 'he' ? 'האם הזיהוי נכון?' : 'Is this identification correct?'}</p>
                <p className="text-xs text-slate-400 mt-0.5">{lang === 'he' ? 'בחר את המוצר הנכון לקבלת מחיר מדויק' : 'Select the correct product for accurate pricing'}</p>
              </div>
            </div>

            {/* Yes button */}
            <button onClick={confirmResult}
              className="w-full py-2.5 rounded-xl bg-green-600/20 border border-green-500/30 text-sm font-semibold text-green-300 flex items-center justify-center gap-2 hover:bg-green-600/30 transition-all">
              <Check className="w-4 h-4" />
              {lang === 'he' ? 'כן, זה נכון' : 'Yes, this is correct'}
            </button>

            {/* Alternatives */}
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

            {/* Manual correction */}
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
          <p className="text-sm text-blue-300 font-medium mb-2">{t.marketValue}</p>
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
        </Card>
      </FadeIn>

      {/* OCR extracted text (when relevant) */}
      {recognition.ocrText && recognition.identifiedBy !== 'visual' && (
        <FadeIn delay={150}>
          <Card className="p-3">
            <p className="text-[10px] text-slate-500 mb-1">{lang === 'he' ? 'טקסט שזוהה בתמונה' : 'Text extracted from image'}</p>
            <p className="text-xs text-slate-300 font-mono break-all">{recognition.ocrText}</p>
          </Card>
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