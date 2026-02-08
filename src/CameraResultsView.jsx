import React, { useEffect } from 'react';
import { X, Zap, Sparkles, Scan, Search, TrendingUp, Plus, Share2, RefreshCw } from 'lucide-react';import { useApp } from '../contexts/AppContext';
import { Card, Btn, Badge, FadeIn } from '../components/ui';
import { formatPrice } from '../lib/utils';

// Camera view with proper cleanup on unmount
export function CameraView() {
  const { videoRef, canvasRef, capture, stopCamera, showFlash } = useApp();

  useEffect(() => {
    const [torchOn, setTorchOn] = useState(false);

const toggleTorch = async () => {
  try {
    const stream = videoRef.current?.srcObject;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    const newState = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: newState }] });
    setTorchOn(newState);
  } catch (e) {
    console.warn('Torch not supported on this device');
  }
};
    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      }
    };
  }, [videoRef]);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />

      {showFlash && <div className="absolute inset-0 bg-white animate-flash z-50" />}

      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-8 rounded-3xl border-2 border-white/30" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }} />
        <div className="absolute top-10 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/50 backdrop-blur-sm text-sm">
          Position item in frame
        </div>
      </div>
      <div className="absolute bottom-0 inset-x-0 p-8 flex justify-center gap-6 bg-gradient-to-t from-black via-black/80 to-transparent">
        <button onClick={stopCamera} className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center hover:bg-white/20 transition-all">
          <X className="w-6 h-6" />
        </button>
        <button onClick={capture} className="w-20 h-20 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 flex items-center justify-center shadow-xl shadow-blue-500/50 active:scale-95 transition-transform">
          <div className="w-16 h-16 rounded-full border-4 border-white/30" />
        </button>
        <div className="w-14" />
      </div>
    </div>
  );
}

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

