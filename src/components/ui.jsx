import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, Info, AlertTriangle, X, ChevronRight, ChevronLeft } from 'lucide-react';
import { BADGE_COLORS } from '../lib/utils';
import { navDirectionRef } from '../lib/urlSync';

// ── ScreenTransition ──────────────────────────────────────────────────────────
// Direction-aware view transition wrapper.
// Reads navDirectionRef.current at render time (ref written synchronously before
// setView is called, so this always has the correct value on mount).
//
// Use with key={view} on the parent so each view change triggers a fresh mount:
//   <ScreenTransition key={view}>  ← new instance = new animation
//
// CSS classes + @media prefers-reduced-motion are defined in App.jsx <style>.
export const ScreenTransition = ({ children, className = '' }) => {
  const dir = navDirectionRef.current;
  const animClass =
    dir === 'push' ? 'animate-slideInRight' :
    dir === 'pop'  ? 'animate-slideInLeft'  :
                     'animate-crossfade';   // tab, replace, modal, default
  return <div className={`${animClass} ${className}`}>{children}</div>;
};

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

// ── Toast system ─────────────────────────────────────────────────────────────
// Severity types: success | info | warning | error | critical
// critical = no auto-dismiss; must be manually closed.
// RTL/LTR: auto-detected from message content (Hebrew chars → rtl).
// Stacking: App.jsx renders up to 4 toasts in a flex-col container.

const TOAST_CFG = {
  success:  { ms: 4500,  bg: 'linear-gradient(135deg,#059669,#10b981)', glow: 'rgba(16,185,129,0.30)', Icon: CheckCircle   },
  info:     { ms: 4500,  bg: 'linear-gradient(135deg,#1d4ed8,#3b82f6)', glow: 'rgba(59,130,246,0.30)',  Icon: Info          },
  warning:  { ms: 7000,  bg: 'linear-gradient(135deg,#b45309,#f59e0b)', glow: 'rgba(245,158,11,0.30)',  Icon: AlertTriangle },
  error:    { ms: 9500,  bg: 'linear-gradient(135deg,#b91c1c,#ef4444)', glow: 'rgba(239,68,68,0.30)',   Icon: AlertCircle   },
  critical: { ms: null,  bg: 'linear-gradient(135deg,#7c3aed,#b91c1c)', glow: 'rgba(185,28,28,0.40)',   Icon: AlertCircle   },
};

export const Toast = ({ id, message, type = 'success', rtl: appRtl = false, onDismiss }) => {
  const [leaving, setLeaving] = useState(false);
  const cfg = TOAST_CFG[type] ?? TOAST_CFG.success;

  // Auto-dismiss
  useEffect(() => {
    if (!cfg.ms) return;
    const t = setTimeout(handleDismiss, cfg.ms);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.ms]);

  const handleDismiss = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(onDismiss, 230); // matches toastOut animation duration
  };

  // Hebrew text → RTL layout; technical ASCII text → LTR even in Hebrew UI
  const hasHebrew = /[֐-׿]/.test(message);
  const dir = hasHebrew ? 'rtl' : 'ltr';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={leaving ? 'animate-toastOut' : 'animate-toastIn'}
      style={{
        background:   cfg.bg,
        boxShadow:    `0 8px 24px ${cfg.glow}, 0 2px 8px rgba(0,0,0,0.25)`,
        borderRadius: 16,
        padding:      '11px 12px',
        display:      'flex',
        alignItems:   'flex-start',
        gap:          9,
        direction:    dir,
        color:        '#fff',
        minHeight:    48,
        cursor:       'default',
        userSelect:   'none',
        WebkitUserSelect: 'none',
      }}
    >
      {/* Severity icon */}
      <cfg.Icon style={{ width: 18, height: 18, flexShrink: 0, marginTop: 2, opacity: 0.92 }} />

      {/* Message — multiline, wraps naturally */}
      <span style={{
        flex:         1,
        fontSize:     14,
        fontWeight:   600,
        lineHeight:   1.45,
        wordBreak:    'break-word',
        overflowWrap: 'break-word',
        textAlign:    dir === 'rtl' ? 'right' : 'left',
      }}>
        {message}
      </span>

      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        style={{
          flexShrink:      0,
          background:      'rgba(255,255,255,0.18)',
          border:          'none',
          borderRadius:    8,
          width:           26,
          height:          26,
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          cursor:          'pointer',
          color:           '#fff',
          marginTop:       -1,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <X style={{ width: 14, height: 14 }} />
      </button>
    </div>
  );
};

