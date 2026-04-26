import React, { useRef, useState, useEffect } from 'react';
import { User, LogOut, Heart, ShoppingBag, TrendingUp, BarChart3, Loader2, Camera, Shield, CheckCircle, Clock, XCircle, Upload, Package, Scan, Trash2, ChevronDown, ChevronRight, X, Star, Archive, Banknote, HelpCircle, Settings } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, Badge, FadeIn, InputField } from '../components/ui';
import { STAT_COLORS, timeAgo } from '../lib/utils';

// ═══════════════════════════════════════════════════════════════════════
// STITCH DESIGN TOKENS — from Stitch Profile HTML
// ═══════════════════════════════════════════════════════════════════════
const STITCH = {
  background:              '#131313',
  primary:                 '#6FEEE1',
  primaryContainer:        '#4FD1C5',
  onPrimary:               '#003733',
  onSurface:               '#e5e2e1',
  onSurfaceVariant:        '#BBC9C7',
  surfaceContainerLowest:  '#0e0e0e',
  surfaceContainerLow:     '#1C1B1B',
  surfaceContainerHigh:    '#2A2A2A',
  surfaceContainerHighest: '#353534',
  error:                   '#ffb4ab',
  FONT_HEADLINE: '"Manrope", system-ui, -apple-system, sans-serif',
  FONT_BODY:     '"Inter", system-ui, -apple-system, sans-serif',
};

export function AuthView() {
  const { t, lang, rtl, authMode, setAuthMode, authForm, setAuthForm, authError, setAuthError, authLoading, signInGoogle, signInEmail } = useApp();

  return (
    <div className="space-y-6 pt-4">
      <FadeIn className="text-center space-y-2">
        <h2 className="text-3xl font-bold">{authMode === 'login' ? t.welcome : t.createAcc}</h2>
        <p className="text-slate-400">{authMode === 'login' ? t.signInAccess : t.join}</p>
      </FadeIn>

      {authError && (
        <FadeIn>
          <Card className="p-4" gradient="linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))">
            <p className="text-sm text-red-300">{authError}</p>
          </Card>
        </FadeIn>
      )}

      <FadeIn delay={100}>
        <button onClick={signInGoogle} disabled={authLoading} className="w-full py-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center gap-3 hover:bg-white/10 transition-all active:scale-[0.98] disabled:opacity-50">
          <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          <span className="font-medium">{t.google}</span>
        </button>
      </FadeIn>

      <FadeIn delay={150} className="flex items-center gap-4">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        <span className="text-xs text-slate-500 font-medium">{t.or}</span>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </FadeIn>

      <FadeIn delay={200}>
        <form onSubmit={signInEmail} className="space-y-4">
          {authMode === 'signup' && <InputField label={t.name} icon={User} rtl={rtl} value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} />}
          <InputField label={t.email} type="email" rtl={rtl} value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} required />
          <InputField label={t.password} type="password" rtl={rtl} value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} required minLength={6} />
          <Btn primary className="w-full py-4" disabled={authLoading}>
            {authLoading ? (
              <><Loader2 className="w-5 h-5 animate-spin" />{lang === 'he' ? 'מתחבר...' : 'Signing in...'}</>
            ) : (
              authMode === 'login' ? t.signIn : t.signUp
            )}
          </Btn>
        </form>
      </FadeIn>

      <FadeIn delay={250}>
        <p className="text-center text-sm text-slate-400">
          {authMode === 'login' ? t.noAcc : t.haveAcc}{' '}
          <button onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(null); }} className="font-medium hover:opacity-80 transition-opacity" style={{ color: '#6FEEE1' }} disabled={authLoading}>
            {authMode === 'login' ? t.signUp : t.signIn}
          </button>
        </p>
      </FadeIn>
    </div>
  );
}

