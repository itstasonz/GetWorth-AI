import React, { useRef } from 'react';
import { User, LogOut, Heart, ShoppingBag, TrendingUp, BarChart3, Loader2, Camera, Shield, CheckCircle, Clock, XCircle, Upload, Package } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, Badge, FadeIn, InputField } from '../components/ui';
import { STAT_COLORS } from '../lib/utils';

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
          <button onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(null); }} className="text-blue-400 font-medium hover:text-blue-300" disabled={authLoading}>
            {authMode === 'login' ? t.signUp : t.signIn}
          </button>
        </p>
      </FadeIn>
    </div>
  );
}

export function ProfileView() {
  const {
    t, lang, user, profile, signOut, myListings, savedItems, setView,
    uploadAvatar, avatarUploading,
    requestVerification, verificationUploading,
    loadOrders,
  } = useApp();

  const avatarInputRef = useRef(null);
  const verifyInputRef = useRef(null);

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
    <div className="space-y-5">
      {/* Profile Card with Avatar */}
      <FadeIn>
        <Card className="p-6">
          <div className="flex items-center gap-5">
            {/* Avatar with upload overlay */}
            <div className="relative group">
              <button
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarUploading}
                className="relative w-20 h-20 rounded-3xl overflow-hidden shadow-xl shadow-blue-500/30 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-3xl font-bold">
                    {profile?.full_name?.charAt(0) || user.email?.charAt(0) || 'U'}
                  </div>
                )}
                {/* Hover/tap overlay */}
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  {avatarUploading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Camera className="w-5 h-5" />
                  )}
                </div>
              </button>
              {/* Online indicator */}
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-green-500 border-2 border-[#060a14]" />
              {/* Verified badge on avatar */}
              {isVerified && (
                <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-blue-500 border-2 border-[#060a14] flex items-center justify-center">
                  <Shield className="w-3 h-3 text-white" />
                </div>
              )}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleAvatarPick}
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold truncate">{profile?.full_name || user.email?.split('@')[0]}</h3>
                {isVerified && (
                  <CheckCircle className="w-5 h-5 text-blue-400 flex-shrink-0" />
                )}
              </div>
              <p className="text-sm text-slate-400 truncate">{user.email}</p>
              {profile?.badge && <Badge color="blue" className="mt-2">{profile.badge}</Badge>}
            </div>
            <button onClick={signOut} className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 transition-all flex-shrink-0">
              <LogOut className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </Card>
      </FadeIn>

      {/* Verification Status Card */}
      <FadeIn delay={50}>
        {vStatus === 'unverified' && (
          <Card className="p-4" gradient="linear-gradient(135deg, rgba(59,130,246,0.1), rgba(59,130,246,0.02))">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{lang === 'he' ? 'אמת את הפרופיל שלך' : 'Verify your profile'}</p>
                <p className="text-xs text-slate-400 mt-0.5">{lang === 'he' ? 'קונים סומכים יותר על מוכרים מאומתים' : 'Buyers trust verified sellers more'}</p>
              </div>
            </div>
            <button
              onClick={() => verifyInputRef.current?.click()}
              disabled={verificationUploading}
              className="w-full mt-3 py-2.5 rounded-xl bg-blue-600/20 border border-blue-500/30 text-sm font-semibold text-blue-300 flex items-center justify-center gap-2 hover:bg-blue-600/30 transition-all"
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

      {/* Profile stats */}
      <FadeIn delay={100} className="grid grid-cols-3 gap-3">
        {[
          { value: myListings.length, label: t.myListings, color: 'blue', icon: ShoppingBag },
          { value: profile?.total_sales || 0, label: t.sales, color: 'green', icon: TrendingUp },
          { value: savedItems.length, label: t.saved, color: 'red', icon: Heart }
        ].map((stat, i) => {
          const colors = STAT_COLORS[stat.color] || STAT_COLORS.blue;
          return (
            <Card key={i} className="p-4 text-center">
              <stat.icon className={`w-5 h-5 ${colors.icon} mx-auto mb-2`} />
              <p className={`text-2xl font-bold ${colors.value}`}>{stat.value}</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">{stat.label}</p>
            </Card>
          );
        })}
      </FadeIn>

      {/* My Orders */}
      <FadeIn delay={150}>
        <button onClick={() => { loadOrders(); setView('orders'); }} className="w-full p-4 rounded-3xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 flex items-center gap-4 hover:bg-emerald-500/20 transition-all active:scale-[0.98]">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/30 to-teal-500/30 flex items-center justify-center">
            <Package className="w-6 h-6 text-emerald-400" />
          </div>
          <div className="flex-1 text-left">
            <p className="font-bold text-white">{lang === 'he' ? 'ההזמנות שלי' : 'My Orders'}</p>
            <p className="text-xs text-slate-400">{lang === 'he' ? 'קניות ומכירות' : 'Purchases & sales'}</p>
          </div>
        </button>
      </FadeIn>

      {/* Admin-only Panel */}
      {profile?.is_admin && (
        <FadeIn delay={200}>
          <button onClick={() => setView('admin')} className="w-full p-4 rounded-3xl bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 flex items-center gap-4 hover:bg-purple-500/20 transition-all active:scale-[0.98]">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center">
              <Shield className="w-6 h-6 text-purple-400" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-bold text-white">{lang === 'he' ? 'פאנל ניהול' : 'Admin Panel'}</p>
              <p className="text-xs text-slate-400">{lang === 'he' ? 'אימותים, דיווחים, הזמנות, משתמשים' : 'Verifications, reports, orders, users'}</p>
            </div>
          </button>
        </FadeIn>
      )}
    </div>
  );
}