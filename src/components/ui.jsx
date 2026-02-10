import React, { useEffect } from 'react';
import { CheckCircle, ChevronRight, ChevronLeft } from 'lucide-react';
import { BADGE_COLORS } from '../lib/utils';

// Animated wrappers
export const FadeIn = ({ children, delay = 0, className = '' }) => (
  <div className={`animate-fadeIn ${className}`} style={{ animationDelay: `${delay}ms` }}>{children}</div>
);

export const SlideUp = ({ children, delay = 0, className = '' }) => (
  <div className={`animate-slideUp ${className}`} style={{ animationDelay: `${delay}ms` }}>{children}</div>
);

export const ScaleIn = ({ children, delay = 0, className = '' }) => (
  <div className={`animate-scaleIn ${className}`} style={{ animationDelay: `${delay}ms` }}>{children}</div>
);

// Toast notification
export const Toast = ({ message, onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 2500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-toastIn">
      <div className="px-5 py-3 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-500 text-white text-sm font-semibold shadow-xl shadow-green-500/30 flex items-center gap-2">
        <CheckCircle className="w-4 h-4" />
        {message}
      </div>
    </div>
  );
};

// Skeleton loader
export const Skeleton = ({ className }) => (
  <div className={`bg-white/5 rounded-2xl overflow-hidden relative ${className}`}>
    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" />
  </div>
);

// Card
export const Card = ({ children, className = '', onClick, glow, gradient }) => (
  <div 
    onClick={onClick} 
    className={`relative rounded-3xl backdrop-blur-xl transition-all duration-500 ${onClick ? 'cursor-pointer hover:scale-[1.02] hover:-translate-y-1 active:scale-[0.98]' : ''} ${className}`}
    style={{ 
      background: gradient || 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: glow ? '0 8px 32px rgba(59,130,246,0.15), inset 0 1px 0 rgba(255,255,255,0.1)' : '0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)'
    }}
  >
    {children}
  </div>
);

// Button
export const Btn = ({ children, primary, secondary, disabled, className = '', ...p }) => (
  <button 
    disabled={disabled} 
    className={`relative px-6 py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all duration-300 active:scale-95 disabled:opacity-50 overflow-hidden group ${className}`}
    style={{
      background: primary ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 50%, #1d4ed8 100%)' : secondary ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'rgba(255,255,255,0.05)',
      border: primary || secondary ? 'none' : '1px solid rgba(255,255,255,0.1)',
      boxShadow: primary ? '0 8px 24px rgba(59,130,246,0.4), inset 0 1px 0 rgba(255,255,255,0.2)' : secondary ? '0 8px 24px rgba(16,185,129,0.4)' : 'none'
    }}
    {...p}
  >
    <span className="relative z-10 flex items-center gap-2">{children}</span>
    {(primary || secondary) && <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />}
  </button>
);

// [IMPORTANT FIX #3] Badge uses explicit class lookup instead of dynamic template literals
export const Badge = ({ children, color = 'blue' }) => {
  const colors = BADGE_COLORS[color] || BADGE_COLORS.blue;
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${colors.bg} ${colors.text} border ${colors.border}`}>
      {children}
    </span>
  );
};

// Input field
export const InputField = ({ label, icon: Icon, rtl, ...p }) => (
  <div className="space-y-2">
    {label && <label className="text-sm text-slate-400 font-medium">{label}</label>}
    <div className="relative">
      {Icon && <Icon className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'right-4' : 'left-4'} w-5 h-5 text-slate-500`} />}
      <input 
        className={`w-full px-4 py-4 ${Icon ? (rtl ? 'pr-12' : 'pl-12') : ''} rounded-2xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all`}
        dir={rtl ? 'rtl' : 'ltr'} 
        {...p} 
      />
    </div>
  </div>
);

// Back button
export const BackButton = ({ onClick, rtl, label }) => {
  return (
    <button onClick={onClick} className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 transition-all group">
      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-all">
        {rtl ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
      </div>
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
};
