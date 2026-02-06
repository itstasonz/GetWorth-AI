import React, { useRef, useEffect, useCallback } from 'react';
import { Sparkles, Upload, Scan, MapPin, ChevronRight, ChevronLeft, Zap, TrendingUp, ShoppingBag } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, FadeIn } from '../components/ui';
import { SAMPLE_ITEMS } from '../lib/constants';
import { formatPrice, getConditionLabel, getConditionColor } from '../lib/utils';

// ─── FIX #1: JS auto-scroll that pauses on touch, resumes after release ───
function useAutoScroll(speed = 0.5, direction = 'left') {
  const scrollRef = useRef(null);
  const animRef = useRef(null);
  const isPaused = useRef(false);
  const resumeTimer = useRef(null);

  const tick = useCallback(() => {
    const el = scrollRef.current;
    if (el && !isPaused.current) {
      const delta = direction === 'left' ? speed : -speed;
      el.scrollLeft += delta;
      // Seamless loop: reset when reaching duplicate boundary
      const half = el.scrollWidth / 2;
      if (direction === 'left' && el.scrollLeft >= half) {
        el.scrollLeft -= half;
      } else if (direction === 'right' && el.scrollLeft <= 0) {
        el.scrollLeft += half;
      }
    }
    animRef.current = requestAnimationFrame(tick);
  }, [speed, direction]);

  useEffect(() => {
    const t = setTimeout(() => {
      const el = scrollRef.current;
      if (el && direction === 'right') {
        el.scrollLeft = el.scrollWidth / 2;
      }
      animRef.current = requestAnimationFrame(tick);
    }, 300);
    return () => {
      clearTimeout(t);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, [tick, direction]);

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

export default function HomeView() {
  const { t, lang, rtl, listings, goTab, startCamera, handleFile, fileRef, viewItem } = useApp();

  const baseItems1 = [...SAMPLE_ITEMS.slice(0, 6), ...listings.slice(0, 4)];
  const baseItems2 = [...SAMPLE_ITEMS.slice(6, 12), ...listings.slice(4, 8)];
  const allItems = [...baseItems1, ...baseItems1, ...baseItems1];
  const allItems2 = [...baseItems2, ...baseItems2, ...baseItems2];

  const row1 = useAutoScroll(0.5, 'left');
  const row2 = useAutoScroll(0.5, 'right');

  return (
    <div className="space-y-6">
     <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; }} />

      {/* Hero */}
      <FadeIn className="text-center space-y-4 pt-2">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20">
          <Sparkles className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-semibold text-blue-300 tracking-wide">{t.aiPowered}</span>
        </div>
        <h2 className="text-3xl font-bold leading-tight">
          {t.heroTitle1}<br/>
          <span className="bg-gradient-to-r from-blue-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">{t.heroTitle2}</span>
        </h2>
        <p className="text-slate-400 text-sm max-w-xs mx-auto">{t.heroSub}</p>
      </FadeIn>

      {/* Action Buttons */}
      <FadeIn delay={100} className="grid grid-cols-2 gap-4">
        <Btn primary onClick={startCamera} className="py-4"><Scan className="w-5 h-5" />{t.scan}</Btn>
        <Btn onClick={() => fileRef.current?.click()} className="py-4"><Upload className="w-5 h-5" />{t.upload}</Btn>
      </FadeIn>

      {/* Hot Items — auto-scrolls + touch/swipe to browse */}
      <FadeIn delay={200} className="space-y-4 -mx-5">
        <div className="px-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h3 className="font-bold text-lg">{lang === 'he' ? 'פריטים חמים' : 'Hot Items'}</h3>
            <span className="text-xs text-slate-500">•</span>
            <span className="text-xs text-slate-400">{lang === 'he' ? 'בזמן אמת' : 'Live'}</span>
          </div>
          <button onClick={() => goTab('browse')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
            {lang === 'he' ? 'הכל' : 'See All'}
            {rtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>

        {/* Row 1 */}
        <div
          ref={row1.scrollRef}
          className="flex gap-3 overflow-x-auto scrollbar-hide px-3"
          onTouchStart={row1.pause} onTouchEnd={row1.resume}
          onMouseDown={row1.pause} onMouseUp={row1.resume} onMouseLeave={row1.resume}
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {allItems.map((item, i) => (
            <MarqueeItem key={`row1-${item.id}-${i}`} item={item} lang={lang} onClick={() => viewItem(item)} accent="blue" />
          ))}
        </div>

        {/* Row 2 */}
        <div
          ref={row2.scrollRef}
          className="flex gap-3 overflow-x-auto scrollbar-hide px-3"
          onTouchStart={row2.pause} onTouchEnd={row2.resume}
          onMouseDown={row2.pause} onMouseUp={row2.resume} onMouseLeave={row2.resume}
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {allItems2.map((item, i) => (
            <MarqueeItem key={`row2-${item.id}-${i}`} item={item} lang={lang} onClick={() => viewItem(item)} accent="green" />
          ))}
        </div>

        <div className="px-5 pt-2">
          <Card className="p-4 text-center" gradient="linear-gradient(135deg, rgba(59,130,246,0.1), rgba(139,92,246,0.1))">
            <p className="text-sm font-medium text-slate-300">{lang === 'he' ? 'יש לך משהו למכור?' : 'Have something to sell?'}</p>
            <p className="text-xs text-slate-500 mt-1">{lang === 'he' ? 'סרוק את הפריט וקבל הערכת מחיר מיידית' : 'Scan your item and get instant valuation'}</p>
          </Card>
        </div>
      </FadeIn>

      {/* Quick Stats */}
      <FadeIn delay={300}>
        <div className="grid grid-cols-3 gap-3">
          {[
            { icon: Zap, label: lang === 'he' ? 'מהיר' : 'Fast', value: '< 3s' },
            { icon: TrendingUp, label: lang === 'he' ? 'דיוק' : 'Accuracy', value: '95%' },
            { icon: ShoppingBag, label: lang === 'he' ? 'פריטים' : 'Items', value: `${listings.length}+` }
          ].map((stat, i) => (
            <Card key={i} className="p-3 text-center">
              <stat.icon className="w-4 h-4 text-blue-400 mx-auto mb-1" />
              <p className="text-base font-bold">{stat.value}</p>
              <p className="text-[9px] text-slate-500 uppercase tracking-wider">{stat.label}</p>
            </Card>
          ))}
        </div>
      </FadeIn>
    </div>
  );
}

function MarqueeItem({ item, lang, onClick, accent }) {
  const borderHover = accent === 'blue' ? 'group-hover:border-blue-500/50' : 'group-hover:border-green-500/50';
  const avatarGradient = accent === 'blue' ? 'from-blue-500 to-purple-600' : 'from-green-500 to-emerald-600';

  return (
    <div onClick={onClick} className="flex-shrink-0 w-40 cursor-pointer group">
      <div className={`relative rounded-2xl overflow-hidden bg-white/5 border border-white/10 transition-all duration-300 group-hover:scale-105 ${borderHover} shadow-lg shadow-black/20`}>
        <div className="aspect-square overflow-hidden">
          <img src={item.images?.[0]} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <p className="text-xs font-semibold truncate text-white">{lang === 'he' && item.title_hebrew ? item.title_hebrew : item.title}</p>
          <p className="text-base font-bold text-green-400 mt-0.5">{formatPrice(item.price)}</p>
          <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
            <MapPin className="w-3 h-3" />{item.location}
          </p>
        </div>
        {item.condition && (
          <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase ${getConditionColor(item.condition)}`}>
            {getConditionLabel(item.condition, lang)}
          </div>
        )}
        <div className={`absolute top-2 right-2 w-8 h-8 rounded-full bg-gradient-to-br ${avatarGradient} flex items-center justify-center text-[11px] font-bold border-2 border-white/30 shadow-lg`}>
          {item.seller?.full_name?.charAt(0) || 'S'}
        </div>
      </div>
    </div>
  );
}