export function ProfileView() {
  const {
    t, lang, rtl, user, profile, signOut, myListings, savedItems, setView,
    uploadAvatar, avatarUploading,
    requestVerification, verificationUploading,
    loadOrders,
    valuations, valuationsLoading, loadValuations, deleteValuation, clearAllValuations,
    myReviews: myReviewsRaw, loadMyReviews,
  } = useApp();

  const myReviews = myReviewsRaw || [];

  const avatarInputRef = useRef(null);
  const verifyInputRef = useRef(null);
  const [scansExpanded, setScansExpanded] = useState(false);
  const [scansVisible, setScansVisible] = useState(5);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [reviewsExpanded, setReviewsExpanded] = useState(false);

  // Load reviews about me
  useEffect(() => {
    if (user) loadMyReviews();
  }, [user, loadMyReviews]);

  // Inject Manrope + Inter fonts once
  useEffect(() => {
    if (document.getElementById('stitch-fonts')) return;
    const link = document.createElement('link');
    link.id = 'stitch-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Inter:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }, []);

  if (!user) return null;

  const vStatus = profile?.verification_status || 'unverified';
  const isVerified = vStatus === 'verified' || profile?.is_verified;

  const handleAvatarPick = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadAvatar(file);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const handleVerifyPick = (e) => {
    const file = e.target.files?.[0];
    if (file) requestVerification(file);
    if (verifyInputRef.current) verifyInputRef.current.value = '';
  };

  return (
    <div
      className="space-y-6 pb-4"
      style={{ fontFamily: STITCH.FONT_BODY, color: STITCH.onSurface }}
    >
      {/* ═══ STITCH PROFILE HEADER — centered avatar + name + verified pill ═══ */}
      <FadeIn>
        <section className="flex flex-col items-center text-center space-y-5 pt-4">
          {/* Avatar with gradient glow ring */}
          <div className="relative group">
            {/* Outer glow ring */}
            <div
              className="absolute -inset-1 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000"
              style={{ background: `linear-gradient(to top right, ${STITCH.primary}, ${STITCH.primaryContainer})` }}
            />
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              className="relative h-32 w-32 rounded-full overflow-hidden focus:outline-none focus:ring-2"
              style={{
                border: `2px solid ${STITCH.surfaceContainerHigh}`,
                background: STITCH.surfaceContainerLow,
              }}
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center text-4xl font-bold"
                  style={{
                    background: `linear-gradient(135deg, ${STITCH.primary}, ${STITCH.primaryContainer})`,
                    color: STITCH.onPrimary,
                    fontFamily: STITCH.FONT_HEADLINE,
                  }}
                >
                  {profile?.full_name?.charAt(0) || user.email?.charAt(0) || 'U'}
                </div>
              )}
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {avatarUploading
                  ? <Loader2 className="w-6 h-6 animate-spin" style={{ color: STITCH.primary }} />
                  : <Camera className="w-6 h-6" style={{ color: STITCH.primary }} />
                }
              </div>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarPick}
            />
            {/* Online indicator dot */}
            <div
              className="absolute bottom-2 right-2 h-5 w-5 rounded-full"
              style={{
                background: STITCH.primary,
                border: `4px solid ${STITCH.background}`,
              }}
            />
          </div>

          {/* Name + Verified Pill */}
          <div className="space-y-2">
            <h2
              className="text-3xl font-extrabold tracking-tight"
              style={{ fontFamily: STITCH.FONT_HEADLINE, color: STITCH.onSurface }}
            >
              {profile?.full_name || user.email?.split('@')[0]}
            </h2>
            {/* Email sub-line */}
            <p className="text-sm" style={{ color: STITCH.onSurfaceVariant }}>{user.email}</p>
            {/* Verified pill — only when verified */}
            {isVerified && (
              <div
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full"
                style={{
                  background: 'rgba(111, 238, 225, 0.10)',
                  border: '1px solid rgba(111, 238, 225, 0.20)',
                }}
              >
                <CheckCircle className="w-4 h-4" style={{ color: STITCH.primary }} fill="currentColor" fillOpacity={0.2} />
                <span
                  className="text-xs font-semibold tracking-wider uppercase"
                  style={{ color: STITCH.primary }}
                >
                  {lang === 'he' ? 'מוכר מאומת' : 'Verified Seller'}
                </span>
              </div>
            )}
            {/* Rating display */}
            {(profile?.rating > 0 || profile?.review_count > 0) && (
              <div className="flex items-center justify-center gap-1.5 pt-1">
                <div className="flex items-center gap-0.5">
                  {[1,2,3,4,5].map(s => (
                    <Star key={s} className={`w-3.5 h-3.5 ${s <= Math.round(profile.rating) ? 'fill-current' : ''}`}
                      style={{ color: s <= Math.round(profile.rating) ? '#FBBF24' : STITCH.surfaceContainerHighest }} />
                  ))}
                </div>
                <span className="text-sm font-semibold" style={{ color: '#FBBF24' }}>{profile.rating}</span>
                <span className="text-xs" style={{ color: STITCH.onSurfaceVariant }}>({profile.review_count})</span>
              </div>
            )}
          </div>
        </section>
      </FadeIn>

      {/* Verification Status Card */}
      <FadeIn delay={50}>
        {vStatus === 'unverified' && (
          <Card className="p-4" gradient="linear-gradient(135deg, rgba(59,130,246,0.1), rgba(59,130,246,0.02))">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(111,238,225,0.12)' }}>
                <Shield className="w-5 h-5" style={{ color: '#6FEEE1' }} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{lang === 'he' ? 'אמת את הפרופיל שלך' : 'Verify your profile'}</p>
                <p className="text-xs text-slate-400 mt-0.5">{lang === 'he' ? 'קונים סומכים יותר על מוכרים מאומתים' : 'Buyers trust verified sellers more'}</p>
              </div>
            </div>
            <button
              onClick={() => verifyInputRef.current?.click()}
              disabled={verificationUploading}
              className="w-full mt-3 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-80"
              style={{ background: 'rgba(111,238,225,0.1)', border: '1px solid rgba(111,238,225,0.25)', color: '#6FEEE1' }}
            >
              {verificationUploading ? (
                <><Loader2 className="w-4 h-4 animate-spin" />{lang === 'he' ? 'מעלה...' : 'Uploading...'}</>
              ) : (
                <><Upload className="w-4 h-4" />{lang === 'he' ? 'העלה סלפי לאימות' : 'Upload selfie to verify'}</>
              )}
            </button>
            <input ref={verifyInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="user" className="hidden" onChange={handleVerifyPick} />
          </Card>
        )}

        {vStatus === 'pending' && (
          <Card className="p-4" gradient="linear-gradient(135deg, rgba(251,191,36,0.1), rgba(251,191,36,0.02))">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-200">{lang === 'he' ? 'בבדיקה' : 'Verification pending'}</p>
                <p className="text-xs text-slate-400">{lang === 'he' ? 'הבקשה שלך נבדקת. זה ייקח עד 24 שעות' : 'Your request is being reviewed. This takes up to 24h'}</p>
              </div>
            </div>
          </Card>
        )}

        {vStatus === 'verified' && (
          <Card className="p-4" gradient="linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.02))">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-200">{lang === 'he' ? '✔ מוכר מאומת' : '✔ Verified Seller'}</p>
                <p className="text-xs text-slate-400">{lang === 'he' ? 'הפרופיל שלך אומת בהצלחה' : 'Your profile has been verified'}</p>
              </div>
            </div>
          </Card>
        )}

        {vStatus === 'rejected' && (
          <Card className="p-4" gradient="linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.02))">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <XCircle className="w-5 h-5 text-red-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-200">{lang === 'he' ? 'הבקשה נדחתה' : 'Verification rejected'}</p>
                <p className="text-xs text-slate-400 mt-0.5">{lang === 'he' ? 'נסה שוב עם תמונת סלפי ברורה' : 'Try again with a clear selfie photo'}</p>
              </div>
            </div>
            <button
              onClick={() => verifyInputRef.current?.click()}
              disabled={verificationUploading}
              className="w-full mt-3 py-2.5 rounded-xl bg-red-600/20 border border-red-500/30 text-sm font-semibold text-red-300 flex items-center justify-center gap-2 hover:bg-red-600/30 transition-all"
            >
              {verificationUploading ? (
                <><Loader2 className="w-4 h-4 animate-spin" />{lang === 'he' ? 'מעלה...' : 'Uploading...'}</>
              ) : (
                <><Upload className="w-4 h-4" />{lang === 'he' ? 'נסה שוב' : 'Try again'}</>
              )}
            </button>
            <input ref={verifyInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="user" className="hidden" onChange={handleVerifyPick} />
          </Card>
        )}
      </FadeIn>

      {/* ═══ STITCH STATS BENTO — 3-col grid ═══ */}
      <FadeIn delay={100}>
        <section className="grid grid-cols-3 gap-3">
          {[
            { value: myListings.length, label: t.myListings || (lang === 'he' ? 'מודעות' : 'Listings') },
            { value: profile?.total_sales || 0, label: t.sales || (lang === 'he' ? 'מכירות' : 'Sales') },
            { value: savedItems.length, label: t.saved || (lang === 'he' ? 'שמורים' : 'Saved') },
          ].map((stat, i) => (
            <div
              key={i}
              className="p-5 rounded-2xl flex flex-col items-center justify-center space-y-1"
              style={{ background: STITCH.surfaceContainerLow }}
            >
              <span
                className="text-2xl font-bold"
                style={{ fontFamily: STITCH.FONT_HEADLINE, color: STITCH.onSurface }}
              >
                {stat.value}
              </span>
              <span
                className="text-[10px] uppercase tracking-widest font-medium"
                style={{ color: STITCH.onSurfaceVariant }}
              >
                {stat.label}
              </span>
            </div>
          ))}
        </section>
      </FadeIn>

      {/* ═══ STITCH ACCOUNT MANAGEMENT SECTION ═══ */}
      <FadeIn delay={150}>
        <section className="space-y-3">
          <h3
            className="text-xs font-bold uppercase tracking-[0.2em] px-2"
            style={{ color: 'rgba(187, 201, 199, 0.50)' }}
          >
            {lang === 'he' ? 'ניהול חשבון' : 'Account Management'}
          </h3>

          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: STITCH.surfaceContainerLow }}
          >
            {/* My Orders */}
            <button
              onClick={() => { loadOrders(); setView('orders'); }}
              className="w-full flex items-center justify-between px-6 py-4 transition-colors active:scale-[0.99]"
              style={{ borderBottom: `1px solid ${STITCH.surfaceContainerHigh}` }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="h-10 w-10 rounded-full flex items-center justify-center"
                  style={{ background: STITCH.surfaceContainerHighest, color: STITCH.primary }}
                >
                  <Package className="w-5 h-5" />
                </div>
                <span className="font-medium text-sm" style={{ color: STITCH.onSurface }}>
                  {lang === 'he' ? 'ההזמנות שלי' : 'My Orders'}
                </span>
              </div>
              {rtl
                ? <ChevronRight className="w-5 h-5 rotate-180" style={{ color: STITCH.onSurfaceVariant }} />
                : <ChevronRight className="w-5 h-5" style={{ color: STITCH.onSurfaceVariant }} />
              }
            </button>

            {/* My Listings */}
            <button
              onClick={() => setView('myListings')}
              className="w-full flex items-center justify-between px-6 py-4 transition-colors active:scale-[0.99]"
              style={{ borderBottom: `1px solid ${STITCH.surfaceContainerHigh}` }}
            >
              <div className="flex items-center gap-4">
                <div
                  className="h-10 w-10 rounded-full flex items-center justify-center"
                  style={{ background: STITCH.surfaceContainerHighest, color: STITCH.primary }}
                >
                  <Archive className="w-5 h-5" />
                </div>
                <span className="font-medium text-sm" style={{ color: STITCH.onSurface }}>
                  {lang === 'he' ? 'המודעות שלי' : 'My Listings'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: STITCH.primary }}>{myListings.length}</span>
                {rtl
                  ? <ChevronRight className="w-5 h-5 rotate-180" style={{ color: STITCH.onSurfaceVariant }} />
                  : <ChevronRight className="w-5 h-5" style={{ color: STITCH.onSurfaceVariant }} />
                }
              </div>
            </button>

            {/* Rating & Reviews — expandable, preserves ALL existing logic */}
            <button
              onClick={() => setReviewsExpanded(!reviewsExpanded)}
              className="w-full flex items-center justify-between px-6 py-4 transition-colors active:scale-[0.99]"
            >
              <div className="flex items-center gap-4">
                <div
                  className="h-10 w-10 rounded-full flex items-center justify-center"
                  style={{ background: STITCH.surfaceContainerHighest, color: STITCH.primary }}
                >
                  <Star className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <span className="block font-medium text-sm" style={{ color: STITCH.onSurface }}>
                    {lang === 'he' ? 'דירוגים וביקורות' : 'Reviews'}
                  </span>
                  {profile?.rating > 0 && (
                    <span className="block text-[10px]" style={{ color: STITCH.onSurfaceVariant }}>
                      {profile.review_count} {lang === 'he' ? 'ביקורות' : 'reviews'}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {profile?.rating > 0 ? (
                  <span className="text-sm font-semibold" style={{ color: STITCH.primary }}>
                    {profile.rating.toFixed(1)}
                  </span>
                ) : (
                  <span className="text-xs" style={{ color: STITCH.onSurfaceVariant }}>
                    {lang === 'he' ? 'אין' : 'None'}
                  </span>
                )}
                <ChevronDown
                  className={`w-5 h-5 transition-transform ${reviewsExpanded ? 'rotate-180' : ''}`}
                  style={{ color: STITCH.onSurfaceVariant }}
                />
              </div>
            </button>

            {/* Reviews expanded content — preserves all original logic */}
            {reviewsExpanded && (
              <div className="px-4 pb-4 pt-2 space-y-3">
                {/* Star breakdown */}
                {profile?.review_count > 0 && myReviews.length > 0 && (
                  <div
                    className="rounded-2xl p-3 space-y-1.5"
                    style={{ background: STITCH.surfaceContainerHigh }}
                  >
                    {[5,4,3,2,1].map(star => {
                      const count = myReviews.filter(r => r.rating === star).length;
                      const pct = myReviews.length > 0 ? (count / myReviews.length) * 100 : 0;
                      return (
                        <div key={star} className="flex items-center gap-2">
                          <span className="text-xs w-3" style={{ color: STITCH.onSurfaceVariant }}>{star}</span>
                          <Star className="w-3 h-3 fill-current" style={{ color: '#FBBF24' }} />
                          <div className="flex-1 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.10)' }}>
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, background: '#FBBF24' }}
                            />
                          </div>
                          <span className="text-[10px] w-4 text-right" style={{ color: STITCH.onSurfaceVariant }}>{count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Individual reviews */}
                {myReviews.length === 0 ? (
                  <div className="text-center py-6">
                    <Star className="w-8 h-8 mx-auto mb-2" style={{ color: STITCH.surfaceContainerHighest }} />
                    <p className="text-sm" style={{ color: STITCH.onSurfaceVariant }}>
                      {lang === 'he' ? 'עדיין לא קיבלת ביקורות' : 'No reviews received yet'}
                    </p>
                    <p className="text-xs mt-1" style={{ color: STITCH.onSurfaceVariant, opacity: 0.7 }}>
                      {lang === 'he' ? 'ביקורות יופיעו כאן לאחר השלמת עסקאות' : 'Reviews will appear here after completed transactions'}
                    </p>
                  </div>
                ) : (
                  myReviews.map((review) => (
                    <div key={review.id} className="rounded-2xl p-3" style={{ background: STITCH.surfaceContainerHigh }}>
                      <div className="flex items-start gap-3">
                        {review.reviewer?.avatar_url ? (
                          <img src={review.reviewer.avatar_url} alt="" className="w-8 h-8 rounded-xl object-cover" />
                        ) : (
                          <div
                            className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold"
                            style={{
                              background: `linear-gradient(135deg, ${STITCH.primary}, ${STITCH.primaryContainer})`,
                              color: STITCH.onPrimary,
                            }}
                          >
                            {review.reviewer?.full_name?.charAt(0) || '?'}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold" style={{ color: STITCH.onSurface }}>
                              {review.reviewer?.full_name || (lang === 'he' ? 'משתמש' : 'User')}
                            </span>
                            <div className="flex items-center gap-0.5">
                              {[1,2,3,4,5].map(s => (
                                <Star key={s} className={`w-2.5 h-2.5 ${s <= review.rating ? 'fill-current' : ''}`}
                                  style={{ color: s <= review.rating ? '#FBBF24' : STITCH.surfaceContainerHighest }} />
                              ))}
                            </div>
                          </div>
                          {review.comment && (
                            <p className="text-xs mt-1" style={{ color: STITCH.onSurfaceVariant }}>{review.comment}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            {review.listing?.images?.[0] && (
                              <img src={review.listing.images[0]} alt="" className="w-4 h-4 rounded object-cover" />
                            )}
                            <span className="text-[10px]" style={{ color: STITCH.onSurfaceVariant, opacity: 0.7 }}>
                              {lang === 'he' && review.listing?.title_hebrew ? review.listing.title_hebrew : (review.listing?.title || '')}
                            </span>
                            <span className="text-[10px]" style={{ color: STITCH.onSurfaceVariant, opacity: 0.4 }}>•</span>
                            <span className="text-[10px]" style={{ color: STITCH.onSurfaceVariant, opacity: 0.7 }}>
                              {timeAgo(review.created_at, { ago: lang === 'he' ? 'לפני' : 'ago' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </section>
      </FadeIn>

      {/* ═══ STITCH GENERAL SECTION ═══ */}
      <FadeIn delay={175}>
        <section className="space-y-3">
          <h3
            className="text-xs font-bold uppercase tracking-[0.2em] px-2"
            style={{ color: 'rgba(187, 201, 199, 0.50)' }}
          >
            {lang === 'he' ? 'כללי' : 'General'}
          </h3>

          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: STITCH.surfaceContainerLow }}
          >
            {/* My Scans — expandable list item */}
            <button
              onClick={() => {
                if (!scansExpanded) { loadValuations(); setScansExpanded(true); setScansVisible(5); }
                else setScansExpanded(false);
              }}
              className="w-full flex items-center justify-between px-6 py-4 transition-colors active:scale-[0.99]"
            >
              <div className="flex items-center gap-4">
                <div
                  className="h-10 w-10 rounded-full flex items-center justify-center"
                  style={{ background: STITCH.surfaceContainerHighest, color: STITCH.primary }}
                >
                  <Scan className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <span className="block font-medium text-sm" style={{ color: STITCH.onSurface }}>
                    {lang === 'he' ? 'הסריקות שלי' : 'My Scans'}
                  </span>
                  <span className="block text-[10px]" style={{ color: STITCH.onSurfaceVariant }}>
                    {scansExpanded && valuations.length > 0
                      ? (lang === 'he' ? `${valuations.length} סריקות` : `${valuations.length} scans`)
                      : (lang === 'he' ? 'היסטוריית הערכות AI' : 'AI valuation history')}
                  </span>
                </div>
              </div>
              <ChevronDown
                className={`w-5 h-5 transition-transform duration-300 ${scansExpanded ? 'rotate-180' : ''}`}
                style={{ color: STITCH.onSurfaceVariant }}
              />
            </button>

        {/* Scan list (collapsible) */}
        {scansExpanded && (
          <>
            {valuationsLoading && (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-[#6FEEE1]" /></div>
            )}

            {!valuationsLoading && valuations.length > 0 && (
              <div className="mt-3 space-y-2">
                {/* Clear All button */}
                <div className="flex justify-end px-1">
                  {!confirmClearAll ? (
                    <button
                      onClick={() => setConfirmClearAll(true)}
                      className="flex items-center gap-1.5 text-[11px] text-red-400/70 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      {lang === 'he' ? 'מחק הכל' : 'Clear All'}
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-red-300">{lang === 'he' ? 'בטוח?' : 'Sure?'}</span>
                      <button
                        onClick={() => { clearAllValuations(); setConfirmClearAll(false); setScansExpanded(false); }}
                        className="px-2.5 py-1 rounded-lg bg-red-500/20 text-[11px] text-red-300 font-semibold hover:bg-red-500/30 transition-colors"
                      >
                        {lang === 'he' ? 'כן, מחק' : 'Yes, delete'}
                      </button>
                      <button
                        onClick={() => setConfirmClearAll(false)}
                        className="px-2.5 py-1 rounded-lg bg-white/5 text-[11px] text-slate-400 hover:bg-white/10 transition-colors"
                      >
                        {lang === 'he' ? 'ביטול' : 'Cancel'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Scan items */}
                {valuations.slice(0, scansVisible).map((v) => (
                  <Card key={v.id} className="p-3 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      v.ai_confidence >= 0.9 ? 'bg-green-500/20 text-green-300' :
                      v.ai_confidence >= 0.75 ? 'bg-[#6FEEE1]/10 text-[#6FEEE1]' :
                      'bg-amber-500/20 text-amber-300'
                    }`}>
                      {Math.round((v.ai_confidence || 0) * 100)}%
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{lang === 'he' && v.ai_name_hebrew ? v.ai_name_hebrew : v.ai_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-slate-500">{v.ai_category}</span>
                        {v.user_confirmed && <CheckCircle className="w-3 h-3 text-green-400" />}
                        {v.user_correction && <span className="text-[10px] text-amber-400">→ {v.user_correction}</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {v.price_mid > 0 && <p className="text-sm font-bold text-[#6FEEE1]">₪{v.price_mid.toLocaleString()}</p>}
                      <p className="text-[10px] text-slate-600">{new Date(v.created_at).toLocaleDateString()}</p>
                    </div>
                    {/* Delete button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteValuation(v.id); }}
                      className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all flex-shrink-0 active:scale-90"
                      aria-label="Delete scan"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </Card>
                ))}

                {/* Show More / Show Less */}
                {valuations.length > scansVisible && (
                  <button
                    onClick={() => setScansVisible(prev => prev + 10)}
                    className="w-full py-2.5 rounded-2xl bg-white/5 border border-white/5 text-xs text-slate-400 hover:bg-white/10 transition-all flex items-center justify-center gap-1.5"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                    {lang === 'he' ? `עוד ${Math.min(10, valuations.length - scansVisible)} מתוך ${valuations.length - scansVisible} נותרים` : `Show ${Math.min(10, valuations.length - scansVisible)} more of ${valuations.length - scansVisible} remaining`}
                  </button>
                )}
                {scansVisible > 5 && valuations.length <= scansVisible && (
                  <button
                    onClick={() => setScansVisible(5)}
                    className="w-full py-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {lang === 'he' ? 'הצג פחות' : 'Show less'}
                  </button>
                )}
              </div>
            )}

            {!valuationsLoading && valuations.length === 0 && (
              <p className="text-center text-xs py-3" style={{ color: STITCH.onSurfaceVariant, opacity: 0.7 }}>
                {lang === 'he' ? 'אין סריקות עדיין' : 'No scans yet'}
              </p>
            )}
          </>
        )}

        {/* Admin Panel — list item inside same section, NOT inside scan expansion */}
        {profile?.is_admin && (
          <button
            onClick={() => setView('admin')}
            className="w-full flex items-center justify-between px-6 py-4 transition-colors active:scale-[0.99]"
            style={{ borderTop: `1px solid ${STITCH.surfaceContainerHigh}` }}
          >
            <div className="flex items-center gap-4">
              <div
                className="h-10 w-10 rounded-full flex items-center justify-center"
                style={{ background: STITCH.surfaceContainerHighest, color: STITCH.primary }}
              >
                <Shield className="w-5 h-5" />
              </div>
              <div className="text-left">
                <span className="block font-medium text-sm" style={{ color: STITCH.onSurface }}>
                  {lang === 'he' ? 'פאנל ניהול' : 'Admin Panel'}
                </span>
                <span className="block text-[10px]" style={{ color: STITCH.onSurfaceVariant }}>
                  {lang === 'he' ? 'אימותים, דיווחים, משתמשים' : 'Verifications, reports, users'}
                </span>
              </div>
            </div>
            {rtl
              ? <ChevronRight className="w-5 h-5 rotate-180" style={{ color: STITCH.onSurfaceVariant }} />
              : <ChevronRight className="w-5 h-5" style={{ color: STITCH.onSurfaceVariant }} />
            }
          </button>
        )}
          </div>
        </section>
      </FadeIn>

      {/* ═══ STITCH LOG OUT BUTTON ═══ */}
      <FadeIn delay={220}>
        <button
          onClick={signOut}
          className="w-full py-4 font-semibold text-sm rounded-2xl transition-colors"
          style={{
            color: STITCH.error,
            background: 'rgba(255, 180, 171, 0.05)',
            fontFamily: STITCH.FONT_BODY,
          }}
        >
          {lang === 'he' ? 'התנתק' : 'Log Out'}
        </button>
      </FadeIn>
    </div>
  );
}