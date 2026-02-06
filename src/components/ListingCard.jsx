import React from 'react';
import { Heart, MapPin, Clock } from 'lucide-react';
import { Card, FadeIn } from './ui';
import { formatPrice, timeAgo, getConditionLabel, getConditionColorAlpha } from '../lib/utils';

const ListingCard = ({ item, index = 0, lang, t, rtl, savedIds, heartAnim, toggleSave, viewItem }) => (
  <FadeIn delay={index * 50}>
    <Card className="overflow-hidden group" onClick={() => viewItem(item)}>
      <div className="relative aspect-square overflow-hidden">
        <img src={item.images?.[0]} alt="" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />
        
        {/* Save button */}
        <button 
          onClick={(e) => { e.stopPropagation(); toggleSave(item); }} 
          className={`absolute top-3 ${rtl ? 'left-3' : 'right-3'} w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-300 backdrop-blur-md ${savedIds.has(item.id) ? 'bg-red-500 shadow-lg shadow-red-500/50' : 'bg-black/30 hover:bg-black/50'} ${heartAnim === item.id ? 'animate-heartPop' : ''}`}
        >
          <Heart className={`w-5 h-5 transition-all ${savedIds.has(item.id) ? 'fill-current scale-110' : ''}`} />
        </button>

        {/* [IMPORTANT FIX #2] Condition badge uses translations instead of hardcoded English */}
        {item.condition && (
          <div className={`absolute bottom-3 ${rtl ? 'right-3' : 'left-3'} px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider backdrop-blur-md ${getConditionColorAlpha(item.condition)}`}>
            {getConditionLabel(item.condition, lang)}
          </div>
        )}
      </div>
      
      <div className="p-4 space-y-2">
        <h3 className="font-semibold text-sm truncate group-hover:text-blue-400 transition-colors">
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
  </FadeIn>
);

export default ListingCard;
