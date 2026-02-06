import React from 'react';
import { User, LogOut, Heart, ShoppingBag, TrendingUp } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, Badge, FadeIn, InputField } from '../components/ui';
import { STAT_COLORS } from '../lib/utils';

export function AuthView() {
  const { t, rtl, authMode, setAuthMode, authForm, setAuthForm, authError, setAuthError, signInGoogle, signInEmail } = useApp();

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
        <button onClick={signInGoogle} className="w-full py-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center gap-3 hover:bg-white/10 transition-all active:scale-[0.98]">
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
          <InputField label={t.password} type="password" rtl={rtl} value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} required />
          <Btn primary className="w-full py-4">{authMode === 'login' ? t.signIn : t.signUp}</Btn>
        </form>
      </FadeIn>

      <FadeIn delay={250}>
        <p className="text-center text-sm text-slate-400">
          {authMode === 'login' ? t.noAcc : t.haveAcc}{' '}
          <button onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(null); }} className="text-blue-400 font-medium hover:text-blue-300">
            {authMode === 'login' ? t.signUp : t.signIn}
          </button>
        </p>
      </FadeIn>
    </div>
  );
}

export function ProfileView() {
  const { t, user, profile, signOut, myListings, savedItems } = useApp();

  if (!user) return null;

  return (
    <div className="space-y-5">
      <FadeIn>
        <Card className="p-6">
          <div className="flex items-center gap-5">
            <div className="relative">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-3xl font-bold shadow-xl shadow-blue-500/30">
                {profile?.full_name?.charAt(0) || user.email?.charAt(0) || 'U'}
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-green-500 border-2 border-[#060a14]" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold">{profile?.full_name || user.email?.split('@')[0]}</h3>
              <p className="text-sm text-slate-400">{user.email}</p>
              {profile?.badge && <Badge color="blue" className="mt-2">{profile.badge}</Badge>}
            </div>
            <button onClick={signOut} className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 transition-all">
              <LogOut className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </Card>
      </FadeIn>

      {/* [IMPORTANT FIX #3] Profile stats use explicit color classes, not dynamic */}
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
    </div>
  );
}