// Skeleton loader
export const Skeleton = ({ className }) => (
  <div className={`bg-white/5 rounded-2xl overflow-hidden relative ${className}`}>
    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" />
  </div>
);

// Skeleton card — for listings grid loading state
export const SkeletonCard = () => (
  <div className="rounded-3xl overflow-hidden bg-white/5 relative">
    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent z-10 pointer-events-none" />
    <div className="aspect-square bg-white/5" />
    <div className="p-4 space-y-3">
      <div className="h-4 bg-white/5 rounded-xl w-3/4" />
      <div className="h-7 bg-white/5 rounded-xl w-1/2" />
      <div className="flex justify-between">
        <div className="h-3 bg-white/5 rounded-xl w-1/3" />
        <div className="h-3 bg-white/5 rounded-xl w-1/4" />
      </div>
    </div>
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
    className={`relative px-6 py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all duration-300 active:scale-95 disabled:opacity-50 overflow-hidden group btn-spring ${primary ? 'btn-spring-primary' : ''} ${className}`}
    style={{
      background: primary ? 'linear-gradient(135deg, #6FEEE1 0%, #4FD1C5 100%)' : secondary ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'rgba(255,255,255,0.05)',
      border: primary || secondary ? 'none' : '1px solid rgba(255,255,255,0.1)',
      boxShadow: primary ? '0 8px 24px rgba(111,238,225,0.35), inset 0 1px 0 rgba(255,255,255,0.25)' : secondary ? '0 8px 24px rgba(16,185,129,0.4)' : 'none',
      color: primary ? '#003733' : undefined,
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
        className={`w-full px-4 py-4 ${Icon ? (rtl ? 'pr-12' : 'pl-12') : ''} rounded-2xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-[#6FEEE1]/50 focus:bg-white/10 transition-all`}
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

// Haptic feedback — safe wrapper, no-ops on unsupported browsers
export const haptic = (pattern = 10) => {
  if (navigator.vibrate) navigator.vibrate(pattern);
};

// Unified empty state — consistent across all views
export const EmptyState = ({ icon: Icon, title, subtitle, cta, className = '' }) => (
  <FadeIn className={`flex flex-col items-center justify-center text-center py-16 ${className}`}>
    {Icon && (
      <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mx-auto mb-4">
        <Icon className="w-10 h-10 text-slate-600" />
      </div>
    )}
    {title && <p className="text-slate-300 font-semibold mb-1">{title}</p>}
    {subtitle && <p className="text-slate-500 text-sm mb-5 max-w-[240px] leading-relaxed">{subtitle}</p>}
    {cta}
  </FadeIn>
);

// Destructive action confirmation sheet
export const ConfirmSheet = ({ open, icon, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onClose, onConfirm }) => {
  if (!open) return null;
  const handleConfirm = () => { haptic(15); onConfirm(); };
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <SlideUp className="w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="bg-gradient-to-b from-[#151d30] to-[#0a1020] rounded-t-[2rem] p-6 space-y-5">
          <div className="w-12 h-1 bg-white/20 rounded-full mx-auto" />
          <div className="text-center space-y-3">
            {icon && (
              <div className="w-16 h-16 rounded-2xl bg-red-500/15 flex items-center justify-center mx-auto">
                {icon}
              </div>
            )}
            <h3 className="text-lg font-bold">{title}</h3>
            {body && <p className="text-sm text-slate-400 leading-relaxed">{body}</p>}
          </div>
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-3.5 rounded-xl bg-white/5 border border-white/10 text-sm font-medium text-slate-300 hover:bg-white/10 transition-all active:scale-95"
            >
              {cancelLabel}
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 py-3.5 rounded-xl bg-red-500 hover:bg-red-400 text-sm font-bold text-white transition-all active:scale-[0.97]"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </SlideUp>
    </div>
  );
};
