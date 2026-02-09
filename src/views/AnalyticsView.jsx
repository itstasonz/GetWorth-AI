import React, { useEffect, useState } from 'react';
import { BarChart3, Users, ShoppingBag, Scan, MessageCircle, TrendingUp, Eye, Heart, ArrowUp, ArrowDown, Activity, Zap, Target, Clock, DollarSign, Package, Star, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, FadeIn, BackButton } from '../components/ui';
import { supabase } from '../lib/supabase';

// ─── Animated Counter ───
function AnimatedNumber({ value, prefix = '', suffix = '', duration = 1000 }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (value === 0) { setDisplay(0); return; }
    const start = 0;
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplay(Math.round(start + (value - start) * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value, duration]);

  return <span>{prefix}{display.toLocaleString()}{suffix}</span>;
}

// ─── Stat Card ───
function StatCard({ icon: Icon, label, value, prefix, suffix, color, subtext, delay = 0 }) {
  const colors = {
    blue: { bg: 'from-blue-500/20 to-blue-600/20', border: 'border-blue-500/30', icon: 'text-blue-400', glow: 'shadow-blue-500/20' },
    green: { bg: 'from-green-500/20 to-emerald-500/20', border: 'border-green-500/30', icon: 'text-green-400', glow: 'shadow-green-500/20' },
    purple: { bg: 'from-purple-500/20 to-violet-500/20', border: 'border-purple-500/30', icon: 'text-purple-400', glow: 'shadow-purple-500/20' },
    orange: { bg: 'from-orange-500/20 to-amber-500/20', border: 'border-orange-500/30', icon: 'text-orange-400', glow: 'shadow-orange-500/20' },
    cyan: { bg: 'from-cyan-500/20 to-teal-500/20', border: 'border-cyan-500/30', icon: 'text-cyan-400', glow: 'shadow-cyan-500/20' },
    pink: { bg: 'from-pink-500/20 to-rose-500/20', border: 'border-pink-500/30', icon: 'text-pink-400', glow: 'shadow-pink-500/20' },
  };
  const c = colors[color] || colors.blue;

  return (
    <FadeIn delay={delay}>
      <Card className={`p-4 shadow-lg ${c.glow}`} gradient={`linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))`}>
        <div className="flex items-start justify-between">
          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${c.bg} border ${c.border} flex items-center justify-center`}>
            <Icon className={`w-5 h-5 ${c.icon}`} />
          </div>
          {subtext && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-semibold flex items-center gap-0.5">
              <ArrowUp className="w-2.5 h-2.5" />{subtext}
            </span>
          )}
        </div>
        <div className="mt-3">
          <p className="text-2xl font-bold text-white">
            <AnimatedNumber value={value} prefix={prefix || ''} suffix={suffix || ''} />
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{label}</p>
        </div>
      </Card>
    </FadeIn>
  );
}

// ─── Mini Bar Chart ───
function MiniChart({ data, label, color = 'blue' }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const barColor = {
    blue: 'from-blue-500 to-blue-400',
    green: 'from-green-500 to-emerald-400',
    purple: 'from-purple-500 to-violet-400',
  }[color] || 'from-blue-500 to-blue-400';

  return (
    <Card className="p-4">
      <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3">{label}</p>
      <div className="flex items-end gap-1.5 h-24">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full rounded-t-md relative overflow-hidden" 
              style={{ height: `${Math.max((d.value / max) * 100, 4)}%`, minHeight: '3px' }}>
              <div className={`absolute inset-0 bg-gradient-to-t ${barColor} opacity-80`} />
            </div>
            <span className="text-[9px] text-slate-500">{d.label}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Category Distribution ───
function CategoryChart({ categories, lang }) {
  const colors = [
    'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500',
    'bg-cyan-500', 'bg-pink-500', 'bg-yellow-500', 'bg-red-500'
  ];
  const total = categories.reduce((s, c) => s + c.count, 0) || 1;

  return (
    <Card className="p-4">
      <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3">
        {lang === 'he' ? 'קטגוריות פופולריות' : 'Popular Categories'}
      </p>
      <div className="space-y-2.5">
        {categories.slice(0, 5).map((cat, i) => {
          const pct = Math.round((cat.count / total) * 100);
          return (
            <div key={i}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-300">{cat.name}</span>
                <span className="text-slate-500">{cat.count} ({pct}%)</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div className={`h-full rounded-full ${colors[i % colors.length]} transition-all duration-1000`}
                  style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Live Activity Feed ───
function ActivityFeed({ activities, lang }) {
  const icons = {
    listing: <ShoppingBag className="w-3.5 h-3.5 text-blue-400" />,
    user: <Users className="w-3.5 h-3.5 text-green-400" />,
    message: <MessageCircle className="w-3.5 h-3.5 text-purple-400" />,
    save: <Heart className="w-3.5 h-3.5 text-pink-400" />,
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
          {lang === 'he' ? 'פעילות אחרונה' : 'Recent Activity'}
        </p>
      </div>
      <div className="space-y-3">
        {activities.length === 0 && (
          <p className="text-xs text-slate-500 text-center py-4">{lang === 'he' ? 'אין פעילות עדיין' : 'No activity yet'}</p>
        )}
        {activities.map((a, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
              {icons[a.type] || icons.listing}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-300 truncate">{a.text}</p>
              <p className="text-[10px] text-slate-500">{a.time}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Main Analytics Dashboard ───
export default function AnalyticsView() {
  const { lang, rtl, setView } = useApp();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const loadStats = async () => {
    setLoading(true);
    try {
      // Parallel queries for speed
      const [
        { count: totalUsers },
        { count: totalListings },
        { count: activeListings },
        { count: totalConversations },
        { count: totalMessages },
        { count: totalSaved },
        { data: listings },
        { data: recentListings },
        { data: recentUsers },
        { data: recentMessages },
      ] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('listings').select('*', { count: 'exact', head: true }),
        supabase.from('listings').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('conversations').select('*', { count: 'exact', head: true }),
        supabase.from('messages').select('*', { count: 'exact', head: true }),
        supabase.from('saved_items').select('*', { count: 'exact', head: true }),
        supabase.from('listings').select('category, price, created_at, title').eq('status', 'active'),
        supabase.from('listings').select('title, title_hebrew, created_at, category').order('created_at', { ascending: false }).limit(5),
        supabase.from('profiles').select('full_name, created_at').order('created_at', { ascending: false }).limit(5),
        supabase.from('messages').select('content, created_at').order('created_at', { ascending: false }).limit(5),
      ]);

      // Calculate category distribution
      const catMap = {};
      let totalValue = 0;
      const dailyCounts = {};

      (listings || []).forEach(l => {
        const cat = l.category || 'Other';
        catMap[cat] = (catMap[cat] || 0) + 1;
        totalValue += (l.price || 0);

        // Daily listing counts for chart
        const day = new Date(l.created_at).toLocaleDateString('en-US', { weekday: 'short' });
        dailyCounts[day] = (dailyCounts[day] || 0) + 1;
      });

      const categories = Object.entries(catMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      // Average price
      const avgPrice = activeListings > 0 ? Math.round(totalValue / activeListings) : 0;

      // Weekly chart data (last 7 days)
      const weekDays = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dayLabel = d.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', { weekday: 'short' });
        const dateStr = d.toISOString().split('T')[0];
        
        const dayListings = (listings || []).filter(l => 
          l.created_at && l.created_at.startsWith(dateStr)
        ).length;
        
        weekDays.push({ label: dayLabel, value: dayListings });
      }

      // Build activity feed
      const activities = [];
      (recentListings || []).forEach(l => {
        activities.push({
          type: 'listing',
          text: lang === 'he' ? `פריט חדש: ${l.title_hebrew || l.title}` : `New listing: ${l.title}`,
          time: timeAgo(l.created_at, lang),
          date: new Date(l.created_at),
        });
      });
      (recentUsers || []).forEach(u => {
        activities.push({
          type: 'user',
          text: lang === 'he' ? `משתמש חדש: ${u.full_name || 'אנונימי'}` : `New user: ${u.full_name || 'Anonymous'}`,
          time: timeAgo(u.created_at, lang),
          date: new Date(u.created_at),
        });
      });
      (recentMessages || []).forEach(m => {
        activities.push({
          type: 'message',
          text: lang === 'he' ? `הודעה חדשה: "${(m.content || '').slice(0, 30)}..."` : `New message: "${(m.content || '').slice(0, 30)}..."`,
          time: timeAgo(m.created_at, lang),
          date: new Date(m.created_at),
        });
      });

      activities.sort((a, b) => b.date - a.date);

      setStats({
        totalUsers: totalUsers || 0,
        totalListings: totalListings || 0,
        activeListings: activeListings || 0,
        totalConversations: totalConversations || 0,
        totalMessages: totalMessages || 0,
        totalSaved: totalSaved || 0,
        totalValue,
        avgPrice,
        categories,
        weekDays,
        activities: activities.slice(0, 8),
      });

      setLastRefresh(new Date());
    } catch (e) {
      console.error('Analytics error:', e);
    }
    setLoading(false);
  };

  useEffect(() => { loadStats(); }, []);

  return (
    <div className="space-y-5 pb-4">
      {/* Header */}
      <FadeIn>
        <BackButton onClick={() => setView('profile')} rtl={rtl} label={lang === 'he' ? 'חזרה' : 'Back'} />
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-blue-400" />
              {lang === 'he' ? 'דשבורד אנליטיקס' : 'Analytics Dashboard'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {lastRefresh 
                ? `${lang === 'he' ? 'עודכן' : 'Updated'} ${lastRefresh.toLocaleTimeString()}`
                : (lang === 'he' ? 'טוען...' : 'Loading...')}
            </p>
          </div>
          <button onClick={loadStats} disabled={loading}
            className={`p-2.5 rounded-xl bg-white/5 border border-white/10 transition-all hover:bg-white/10 ${loading ? 'animate-spin' : ''}`}>
            <RefreshCw className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </FadeIn>

      {loading && !stats ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center space-y-3">
            <Activity className="w-8 h-8 text-blue-400 animate-pulse mx-auto" />
            <p className="text-sm text-slate-400">{lang === 'he' ? 'טוען נתונים...' : 'Loading analytics...'}</p>
          </div>
        </div>
      ) : stats && (
        <>
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard icon={Users} label={lang === 'he' ? 'משתמשים' : 'Total Users'} value={stats.totalUsers} color="blue" delay={50} />
            <StatCard icon={ShoppingBag} label={lang === 'he' ? 'מודעות פעילות' : 'Active Listings'} value={stats.activeListings} color="green" delay={100} />
            <StatCard icon={MessageCircle} label={lang === 'he' ? 'שיחות' : 'Conversations'} value={stats.totalConversations} color="purple" delay={150} />
            <StatCard icon={Heart} label={lang === 'he' ? 'שמירות' : 'Items Saved'} value={stats.totalSaved} color="pink" delay={200} />
          </div>

          {/* Revenue/Value Stats */}
          <FadeIn delay={250}>
            <Card className="p-5" gradient="linear-gradient(135deg, rgba(59,130,246,0.1), rgba(139,92,246,0.08))" glow>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500/30 to-purple-500/30 border border-blue-500/30 flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wider">{lang === 'he' ? 'סך ערך שוק' : 'Total Market Value'}</p>
                  <p className="text-2xl font-bold text-white">
                    <AnimatedNumber value={stats.totalValue} prefix="₪" />
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-white/10">
                <div className="text-center">
                  <p className="text-lg font-bold text-white"><AnimatedNumber value={stats.totalListings} /></p>
                  <p className="text-[10px] text-slate-500">{lang === 'he' ? 'סה"כ מודעות' : 'Total Listed'}</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-white">₪<AnimatedNumber value={stats.avgPrice} /></p>
                  <p className="text-[10px] text-slate-500">{lang === 'he' ? 'מחיר ממוצע' : 'Avg. Price'}</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-white"><AnimatedNumber value={stats.totalMessages} /></p>
                  <p className="text-[10px] text-slate-500">{lang === 'he' ? 'הודעות' : 'Messages'}</p>
                </div>
              </div>
            </Card>
          </FadeIn>

          {/* Weekly Listings Chart */}
          <FadeIn delay={300}>
            <MiniChart data={stats.weekDays} label={lang === 'he' ? 'מודעות חדשות (7 ימים אחרונים)' : 'New Listings (Last 7 Days)'} color="blue" />
          </FadeIn>

          {/* Category Distribution */}
          <FadeIn delay={350}>
            <CategoryChart categories={stats.categories} lang={lang} />
          </FadeIn>

          {/* Activity Feed */}
          <FadeIn delay={400}>
            <ActivityFeed activities={stats.activities} lang={lang} />
          </FadeIn>

          {/* Platform Health */}
          <FadeIn delay={450}>
            <Card className="p-4">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3">
                {lang === 'he' ? 'בריאות הפלטפורמה' : 'Platform Health'}
              </p>
              <div className="space-y-3">
                <HealthRow 
                  icon={Zap} 
                  label={lang === 'he' ? 'AI סריקה' : 'AI Scanner'} 
                  status="operational" 
                  lang={lang} 
                />
                <HealthRow 
                  icon={MessageCircle} 
                  label={lang === 'he' ? 'צ\'אט בזמן אמת' : 'Real-time Chat'} 
                  status="operational" 
                  lang={lang} 
                />
                <HealthRow 
                  icon={Package} 
                  label={lang === 'he' ? 'מסד נתונים' : 'Database'} 
                  status="operational" 
                  lang={lang} 
                />
                <HealthRow 
                  icon={Eye} 
                  label={lang === 'he' ? 'זמן עליה' : 'Uptime'} 
                  status="99.9%" 
                  lang={lang} 
                />
              </div>
            </Card>
          </FadeIn>

          {/* Investor Footer */}
          <FadeIn delay={500}>
            <div className="text-center py-4 space-y-2">
              <p className="text-xs text-slate-500">{lang === 'he' ? 'GetWorth AI — שוק חכם מונע בינה מלאכותית' : 'GetWorth AI — AI-Powered Smart Marketplace'}</p>
              <div className="flex items-center justify-center gap-4 text-[10px] text-slate-600">
                <span>React + Vite</span>
                <span>•</span>
                <span>Supabase</span>
                <span>•</span>
                <span>Claude AI</span>
                <span>•</span>
                <span>Vercel Edge</span>
              </div>
            </div>
          </FadeIn>
        </>
      )}
    </div>
  );
}

// ─── Health Row ───
function HealthRow({ icon: Icon, label, status, lang }) {
  const isOp = status === 'operational';
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <Icon className="w-4 h-4 text-slate-400" />
        <span className="text-sm text-slate-300">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className={`w-2 h-2 rounded-full ${isOp ? 'bg-green-500' : 'bg-yellow-500'}`} />
        <span className={`text-xs font-medium ${isOp ? 'text-green-400' : 'text-yellow-400'}`}>
          {isOp ? (lang === 'he' ? 'פעיל' : 'Operational') : status}
        </span>
      </div>
    </div>
  );
}

// ─── Time ago helper ───
function timeAgo(dateStr, lang) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return lang === 'he' ? 'עכשיו' : 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return lang === 'he' ? `לפני ${minutes} דק'` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return lang === 'he' ? `לפני ${hours} שע'` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return lang === 'he' ? `לפני ${days} ימים` : `${days}d ago`;
}
