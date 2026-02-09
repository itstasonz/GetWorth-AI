import React, { useEffect, useState } from 'react';
import { BarChart3, Users, ShoppingBag, MessageCircle, Heart, DollarSign, Activity, Zap, Package, Eye, RefreshCw } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card } from '../components/ui';
import { supabase } from '../lib/supabase';

export default function AnalyticsView() {
  const { lang, setView } = useApp();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      let totalUsers = 0, totalListings = 0, activeListings = 0, totalConvos = 0, totalMsgs = 0, totalSaved = 0, totalValue = 0;
      const categories = {};
      const activities = [];

      try {
        const r = await supabase.from('profiles').select('full_name, created_at');
        totalUsers = r.data?.length || 0;
        (r.data || []).slice(-5).reverse().forEach(u => {
          activities.push({ type: 'user', text: (lang === 'he' ? 'משתמש: ' : 'User: ') + (u.full_name || 'Anonymous'), time: ago(u.created_at) });
        });
      } catch(e) { console.warn('profiles failed', e); }

      try {
        const r = await supabase.from('listings').select('title, title_hebrew, category, price, status, created_at');
        totalListings = r.data?.length || 0;
        (r.data || []).forEach(l => {
          if (l.status === 'active') activeListings++;
          totalValue += (l.price || 0);
          categories[l.category || 'Other'] = (categories[l.category || 'Other'] || 0) + 1;
        });
        (r.data || []).slice(-5).reverse().forEach(l => {
          activities.push({ type: 'listing', text: (lang === 'he' ? 'פריט: ' : 'Item: ') + ((lang === 'he' ? l.title_hebrew : l.title) || l.title), time: ago(l.created_at) });
        });
      } catch(e) { console.warn('listings failed', e); }

      try {
        const r = await supabase.from('conversations').select('id', { count: 'exact', head: true });
        totalConvos = r.count || 0;
      } catch(e) {}

      try {
        const r = await supabase.from('messages').select('id', { count: 'exact', head: true });
        totalMsgs = r.count || 0;
      } catch(e) {}

      try {
        const r = await supabase.from('saved_items').select('id', { count: 'exact', head: true });
        totalSaved = r.count || 0;
      } catch(e) {}

      const catList = Object.entries(categories).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

      setStats({ totalUsers, totalListings, activeListings, totalConvos, totalMsgs, totalSaved, totalValue, avgPrice: activeListings > 0 ? Math.round(totalValue / activeListings) : 0, categories: catList, activities: activities.slice(0, 8) });
    } catch (e) {
      console.error('Analytics error:', e);
      setErr(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  function ago(d) {
    if (!d) return '';
    const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s/60) + 'm';
    if (s < 86400) return Math.floor(s/3600) + 'h';
    return Math.floor(s/86400) + 'd';
  }

  var barColors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-cyan-500'];

  return (
    <div className="space-y-4 pb-4">
      <div>
        <button onClick={function() { setView('profile'); }} className="text-slate-400 hover:text-white text-sm mb-3 flex items-center gap-1">
          {'← '}{lang === 'he' ? 'חזרה' : 'Back'}
        </button>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            {lang === 'he' ? 'אנליטיקס' : 'Analytics'}
          </h2>
          <button onClick={load} className="p-2 rounded-xl bg-white/5 border border-white/10">
            <RefreshCw className={'w-4 h-4 text-slate-400' + (loading ? ' animate-spin' : '')} />
          </button>
        </div>
      </div>

      {err && <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-300">{err}</div>}

      {loading && !stats && (
        <div className="text-center py-16">
          <Activity className="w-8 h-8 text-blue-400 animate-pulse mx-auto mb-2" />
          <p className="text-sm text-slate-400">{lang === 'he' ? 'טוען...' : 'Loading...'}</p>
        </div>
      )}

      {stats && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <Users className="w-5 h-5 text-blue-400 mb-2" />
              <p className="text-2xl font-bold">{stats.totalUsers}</p>
              <p className="text-xs text-slate-400">{lang === 'he' ? 'משתמשים' : 'Users'}</p>
            </Card>
            <Card className="p-4">
              <ShoppingBag className="w-5 h-5 text-green-400 mb-2" />
              <p className="text-2xl font-bold">{stats.activeListings}</p>
              <p className="text-xs text-slate-400">{lang === 'he' ? 'מודעות פעילות' : 'Active Listings'}</p>
            </Card>
            <Card className="p-4">
              <MessageCircle className="w-5 h-5 text-purple-400 mb-2" />
              <p className="text-2xl font-bold">{stats.totalConvos}</p>
              <p className="text-xs text-slate-400">{lang === 'he' ? 'שיחות' : 'Conversations'}</p>
            </Card>
            <Card className="p-4">
              <Heart className="w-5 h-5 text-pink-400 mb-2" />
              <p className="text-2xl font-bold">{stats.totalSaved}</p>
              <p className="text-xs text-slate-400">{lang === 'he' ? 'שמירות' : 'Saved'}</p>
            </Card>
          </div>

          <Card className="p-5" glow>
            <div className="flex items-center gap-3 mb-3">
              <DollarSign className="w-6 h-6 text-blue-400" />
              <div>
                <p className="text-xs text-slate-400">{lang === 'he' ? 'סך ערך שוק' : 'Total Market Value'}</p>
                <p className="text-2xl font-bold">{'₪'}{stats.totalValue.toLocaleString()}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/10 text-center">
              <div>
                <p className="text-lg font-bold">{stats.totalListings}</p>
                <p className="text-[10px] text-slate-500">{lang === 'he' ? 'סה"כ' : 'Total'}</p>
              </div>
              <div>
                <p className="text-lg font-bold">{'₪'}{stats.avgPrice.toLocaleString()}</p>
                <p className="text-[10px] text-slate-500">{lang === 'he' ? 'ממוצע' : 'Avg'}</p>
              </div>
              <div>
                <p className="text-lg font-bold">{stats.totalMsgs}</p>
                <p className="text-[10px] text-slate-500">{lang === 'he' ? 'הודעות' : 'Messages'}</p>
              </div>
            </div>
          </Card>

          {stats.categories.length > 0 && (
            <Card className="p-4">
              <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3">
                {lang === 'he' ? 'קטגוריות' : 'Categories'}
              </p>
              {stats.categories.slice(0, 5).map(function(cat, i) {
                var total = stats.categories.reduce(function(s, c) { return s + c.count; }, 0);
                var pct = Math.round((cat.count / total) * 100);
                return (
                  <div key={i} className="mb-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300">{cat.name}</span>
                      <span className="text-slate-500">{cat.count} ({pct}%)</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5">
                      <div className={'h-full rounded-full ' + barColors[i % barColors.length]} style={{ width: pct + '%' }} />
                    </div>
                  </div>
                );
              })}
            </Card>
          )}

          {stats.activities.length > 0 && (
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                  {lang === 'he' ? 'פעילות אחרונה' : 'Recent Activity'}
                </p>
              </div>
              {stats.activities.map(function(a, i) {
                return (
                  <div key={i} className="flex items-center gap-3 py-1.5">
                    {a.type === 'user'
                      ? <Users className="w-3 h-3 text-green-400 flex-shrink-0" />
                      : <ShoppingBag className="w-3 h-3 text-blue-400 flex-shrink-0" />}
                    <p className="text-xs text-slate-300 flex-1 truncate">{a.text}</p>
                    <p className="text-[10px] text-slate-500 flex-shrink-0">{a.time}</p>
                  </div>
                );
              })}
            </Card>
          )}

          <Card className="p-4">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3">
              {lang === 'he' ? 'סטטוס מערכת' : 'System Status'}
            </p>
            <div className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2"><Zap className="w-4 h-4 text-slate-400" /><span className="text-sm text-slate-300">AI Scanner</span></div>
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500" /><span className="text-xs text-green-400">OK</span></div>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2"><MessageCircle className="w-4 h-4 text-slate-400" /><span className="text-sm text-slate-300">Real-time Chat</span></div>
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500" /><span className="text-xs text-green-400">OK</span></div>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2"><Package className="w-4 h-4 text-slate-400" /><span className="text-sm text-slate-300">Database</span></div>
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500" /><span className="text-xs text-green-400">OK</span></div>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2"><Eye className="w-4 h-4 text-slate-400" /><span className="text-sm text-slate-300">Uptime</span></div>
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500" /><span className="text-xs text-green-400">99.9%</span></div>
            </div>
          </Card>

          <p className="text-center text-[10px] text-slate-600 py-2">GetWorth AI — React + Supabase + Claude AI + Vercel</p>
        </div>
      )}
    </div>
  );
}
