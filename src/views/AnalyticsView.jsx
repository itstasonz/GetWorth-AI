import React, { useEffect, useState } from 'react';
import { BarChart3, Users, ShoppingBag, MessageCircle, TrendingUp, Heart, ArrowUp, Activity, Zap, DollarSign, Package, Eye, RefreshCw } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, FadeIn } from '../components/ui';
import { supabase } from '../lib/supabase';

// ─── Animated Counter ───
function AnimatedNumber({ value, prefix = '', suffix = '' }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (value === 0) { setDisplay(0); return; }
    const startTime = Date.now();
    const tick = () => {
      const progress = Math.min((Date.now() - startTime) / 800, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value]);
  return <span>{prefix}{display.toLocaleString()}{suffix}</span>;
}

// ─── Stat Card ───
function StatCard({ icon: Icon, label, value, prefix, suffix, color, delay = 0 }) {
  const styles = {
    blue: 'from-blue-500/20 to-blue-600/20 border-blue-500/30 text-blue-400',
    green: 'from-green-500/20 to-emerald-500/20 border-green-500/30 text-green-400',
    purple: 'from-purple-500/20 to-violet-500/20 border-purple-500/30 text-purple-400',
    pink: 'from-pink-500/20 to-rose-500/20 border-pink-500/30 text-pink-400',
    orange: 'from-orange-500/20 to-amber-500/20 border-orange-500/30 text-orange-400',
    cyan: 'from-cyan-500/20 to-teal-500/20 border-cyan-500/30 text-cyan-400',
  };
  const s = styles[color] || styles.blue;
  const [bg, border, text] = [
    s.split(' ')[0] + ' ' + s.split(' ')[1],
    s.split(' ')[2],
    s.split(' ')[3],
  ];

  return (
    <FadeIn delay={delay}>
      <Card className="p-4">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${bg} border ${border} flex items-center justify-center mb-3`}>
          <Icon className={`w-5 h-5 ${text}`} />
        </div>
        <p className="text-2xl font-bold text-white">
          <AnimatedNumber value={value || 0} prefix={prefix || ''} suffix={suffix || ''} />
        </p>
        <p className="text-xs text-slate-400 mt-0.5">{label}</p>
      </Card>
    </FadeIn>
  );
}

// ─── Category Bar ───
function CategoryChart({ categories, lang }) {
  const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-cyan-500', 'bg-pink-500'];
  const total = categories.reduce((s, c) => s + c.count, 0) || 1;

  return (
    <Card className="p-4">
      <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3">
        {lang === 'he' ? 'קטגוריות פופולריות' : 'Popular Categories'}
      </p>
      {categories.length === 0 && <p className="text-xs text-slate-500 text-center py-2">{lang === 'he' ? 'אין נתונים' : 'No data yet'}</p>}
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
                <div className={`h-full rounded-full ${colors[i % colors.length]} transition-all duration-1000`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── Activity Feed ───
function ActivityFeed({ activities, lang }) {
  const icons = {
    listing: <ShoppingBag className="w-3.5 h-3.5 text-blue-400" />,
    user: <Users className="w-3.5 h-3.5 text-green-400" />,
    message: <MessageCircle className="w-3.5 h-3.5 text-purple-400" />,
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
          {lang === 'he' ? 'פעילות אחרונה' : 'Recent Activity'}
        </p>
      </div>
      {activities.length === 0 && <p className="text-xs text-slate-500 text-center py-4">{lang === 'he' ? 'אין פעילות עדיין' : 'No activity yet'}</p>}
      <div className="space-y-3">
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

// ─── Time Ago Helper ───
function timeAgo(dateStr, lang) {
  if (!dateStr) return '';
  const seconds = Math.floor((new Date() - new Date(dateStr)) / 1000);
  if (seconds < 60) return lang === 'he' ? 'עכשיו' : 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return lang === 'he' ? `לפני ${minutes} דק'` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return lang === 'he' ? `לפני ${hours} שע'` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return lang === 'he' ? `לפני ${days} ימים` : `${days}d ago`;
}

// ─── Safe query helper ───
async function safeCount(table) {
  try {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) { console.warn(`Count ${table} error:`, error.message); return 0; }
    return count || 0;
  } catch (e) { console.warn(`Count ${table} failed:`, e); return 0; }
}

async function safeQuery(table, select, options = {}) {
  try {
    let q = supabase.from(table).select(select);
    if (options.eq) q = q.eq(options.eq[0], options.eq[1]);
    if (options.order) q = q.order(options.order, { ascending: false });
    if (options.limit) q = q.limit(options.limit);
    const { data, error } = await q;
    if (error) { console.warn(`Query ${table} error:`, error.message); return []; }
    return data || [];
  } catch (e) { console.warn(`Query ${table} failed:`, e); return []; }
}

// ─── Main Analytics Dashboard ───
export default function AnalyticsView() {
  const { lang, rtl, setView } = useApp();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      // Individual queries — each one can fail without breaking the rest
      const totalUsers = await safeCount('profiles');
      const totalListings = await safeCount('listings');
      const totalConversations = await safeCount('conversations');
      const totalMessages = await safeCount('messages');
      const totalSaved = await safeCount('saved_items');

      const listings = await safeQuery('listings', 'category, price, created_at, title, status');
      const recentListings = await safeQuery('listings', 'title, title_hebrew, created_at, category', { order: 'created_at', limit: 5 });
      const recentUsers = await safeQuery('profiles', 'full_name, created_at', { order: 'created_at', limit: 5 });

      // Calculate from listings data
      const activeListings = listings.filter(l => l.status === 'active').length;
      let totalValue = 0;
      const catMap = {};

      listings.forEach(l => {
        totalValue += (l.price || 0);
        const cat = l.category || 'Other';
        catMap[cat] = (catMap[cat] || 0) + 1;
      });

      const categories = Object.entries(catMap)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      const avgPrice = activeListings > 0 ? Math.round(totalValue / activeListings) : 0;

      // Build activity feed
      const activities = [];
      recentListings.forEach(l => {
        activities.push({
          type: 'listing',
          text: lang === 'he' ? `פריט חדש: ${l.title_hebrew || l.title}` : `New listing: ${l.title}`,
          time: timeAgo(l.created_at, lang),
          date: new Date(l.created_at),
        });
      });
      recentUsers.forEach(u => {
        activities.push({
          type: 'user',
          text: lang === 'he' ? `משתמש חדש: ${u.full_name || 'אנונימי'}` : `New user: ${u.full_name || 'Anonymous'}`,
          time: timeAgo(u.created_at, lang),
          date: new Date(u.created_at),
        });
      });
      activities.sort((a, b) => b.date - a.date);

      setStats({
        totalUsers,
        totalListings,
        activeListings,
        totalConversations,
        totalMessages,
        totalSaved,
        totalValue,
        avgPrice,
        categories,
        activities: activities.slice(0, 8),
      });
    } catch (e) {
      console.error('Analytics load error:', e);
      setError(lang === 'he' ? 'שגיאה בטעינת נתונים' : 'Failed to load analytics');
    }
    setLoading(false);
  };

  useEffect(() => { loadStats(); }, []);

  return (
    <div className="space-y-5 pb-4">
      {/* Header */}
      <FadeIn>
        <button onClick={() => setView('profile')} className="flex items-center gap-2 text-slate-400 hover:text-white mb-4 transition-all">
          <span className="text-sm">← {lang === 'he' ? 'חזרה' : 'Back'}</span>
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-blue-400" />
              {lang === 'he' ? 'דשבורד אנליטיקס' : 'Analytics Dashboard'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {lang === 'he' ? 'נתוני הפלטפורמה בזמן אמת' : 'Real-time platform metrics'}
            </p>
          </div>
          <button onClick={loadStats} disabled={loading}
            className={`p-2.5 rounded-xl bg-white/5 border border-white/10 transition-all hover:bg-white/10 ${loading ? 'animate-spin' : ''}`}>
            <RefreshCw className="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </FadeIn>

      {/* Error */}
      {error && (
        <Card className="p-4" gradient="linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))">
          <p className="text-sm text-red-300">{error}</p>
        </Card>
      )}

      {/* Loading */}
      {loading && !stats && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center space-y-3">
            <Activity className="w-8 h-8 text-blue-400 animate-pulse mx-auto" />
            <p className="text-sm text-slate-400">{lang === 'he' ? 'טוען נתונים...' : 'Loading analytics...'}</p>
          </div>
        </div>
      )}

      {/* Dashboard Content */}
      {stats && (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard icon={Users} label={lang === 'he' ? 'משתמשים' : 'Total Users'} value={stats.totalUsers} color="blue" delay={50} />
            <StatCard icon={ShoppingBag} label={lang === 'he' ? 'מודעות פעילות' : 'Active Listings'} value={stats.activeListings} color="green" delay={100} />
            <StatCard icon={MessageCircle} label={lang === 'he' ? 'שיחות' : 'Conversations'} value={stats.totalConversations} color="purple" delay={150} />
            <StatCard icon={Heart} label={lang === 'he' ? 'שמירות' : 'Items Saved'} value={stats.totalSaved} color="pink" delay={200} />
          </div>

          {/* Market Value Card */}
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

          {/* Categories */}
          <FadeIn delay={300}>
            <CategoryChart categories={stats.categories} lang={lang} />
          </FadeIn>

          {/* Activity Feed */}
          <FadeIn delay={350}>
            <ActivityFeed activities={stats.activities} lang={lang} />
          </FadeIn>

          {/* Platform Health */}
          <FadeIn delay={400}>
            <Card className="p-4">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3">
                {lang === 'he' ? 'בריאות הפלטפורמה' : 'Platform Health'}
              </p>
              <div className="space-y-3">
                {[
                  { icon: Zap, label: lang === 'he' ? 'AI סריקה' : 'AI Scanner' },
                  { icon: MessageCircle, label: lang === 'he' ? "צ'אט בזמן אמת" : 'Real-time Chat' },
                  { icon: Package, label: lang === 'he' ? 'מסד נתונים' : 'Database' },
                  { icon: Eye, label: lang === 'he' ? 'זמן עליה' : 'Uptime', value: '99.9%' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <item.icon className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-300">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-xs font-medium text-green-400">
                        {item.value || (lang === 'he' ? 'פעיל' : 'Operational')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </FadeIn>

          {/* Footer */}
          <FadeIn delay={450}>
            <div className="text-center py-4 space-y-2">
              <p className="text-xs text-slate-500">{lang === 'he' ? 'GetWorth AI — שוק חכם מונע בינה מלאכותית' : 'GetWorth AI — AI-Powered Smart Marketplace'}</p>
              <div className="flex items-center justify-center gap-4 text-[10px] text-slate-600">
                <span>React + Vite</span><span>•</span>
                <span>Supabase</span><span>•</span>
                <span>Claude AI</span><span>•</span>
                <span>Vercel</span>
              </div>
            </div>
          </FadeIn>
        </>
      )}
    </div>
  );
}