// ─── Confidence badge helper ───
function ConfidenceBadge({ confidence, lang }) {
  const pct = Math.round((confidence || 0) * 100);
  let color, label;
  if (pct >= 80) {
    color = 'from-green-500/20 to-emerald-500/20 border-green-500/30 text-green-400';
    label = lang === 'he' ? 'זיהוי גבוה' : 'High Confidence';
  } else if (pct >= 50) {
    color = 'from-yellow-500/20 to-amber-500/20 border-yellow-500/30 text-yellow-400';
    label = lang === 'he' ? 'זיהוי בינוני' : 'Medium Confidence';
  } else {
    color = 'from-red-500/20 to-pink-500/20 border-red-500/30 text-red-400';
    label = lang === 'he' ? 'זיהוי נמוך' : 'Low Confidence';
  }
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r ${color} border text-xs font-semibold`}>
      <ShieldCheck className="w-3.5 h-3.5" />
      {label} ({pct}%)
    </div>
  );
}

// ─── Market trend icon ───
function TrendIcon({ trend }) {
  if (trend === 'up') return <ArrowUp className="w-4 h-4 text-green-400" />;
  if (trend === 'down') return <ArrowDown className="w-4 h-4 text-red-400" />;
  return <Minus className="w-4 h-4 text-slate-400" />;
}

export function ResultsView() {
  const { lang, t, images, result, startListing, reset } = useApp();

  if (!result) return null;

  const confidence = result.confidence || 0;
  const newRetail = result.marketValue?.newRetailPrice;
  const savings = newRetail && result.marketValue?.mid ? Math.round((1 - result.marketValue.mid / newRetail) * 100) : null;

  return (
    <div className="space-y-5 pb-4">
      {/* Image + Category */}
      <FadeIn>
        <div className="relative rounded-3xl overflow-hidden shadow-2xl">
          <div className="aspect-[4/3]">
            <img src={images[0]} className="w-full h-full object-cover" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge color="blue">{result.category}</Badge>
              <ConfidenceBadge confidence={confidence} lang={lang} />
            </div>
            <h2 className="text-2xl font-bold mt-2">{lang === 'he' && result.nameHebrew ? result.nameHebrew : result.name}</h2>
            {result.details?.brand && result.details.brand !== 'Unknown' && result.details.brand !== 'לא ידוע' && (
              <p className="text-sm text-slate-300 mt-1 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" />
                {result.details.brand}{result.details.model && result.details.model !== 'Unknown' && result.details.model !== 'לא ידוע' ? ` — ${result.details.model}` : ''}
              </p>
            )}
          </div>
        </div>
      </FadeIn>

      {/* Main Price Card */}
      <FadeIn delay={100}>
        <Card className="p-6 text-center" gradient="linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1))" glow>
          <p className="text-sm text-blue-300 font-medium mb-2">{t.marketValue}</p>
          <p className="text-5xl font-bold bg-gradient-to-r from-blue-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">
            {formatPrice(result.marketValue?.mid)}
          </p>
          {result.marketValue?.low > 0 && (
            <p className="text-sm text-slate-400 mt-3">{t.range}: {formatPrice(result.marketValue.low)} - {formatPrice(result.marketValue.high)}</p>
          )}

          {/* New retail comparison */}
          {newRetail > 0 && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex items-center justify-center gap-3">
                <div className="text-center">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">{lang === 'he' ? 'מחיר חדש' : 'New Price'}</p>
                  <p className="text-lg font-semibold text-slate-400 line-through">{formatPrice(newRetail)}</p>
                </div>
                {savings > 0 && (
                  <div className="px-3 py-1.5 rounded-xl bg-green-500/20 border border-green-500/30">
                    <p className="text-sm font-bold text-green-400">{lang === 'he' ? `חסכון ${savings}%` : `Save ${savings}%`}</p>
                  </div>
                )}
              </div>
              {result.marketValue?.priceSource && (
                <p className="text-[10px] text-slate-500 mt-2 flex items-center justify-center gap-1">
                  <Store className="w-3 h-3" />
                  {lang === 'he' ? 'מקור:' : 'Source:'} {result.marketValue.priceSource}
                </p>
              )}
            </div>
          )}
        </Card>
      </FadeIn>

      {/* Market Insights */}
      <FadeIn delay={150}>
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-3 text-center">
            <TrendIcon trend={result.marketTrend} />
            <p className="text-[10px] text-slate-500 mt-1">{lang === 'he' ? 'מגמה' : 'Trend'}</p>
            <p className="text-xs font-semibold mt-0.5">
              {result.marketTrend === 'up' ? (lang === 'he' ? 'עולה' : 'Rising')
                : result.marketTrend === 'down' ? (lang === 'he' ? 'יורד' : 'Falling')
                : (lang === 'he' ? 'יציב' : 'Stable')}
            </p>
          </Card>
          <Card className="p-3 text-center">
            <div className={`w-4 h-4 mx-auto rounded-full ${result.demandLevel === 'high' ? 'bg-green-500' : result.demandLevel === 'moderate' ? 'bg-yellow-500' : 'bg-slate-500'}`} />
            <p className="text-[10px] text-slate-500 mt-1">{lang === 'he' ? 'ביקוש' : 'Demand'}</p>
            <p className="text-xs font-semibold mt-0.5">
              {result.demandLevel === 'high' ? (lang === 'he' ? 'גבוה' : 'High')
                : result.demandLevel === 'moderate' ? (lang === 'he' ? 'בינוני' : 'Medium')
                : (lang === 'he' ? 'נמוך' : 'Low')}
            </p>
          </Card>
          <Card className="p-3 text-center">
            <ShieldCheck className="w-4 h-4 mx-auto text-blue-400" />
            <p className="text-[10px] text-slate-500 mt-1">{lang === 'he' ? 'דיוק' : 'Accuracy'}</p>
            <p className="text-xs font-semibold mt-0.5">{Math.round(confidence * 100)}%</p>
          </Card>
        </div>
      </FadeIn>

      {/* Price Factors */}
      {result.priceFactors && result.priceFactors.length > 0 && (
        <FadeIn delay={200}>
          <Card className="p-4">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-400" />
              {lang === 'he' ? 'גורמים המשפיעים על המחיר' : 'Price Factors'}
            </h3>
            <div className="space-y-2">
              {result.priceFactors.map((pf, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{pf.factor}</span>
                  <span className={`font-semibold ${pf.direction === 'up' ? 'text-green-400' : pf.direction === 'down' ? 'text-red-400' : 'text-slate-400'}`}>
                    {pf.impact}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </FadeIn>
      )}

      {/* Identification & Tips */}
      {(result.details?.identificationNotes || result.sellingTips) && (
        <FadeIn delay={250}>
          <Card className="p-4 space-y-3">
            {result.details?.identificationNotes && (
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{lang === 'he' ? 'איך זיהינו' : 'How We Identified'}</p>
                <p className="text-sm text-slate-300">{result.details.identificationNotes}</p>
              </div>
            )}
            {result.sellingTips && (
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{lang === 'he' ? 'טיפ למכירה' : 'Selling Tip'}</p>
                <p className="text-sm text-slate-300">{result.sellingTips}</p>
              </div>
            )}
          </Card>
        </FadeIn>
      )}

      {/* Low confidence warning */}
      {confidence < 0.5 && (
        <FadeIn delay={260}>
          <Card className="p-4 flex items-start gap-3" gradient="linear-gradient(135deg, rgba(234,179,8,0.15), rgba(234,179,8,0.05))">
            <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-yellow-300">{lang === 'he' ? 'זיהוי לא ודאי' : 'Uncertain Identification'}</p>
              <p className="text-xs text-slate-400 mt-1">{lang === 'he' ? 'לא הצלחנו לזהות את הפריט בוודאות. נסה לצלם מקרוב יותר או מזווית אחרת.' : "We couldn't identify this item with certainty. Try a closer photo or different angle."}</p>
            </div>
          </Card>
        </FadeIn>
      )}

      {/* Actions */}
      <FadeIn delay={300} className="flex gap-3">
        <Btn primary className="flex-1 py-4" onClick={startListing}><Plus className="w-5 h-5" />{t.listItem}</Btn>
        <Btn className="px-5"><Share2 className="w-5 h-5" /></Btn>
      </FadeIn>

      <FadeIn delay={350}>
        <button onClick={reset} className="w-full py-3 text-slate-400 text-sm flex items-center justify-center gap-2 hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />{t.scanAnother}
        </button>
      </FadeIn>
    </div>
  );
}
