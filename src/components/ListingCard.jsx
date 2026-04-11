import React, { useState, useRef, useEffect } from 'react';
import { Heart, MapPin, Clock, CheckCircle, Camera } from 'lucide-react';
import { Card } from './ui';
import { formatPrice, timeAgo, getConditionLabel, getConditionColorAlpha, getQualityBadge } from '../lib/utils';

const QUALITY_COLORS = {
  green: { bg: 'bg-emerald-500/80', text: 'text-white' },
  yellow: { bg: 'bg-amber-500/80', text: 'text-white' },
  red: { bg: 'bg-red-500/70', text: 'text-white' },
};

// ─── Lazy Image with skeleton placeholder ───
// Only loads when card enters viewport (IntersectionObserver)
// Shows shimmer skeleton until loaded, then fades in
const LazyImage = React.memo(({ src, alt, className }) => {
  const [loaded, setLoaded] = useState(false);
  const [inView, setInView] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    const el = imgRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true); // Fallback: load immediately
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); observer.disconnect(); } },
      { rootMargin: '200px' } // Start loading 200px before visible
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={imgRef} className="w-full h-full relative">
      {/* Skeleton shimmer — visible until image loads */}
      {!loaded && (
        <div className="absolute inset-0 bg-white/5">
          <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        </div>
      )}
      {inView && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={`${className} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
});
LazyImage.displayName = 'LazyImage';

const ListingCard = React.memo(({ item, index = 0, lang, t, rtl, savedIds, heartAnim, toggleSave, viewItem }) => {
  const quality = item.quality_score != null ? getQualityBadge(item.quality_score, lang) : null;
  const qColor = quality ? QUALITY_COLORS[quality.color] : null;
  const imageCount = item.images?.length || 0;
  const isSaved = savedIds?.has(item.id) ?? false;

  return (
    <div className="animate-fadeIn" style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}>
      <Card className="overflow-hidden group" onClick={() => viewItem(item)}>
        <div className="relative aspect-square overflow-hidden">
          <LazyImage src={item.images?.[0]} alt="" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />
          
          {/* Save button */}
          <button 
            onClick={(e) => { e.stopPropagation(); toggleSave(item); }} 
            className={`absolute top-3 ${rtl ? 'left-3' : 'right-3'} w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-300 backdrop-blur-md ${isSaved ? 'bg-red-500 shadow-lg shadow-red-500/50' : 'bg-black/30 hover:bg-black/50'} ${heartAnim === item.id ? 'animate-heartPop' : ''}`}
          >
            <Heart className={`w-5 h-5 transition-all ${isSaved ? 'fill-current scale-110' : ''}`} />
          </button>

          {/* Quality badge — top-left */}
          {quality && qColor && (
            <div className={`absolute top-3 ${rtl ? 'right-14' : 'left-3'} px-2 py-1 rounded-lg text-[9px] font-bold backdrop-blur-md flex items-center gap-1 ${qColor.bg} ${qColor.text}`}>
              {quality.color === 'green' && <CheckCircle className="w-3 h-3" />}
              {quality.label}
            </div>
          )}

          {/* Image count badge */}
          {imageCount > 1 && (
            <div className={`absolute bottom-3 ${rtl ? 'left-3' : 'right-3'} px-2 py-1 rounded-lg text-[10px] font-bold backdrop-blur-md bg-black/50 flex items-center gap-1`}>
              <Camera className="w-3 h-3" />
              {imageCount}
            </div>
          )}

          {/* Condition badge — bottom-left */}
          {item.condition && (
            <div className={`absolute bottom-3 ${rtl ? 'right-3' : 'left-3'} px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider backdrop-blur-md ${getConditionColorAlpha(item.condition)}`}>
              {getConditionLabel(item.condition, lang)}
            </div>
          )}
        </div>
        
        <div className="p-4 space-y-2">
          <h3 className="font-semibold text-sm truncate group-hover:text-[#6FEEE1] transition-colors">
            {lang === 'he' && item.title_hebrew ? item.title_hebrew : item.title}
          </h3>
          <p className="text-2xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
            {formatPrice(item.price)}
          </p>
          <div className="flex justify-between items-center pt-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              {item.location || 'Israel'}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {timeAgo(item.created_at, t)}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}, (prev, next) => {
  // Custom comparator — only rerender when THIS card's data actually changed
  // This is the KEY optimization: when context triggers parent rerender,
  // this prevents all 20-50 cards from rerendering
  return (
    prev.item.id === next.item.id &&
    prev.item.price === next.item.price &&
    prev.item.title === next.item.title &&
    prev.item.images?.[0] === next.item.images?.[0] &&
    prev.lang === next.lang &&
    (prev.savedIds?.has(prev.item.id) ?? false) === (next.savedIds?.has(next.item.id) ?? false) &&
    prev.heartAnim === next.heartAnim
  );
});

ListingCard.displayName = 'ListingCard';

export default ListingCard;