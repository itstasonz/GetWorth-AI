import React, { useEffect, useState, useCallback } from 'react';
import {
  Shield, CheckCircle, XCircle, Clock, Users, ShoppingBag, Flag, Package,
  Star, ArrowLeft, RefreshCw, Loader2, Eye, Trash2, AlertTriangle,
  ChevronDown, ChevronUp, MessageCircle, DollarSign, BarChart3, Image
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, Badge, FadeIn } from '../components/ui';
import { supabase } from '../lib/supabase';
import { formatPrice, timeAgo } from '../lib/utils';
import { fetchAllReviews, fetchReviewsFor } from '../lib/reviews';

// ─── Admin Tabs ───
const TABS = [
  { id: 'overview', label: { en: 'Overview', he: 'סקירה' }, icon: BarChart3 },
  { id: 'verify', label: { en: 'Verify', he: 'אימות' }, icon: Shield },
  { id: 'reports', label: { en: 'Reports', he: 'דיווחים' }, icon: Flag },
  { id: 'orders', label: { en: 'Orders', he: 'הזמנות' }, icon: Package },
  { id: 'users', label: { en: 'Users', he: 'משתמשים' }, icon: Users },
  { id: 'reviews', label: { en: 'Reviews', he: 'ביקורות' }, icon: Star },
];

export default function AdminPanel() {
  const { lang, setView, profile, showToastMsg } = useApp();
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  // ADMIN-001: every loader used to swallow failures (several destructured
  // {data} and never looked at {error}), so an RLS/RPC failure rendered as a
  // convincing empty panel. One error slot per visit; retry re-runs the tab.
  const [loadError, setLoadError] = useState(null);

  // Data
  const [stats, setStats] = useState(null);
  const [pendingVerifications, setPendingVerifications] = useState([]);
  const [reports, setReports] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [allReviews, setAllReviews] = useState([]);
  const [userSearch, setUserSearch] = useState('');

  // ─── Load Overview Stats ───
  const loadStats = async () => {
    setLoadError(null);
    try {
      const [users, listings, orders, reviews, convos, rpts] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('listings').select('id, status, price', { count: 'exact' }),
        supabase.from('orders').select('id, status, price', { count: 'exact' }),
        supabase.from('reviews').select('id', { count: 'exact', head: true }),
        supabase.from('conversations').select('id', { count: 'exact', head: true }),
        supabase.from('reports').select('id', { count: 'exact', head: true }),
      ]);

      const listingsData = listings.data || [];
      const ordersData = orders.data || [];
      const activeListings = listingsData.filter(l => l.status === 'active').length;
      const soldListings = listingsData.filter(l => l.status === 'sold').length;
      const totalValue = listingsData.reduce((s, l) => s + (l.price || 0), 0);
      const completedOrders = ordersData.filter(o => o.status === 'completed');
      const pendingOrders = ordersData.filter(o => o.status === 'pending').length;
      const totalRevenue = completedOrders.reduce((s, o) => s + (o.price || 0), 0);

      setStats({
        totalUsers: users.count || 0,
        totalListings: listings.count || 0,
        activeListings,
        soldListings,
        totalValue,
        totalOrders: orders.count || 0,
        completedOrders: completedOrders.length,
        pendingOrders,
        totalRevenue,
        totalReviews: reviews.count || 0,
        totalConversations: convos.count || 0,
        totalReports: rpts.count || 0,
      });
    } catch (e) {
      console.error('[Admin] Stats error:', e);
      setLoadError('stats');
    }
  };

  // ─── Load Verifications ───
  const loadVerifications = async () => {
    setLoading(true);
    console.log('[Admin] calling admin_list_pending_verifications…');
    const { data, error } = await supabase.rpc('admin_list_pending_verifications');
    if (error) {
      // Log every field so we can diagnose the exact DB error in the console
      console.error('[Admin] loadVerifications failed', {
        code:    error.code,
        message: error.message,
        details: error.details,
        hint:    error.hint,
        full:    error,
      });
      showToastMsg(lang === 'he' ? 'שגיאה בטעינת בקשות האימות' : 'Failed to load verifications', 'error');
      setPendingVerifications([]);
    } else {
      console.log('[Admin] loadVerifications OK — rows:', data?.length ?? 0, 'first:', data?.[0] ?? null);
      setPendingVerifications(data || []);
    }
    setLoading(false);
  };

  // ─── Approve / Reject Verification ───
  const handleVerification = async (userId, approve, rejectionReason) => {
    try {
      const { error } = await supabase.rpc('admin_verify_user', {
        p_user_id: userId,
        p_approve: approve,
        p_rejection_reason: rejectionReason || null,
      });
      if (error) throw error;

      showToastMsg(approve
        ? (lang === 'he' ? 'המשתמש אומת!' : 'User verified!')
        : (lang === 'he' ? 'הבקשה נדחתה' : 'Request rejected'));
      setPendingVerifications(prev => prev.filter(p => p.id !== userId));
    } catch (e) {
      console.error('[Admin] Verify error:', e);
      showToastMsg(lang === 'he' ? 'שגיאה בעדכון האימות' : 'Failed to update verification', 'error');
    }
  };

  // ─── Load Reports ───
  const loadReports = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('reports')
        .select('*, reporter:profiles!reports_reporter_id_fkey(full_name), listing:listings(id, title, title_hebrew, images, price, seller_id, status)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setReports(data || []);
    } catch (e) {
      console.error('[Admin] Reports error:', e);
      setReports([]);
      setLoadError('reports');
    }
    setLoading(false);
  };

  // ─── Remove listing ───
  const removeListing = async (listingId) => {
    try {
      const { error } = await supabase.rpc('admin_remove_listing', { p_listing_id: listingId });
      if (error) throw error;
      showToastMsg(lang === 'he' ? 'המודעה הוסרה' : 'Listing removed');
      loadReports();
    } catch (e) {
      console.error('[Admin] Remove error:', e);
    }
  };

  // ─── Dismiss report ───
  const dismissReport = async (reportId) => {
    try {
      const { error } = await supabase.rpc('admin_dismiss_report', { p_report_id: reportId });
      if (error) throw error;
      setReports(prev => prev.filter(r => r.id !== reportId));
      showToastMsg(lang === 'he' ? 'הדיווח נמחק' : 'Report dismissed');
    } catch (e) {
      console.error('[Admin] Dismiss error:', e);
    }
  };

  // ─── Load Orders ───
  const loadAllOrders = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, listing:listings(id, title, title_hebrew, images), buyer:profiles!orders_buyer_id_fkey(full_name), seller:profiles!orders_seller_id_fkey(full_name)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setAllOrders(data || []);
    } catch (e) {
      console.error('[Admin] Orders error:', e);
      setLoadError('orders');
    }
    setLoading(false);
  };

  // ─── Load Users ───
  const loadAllUsers = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase.rpc('admin_list_users');
      if (error) throw error; // was silently discarded — empty panel with no cause
      setAllUsers(data || []);
    } catch (e) {
      console.error('[Admin] Users error:', e?.code, e?.message, e?.details);
      setLoadError('users');
    }
    setLoading(false);
  };

  // ─── Load Reviews (moderation) ───
  const loadAllReviews = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // FRONTEND-008C: authoritative path — the old profiles!reviewer_id
      // embed 400'd in production (no reviews→profiles FK exists).
      const { rows } = await fetchAllReviews({ limit: 50 });
      setAllReviews(rows);
    } catch (e) {
      console.error('[Admin] Reviews error:', e);
      setLoadError('reviews');
    }
    setLoading(false);
  };

  // ─── Delete review (moderation) ───
  const deleteReview = async (reviewId, reason) => {
    try {
      const { error } = await supabase.rpc('admin_delete_review', {
        p_review_id: reviewId,
        p_reason: reason || null,
      });
      if (error) throw error;
      setAllReviews(prev => prev.filter(r => r.id !== reviewId));
      showToastMsg(lang === 'he' ? 'הביקורת הוסרה' : 'Review removed');
    } catch (e) {
      console.error('[Admin] Delete review error:', e);
      showToastMsg(lang === 'he' ? 'שגיאה בהסרת הביקורת' : 'Failed to remove review', 'error');
    }
  };

  // ─── Admin override order status ───
  const adminUpdateOrder = async (orderId, newStatus) => {
    try {
      const { error } = await supabase.rpc('admin_update_order_status', {
        p_order_id: orderId,
        p_new_status: newStatus,
      });
      if (error) throw error;
      showToastMsg(`Order → ${newStatus}`);
      loadAllOrders();
    } catch (e) {
      console.error('[Admin] Order update error:', e);
    }
  };

  // Auto-load on tab change
  const loadTab = (which) => {
    if (which === 'overview') loadStats();
    if (which === 'verify') loadVerifications();
    if (which === 'reports') loadReports();
    if (which === 'orders') loadAllOrders();
    if (which === 'users') loadAllUsers();
    if (which === 'reviews') loadAllReviews();
  };
  useEffect(() => {
    if (!profile?.is_admin) return;
    loadTab(tab);
  }, [tab, profile?.is_admin]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = (en, he) => lang === 'he' ? he : en;

  const filteredUsers = userSearch.trim()
    ? allUsers.filter(u =>
        (u.full_name || '').toLowerCase().includes(userSearch.trim().toLowerCase())
        || (u.email || '').toLowerCase().includes(userSearch.trim().toLowerCase()))
    : allUsers;

  // Guard is here — after all hooks — so React hook call count stays constant.
  if (!profile?.is_admin) {
    return (
      <div className="text-center py-20">
        <Shield className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <p className="text-red-300 font-semibold">{lang === 'he' ? 'אין הרשאה' : 'Access Denied'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center gap-3">
          <button onClick={() => setView('profile')} className="p-2 rounded-xl bg-white/5 hover:bg-white/10">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-[#6FEEE1]" />
            {t('Admin Panel', 'פאנל ניהול')}
          </h2>
        </div>
      </FadeIn>

      {/* Tab Bar */}
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
              tab === tb.id
                ? 'bg-[#6FEEE1]/10 text-[#6FEEE1] border border-[#6FEEE1]/25'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            <tb.icon className="w-3.5 h-3.5" />
            {tb.label[lang === 'he' ? 'he' : 'en']}
            {tb.id === 'verify' && pendingVerifications.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-red-500 text-[9px] flex items-center justify-center font-bold">{pendingVerifications.length}</span>
            )}
          </button>
        ))}
      </div>

      {loading && (
        <div className="text-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-[#6FEEE1] mx-auto" />
        </div>
      )}

      {/* ADMIN-001: surfaced load failure — never an unexplained empty panel */}
      {loadError && !loading && (
        <Card className="p-4 text-center space-y-2" gradient="linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.04))">
          <AlertTriangle className="w-6 h-6 text-red-400 mx-auto" />
          <p className="text-sm text-red-300">{t('Failed to load data for this tab', 'טעינת הנתונים נכשלה')}</p>
          <button onClick={() => loadTab(tab)} className="text-xs font-semibold underline underline-offset-2" style={{ color: '#6FEEE1' }}>
            {t('Retry', 'נסה שוב')}
          </button>
        </Card>
      )}

      {/* ═══ OVERVIEW TAB ═══ */}
      {tab === 'overview' && stats && !loading && (
        <FadeIn>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: t('Users', 'משתמשים'), value: stats.totalUsers, icon: Users, color: 'blue' },
              { label: t('Active Listings', 'מודעות פעילות'), value: stats.activeListings, icon: ShoppingBag, color: 'green' },
              { label: t('Sold', 'נמכרו'), value: stats.soldListings, icon: CheckCircle, color: 'emerald' },
              { label: t('Orders', 'הזמנות'), value: stats.totalOrders, icon: Package, color: 'purple' },
              { label: t('Completed', 'הושלמו'), value: stats.completedOrders, icon: DollarSign, color: 'green' },
              { label: t('Pending', 'ממתינות'), value: stats.pendingOrders, icon: Clock, color: 'amber' },
              { label: t('Reviews', 'ביקורות'), value: stats.totalReviews, icon: Star, color: 'yellow' },
              { label: t('Chats', 'שיחות'), value: stats.totalConversations, icon: MessageCircle, color: 'cyan' },
              { label: t('Reports', 'דיווחים'), value: stats.totalReports, icon: Flag, color: 'red' },
              { label: t('Revenue', 'הכנסות'), value: formatPrice(stats.totalRevenue), icon: DollarSign, color: 'emerald' },
            ].map((s, i) => {
              const colors = {
                blue: 'text-[#6FEEE1]', green: 'text-green-400', emerald: 'text-emerald-400',
                purple: 'text-purple-400', amber: 'text-amber-400', yellow: 'text-yellow-400',
                cyan: 'text-cyan-400', red: 'text-red-400',
              };
              return (
                <Card key={i} className="p-3.5">
                  <s.icon className={`w-4 h-4 ${colors[s.color]} mb-1.5`} />
                  <p className="text-lg font-bold">{s.value}</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider">{s.label}</p>
                </Card>
              );
            })}
          </div>
          <button onClick={loadStats} className="w-full py-2.5 text-xs text-slate-400 flex items-center justify-center gap-1.5 hover:text-white transition-colors mt-2">
            <RefreshCw className="w-3.5 h-3.5" />{t('Refresh', 'רענן')}
          </button>
        </FadeIn>
      )}

      {/* ═══ VERIFICATION TAB ═══ */}
      {tab === 'verify' && !loading && (
        <div className="space-y-3">
          {pendingVerifications.length === 0 ? (
            <FadeIn>
              <div className="text-center py-12">
                <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">{t('No pending verifications', 'אין אימותים ממתינים')}</p>
              </div>
            </FadeIn>
          ) : (
            pendingVerifications.map((user) => (
              <VerificationCard
                key={user.id}
                user={user}
                lang={lang}
                onApprove={() => handleVerification(user.id, true)}
                onReject={(reason) => handleVerification(user.id, false, reason)}
              />
            ))
          )}
        </div>
      )}

      {/* ═══ REPORTS TAB ═══ */}
      {tab === 'reports' && !loading && !loadError && (
        <div className="space-y-3">
          {reports.length === 0 ? (
            <FadeIn>
              <div className="text-center py-12">
                <Flag className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">{t('No reports', 'אין דיווחים')}</p>
              </div>
            </FadeIn>
          ) : (
            reports.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                lang={lang}
                onRemove={() => removeListing(report.listing?.id)}
                onDismiss={() => dismissReport(report.id)}
              />
            ))
          )}
        </div>
      )}

      {/* ═══ ORDERS TAB ═══ */}
      {tab === 'orders' && !loading && !loadError && (
        <div className="space-y-3">
          {allOrders.length === 0 ? (
            <FadeIn>
              <div className="text-center py-12">
                <Package className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">{t('No orders yet', 'אין הזמנות')}</p>
              </div>
            </FadeIn>
          ) : (
            allOrders.map((order) => (
              <AdminOrderCard
                key={order.id}
                order={order}
                lang={lang}
                onUpdate={adminUpdateOrder}
              />
            ))
          )}
        </div>
      )}

      {/* ═══ USERS TAB ═══ */}
      {tab === 'users' && !loading && !loadError && (
        <div className="space-y-2">
          <input
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder={t('Search name or email...', 'חפש שם או אימייל...')}
            className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6FEEE1]/40"
            dir="auto"
          />
          <p className="text-xs text-slate-500">
            {filteredUsers.length} / {allUsers.length} {t('users', 'משתמשים')}
            {allUsers.length >= 100 && <span className="text-slate-600"> · {t('newest 100 shown', '100 האחרונים')}</span>}
          </p>
          {filteredUsers.length === 0 ? (
            <div className="text-center py-10">
              <Users className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">{allUsers.length === 0 ? t('No users loaded', 'לא נטענו משתמשים') : t('No match', 'אין התאמה')}</p>
            </div>
          ) : (
            filteredUsers.map((u) => <AdminUserCard key={u.id} u={u} lang={lang} />)
          )}
        </div>
      )}

      {/* ═══ REVIEWS TAB (moderation) ═══ */}
      {tab === 'reviews' && !loading && !loadError && (
        <div className="space-y-2">
          {allReviews.length === 0 ? (
            <FadeIn>
              <div className="text-center py-12">
                <Star className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">{t('No reviews yet', 'אין ביקורות')}</p>
              </div>
            </FadeIn>
          ) : (
            allReviews.map((review) => (
              <AdminReviewCard key={review.id} review={review} lang={lang} onDelete={deleteReview} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Admin User Card — expandable detail (ADMIN-001 C2/C3) ───
// Collapsed: identity + reputation summary from admin_list_users.
// Expanded: live counts fetched on demand through the admin-bypass RLS
// policies (listings all-status, orders) and the public reviews policy —
// nothing here invents data the schema doesn't hold.
function AdminUserCard({ u, lang }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState(null); // null=not loaded | 'error' | {…}
  const t = (en, he) => lang === 'he' ? he : en;

  useEffect(() => {
    if (!expanded || detail) return;
    (async () => {
      try {
        const [listings, orders, reviews] = await Promise.all([
          supabase.from('listings').select('id, status', { count: 'exact' }).eq('seller_id', u.id).limit(500),
          supabase.from('orders').select('id, status, buyer_id', { count: 'exact' }).or(`buyer_id.eq.${u.id},seller_id.eq.${u.id}`).limit(500),
          // FRONTEND-008C: authoritative review path (no reviews→profiles FK
          // exists — the old embed 400'd in production)
          fetchReviewsFor(u.id, { limit: 3 }),
        ]);
        if (listings.error || orders.error) throw (listings.error || orders.error);
        const ls = listings.data || [];
        const os = orders.data || [];
        setDetail({
          listingsTotal: listings.count ?? ls.length,
          listingsActive: ls.filter(l => l.status === 'active').length,
          ordersTotal: orders.count ?? os.length,
          ordersAsBuyer: os.filter(o => o.buyer_id === u.id).length,
          recentReviews: reviews.rows,
        });
      } catch (e) {
        console.error('[Admin] User detail error:', e);
        setDetail('error');
      }
    })();
  }, [expanded, detail, u.id]);

  return (
    <FadeIn>
      <Card className="p-3">
        <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
          <div className="flex items-center gap-3">
            {u.avatar_url ? (
              <img src={u.avatar_url} alt="" className="w-10 h-10 rounded-xl object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-600 to-slate-500 flex items-center justify-center text-sm font-bold">
                {u.full_name?.charAt(0) || '?'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold truncate">{u.full_name || 'Anonymous'}</span>
                {u.is_verified && <CheckCircle className="w-3.5 h-3.5 text-[#6FEEE1] flex-shrink-0" />}
                {u.is_admin && <Shield className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />}
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-[10px] text-slate-500">{u.email}</span>
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                {u.rating > 0 && (
                  <span className="text-[10px] text-yellow-400 flex items-center gap-0.5">
                    <Star className="w-2.5 h-2.5 fill-current" />{u.rating} ({u.review_count || 0})
                  </span>
                )}
                <span className="text-[10px] text-slate-500">{u.total_sales || 0} {t('sales', 'מכירות')}</span>
                <span className="text-[10px] text-slate-600">{timeAgo(u.created_at, { ago: t('ago', 'לפני') })}</span>
              </div>
            </div>
            {expanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
          </div>
        </button>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-white/5">
            {detail === null ? (
              <div className="text-center py-3"><Loader2 className="w-4 h-4 animate-spin text-slate-500 mx-auto" /></div>
            ) : detail === 'error' ? (
              <p className="text-xs text-red-300 text-center py-2">{t('Failed to load detail', 'טעינת הפרטים נכשלה')}</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                  <span>{t('Listings', 'מודעות')}: {detail.listingsTotal} ({detail.listingsActive} {t('active', 'פעילות')})</span>
                  <span>{t('Orders', 'הזמנות')}: {detail.ordersTotal} ({detail.ordersAsBuyer} {t('as buyer', 'כקונה')})</span>
                </div>
                {detail.recentReviews.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t('Recent reviews received', 'ביקורות אחרונות')}</p>
                    {detail.recentReviews.map(r => (
                      <div key={r.id} className="bg-white/[0.03] rounded-lg px-2.5 py-1.5">
                        <span className="text-[10px] text-yellow-400">★ {r.rating}</span>
                        <span className="text-[10px] text-slate-400 ml-1.5">{r.reviewer?.full_name || '?'}</span>
                        {r.comment && <p className="text-[11px] text-slate-300 mt-0.5 line-clamp-2">{r.comment}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </FadeIn>
  );
}

// ─── Admin Review Card — moderation via admin_delete_review RPC ───
function AdminReviewCard({ review, lang, onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const t = (en, he) => lang === 'he' ? he : en;

  return (
    <FadeIn>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">{review.reviewer?.full_name || '?'}</span>
              <span className="text-[10px] text-slate-500">→ {review.reviewed?.full_name || '?'}</span>
              <span className="text-xs text-yellow-400">★ {review.rating}</span>
              {review.reviewer_role && (
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-white/5 text-slate-400">{review.reviewer_role}</span>
              )}
            </div>
            {review.comment && <p className="text-sm text-slate-300 mt-1">{review.comment}</p>}
            <div className="flex items-center gap-2 mt-1.5">
              {review.listing?.images?.[0] && <img src={review.listing.images[0]} alt="" className="w-5 h-5 rounded object-cover" />}
              <span className="text-[10px] text-slate-500 truncate">
                {lang === 'he' && review.listing?.title_hebrew ? review.listing.title_hebrew : (review.listing?.title || '')}
              </span>
              <span className="text-[10px] text-slate-600">{timeAgo(review.created_at, { ago: t('ago', 'לפני') })}</span>
            </div>
          </div>
        </div>
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="mt-3 w-full py-2 rounded-xl bg-red-600/10 border border-red-500/20 text-xs font-semibold text-red-300/80 flex items-center justify-center gap-1.5 hover:bg-red-600/20 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />{t('Remove review', 'הסר ביקורת')}
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('Moderation reason (optional)', 'סיבת ההסרה (אופציונלי)')}
              className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-red-400/40"
              dir="auto"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { onDelete(review.id, reason.trim() || null); setConfirming(false); setReason(''); }}
                className="flex-1 py-2 rounded-xl bg-red-600/20 border border-red-500/30 text-xs font-semibold text-red-300 flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />{t('Confirm removal', 'אשר הסרה')}
              </button>
              <button
                onClick={() => { setConfirming(false); setReason(''); }}
                className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-400"
              >
                {t('Cancel', 'ביטול')}
              </button>
            </div>
          </div>
        )}
      </Card>
    </FadeIn>
  );
}

// ─── Verification Card ───
function VerificationCard({ user, lang, onApprove, onReject }) {
  const [expanded, setExpanded] = useState(false);
  const [signedUrl, setSignedUrl] = useState(null);
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const t = (en, he) => lang === 'he' ? he : en;

  useEffect(() => {
    if (!expanded || !user.verification_photo_path || signedUrl) return;
    setLoadingPhoto(true);
    // Signed URL is generated server-side via Edge Function.
    // The function re-verifies is_admin from the DB before using the service role key.
    supabase.functions
      .invoke('admin-get-verification-url', { body: { userId: user.id } })
      .then(({ data, error }) => {
        if (!error && data?.signedUrl) setSignedUrl(data.signedUrl);
        setLoadingPhoto(false);
      });
  }, [expanded, user.verification_photo_path, signedUrl]);

  return (
    <FadeIn>
      <Card className="overflow-hidden">
        <div className="p-4">
          <div className="flex items-center gap-3">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="w-12 h-12 rounded-xl object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-600 to-slate-500 flex items-center justify-center text-lg font-bold">
                {user.full_name?.charAt(0) || '?'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{user.full_name || 'Anonymous'}</p>
              <p className="text-xs text-slate-400">{user.email}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {t('Submitted', 'הוגש')} {timeAgo(user.updated_at || user.created_at, { ago: t('ago', 'לפני') })}
                {' · '}{t('Joined', 'הצטרף')} {timeAgo(user.created_at, { ago: t('ago', 'לפני') })}
              </p>
            </div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10"
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Selfie preview — signed URL only, never a public URL */}
          {expanded && user.verification_photo_path && (
            <div className="mt-3 rounded-xl overflow-hidden border border-white/10 min-h-[3rem] bg-black flex items-center justify-center">
              {loadingPhoto ? (
                <Loader2 className="w-5 h-5 animate-spin text-slate-400 my-6" />
              ) : signedUrl ? (
                <img src={signedUrl} alt="Verification selfie" className="w-full max-h-64 object-contain" />
              ) : (
                <p className="text-xs text-slate-500 py-6">{t('Photo unavailable', 'התמונה אינה זמינה')}</p>
              )}
            </div>
          )}

          {/* Actions */}
          {!rejecting ? (
            <div className="flex gap-2 mt-3">
              <button
                onClick={onApprove}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-sm font-semibold text-emerald-300 flex items-center justify-center gap-1.5 hover:bg-emerald-600/30 transition-all"
              >
                <CheckCircle className="w-4 h-4" />{t('Approve', 'אשר')}
              </button>
              <button
                onClick={() => setRejecting(true)}
                className="flex-1 py-2.5 rounded-xl bg-red-600/20 border border-red-500/30 text-sm font-semibold text-red-300 flex items-center justify-center gap-1.5 hover:bg-red-600/30 transition-all"
              >
                <XCircle className="w-4 h-4" />{t('Reject', 'דחה')}
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder={t('Reason for rejection (optional)', 'סיבת הדחייה (אופציונלי)')}
                rows={2}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-400/40 resize-none"
                dir="auto"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { onReject(rejectionReason.trim() || null); setRejecting(false); setRejectionReason(''); }}
                  className="flex-1 py-2.5 rounded-xl bg-red-600/20 border border-red-500/30 text-sm font-semibold text-red-300 flex items-center justify-center gap-1.5 hover:bg-red-600/30 transition-all"
                >
                  <XCircle className="w-4 h-4" />{t('Confirm Reject', 'אשר דחייה')}
                </button>
                <button
                  onClick={() => { setRejecting(false); setRejectionReason(''); }}
                  className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-400 hover:bg-white/10 transition-all"
                >
                  {t('Cancel', 'ביטול')}
                </button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </FadeIn>
  );
}

// ─── Report Card ───
function ReportCard({ report, lang, onRemove, onDismiss }) {
  const t = (en, he) => lang === 'he' ? he : en;
  const listing = report.listing;

  return (
    <FadeIn>
      <Card className="p-4">
        <div className="flex items-start gap-3">
          {listing?.images?.[0] ? (
            <img src={listing.images[0]} alt="" className="w-14 h-14 rounded-xl object-cover" />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center">
              <Image className="w-6 h-6 text-slate-500" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">
              {lang === 'he' && listing?.title_hebrew ? listing.title_hebrew : (listing?.title || 'Unknown')}
            </p>
            {listing?.price && <p className="text-sm text-emerald-400 font-bold">{formatPrice(listing.price)}</p>}
            <div className="flex items-center gap-2 mt-1">
              <Flag className="w-3 h-3 text-red-400" />
              <span className="text-xs text-red-300">{report.reason}</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {t('By', 'ע"י')} {report.reporter?.full_name || 'User'} · {timeAgo(report.created_at, { ago: t('ago', 'לפני') })}
            </p>
            {listing?.status === 'removed' && (
              <span className="text-[10px] text-red-400 font-medium">{t('Already removed', 'כבר הוסרה')}</span>
            )}
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          {listing?.status !== 'removed' && (
            <button
              onClick={onRemove}
              className="flex-1 py-2 rounded-xl bg-red-600/20 border border-red-500/30 text-xs font-semibold text-red-300 flex items-center justify-center gap-1.5 hover:bg-red-600/30 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />{t('Remove Listing', 'הסר מודעה')}
            </button>
          )}
          <button
            onClick={onDismiss}
            className="flex-1 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-400 flex items-center justify-center gap-1.5 hover:bg-white/10 transition-all"
          >
            <XCircle className="w-3.5 h-3.5" />{t('Dismiss', 'בטל דיווח')}
          </button>
        </div>
      </Card>
    </FadeIn>
  );
}

// ─── Admin Order Card ───
function AdminOrderCard({ order, lang, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // 'completed' | 'cancelled' | null
  const t = (en, he) => lang === 'he' ? he : en;

  const statusColors = {
    pending: 'bg-amber-500/15 text-amber-300',
    accepted: 'bg-[#6FEEE1]/10 text-[#6FEEE1]',
    shipped: 'bg-[#6FEEE1]/10 text-[#6FEEE1]',
    ready_pickup: 'bg-[#6FEEE1]/10 text-[#6FEEE1]',
    delivered: 'bg-emerald-500/15 text-emerald-300',
    completed: 'bg-emerald-500/15 text-emerald-300',
    cancelled: 'bg-red-500/15 text-red-300',
    disputed: 'bg-red-500/15 text-red-300',
  };

  return (
    <FadeIn>
      <Card className="p-4">
        <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
          <div className="flex items-center gap-3">
            {order.listing?.images?.[0] ? (
              <img src={order.listing.images[0]} alt="" className="w-12 h-12 rounded-xl object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center">
                <Package className="w-5 h-5 text-slate-500" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">
                {lang === 'he' && order.listing?.title_hebrew ? order.listing.title_hebrew : (order.listing?.title || 'Order')}
              </p>
              <p className="text-sm font-bold text-emerald-400">{formatPrice(order.price)}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${statusColors[order.status] || ''}`}>
                  {order.status}
                </span>
                <span className="text-[10px] text-slate-500">
                  {order.buyer?.full_name || '?'} → {order.seller?.full_name || '?'}
                </span>
              </div>
            </div>
            {expanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
          </div>
        </button>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
              <span>{t('Delivery', 'מסירה')}: {order.delivery_method}</span>
              <span>{t('Created', 'נוצר')}: {new Date(order.created_at).toLocaleDateString()}</span>
              {order.shipping_address && <span className="col-span-2">{t('Address', 'כתובת')}: {order.shipping_address}</span>}
              {order.buyer_note && <span className="col-span-2">{t('Note', 'הערה')}: {order.buyer_note}</span>}
            </div>

            {/* Admin override actions — ADMIN-001: state-changing overrides
                require an explicit second tap; single-tap force actions on a
                live order were an accidental-click hazard. */}
            {order.status !== 'completed' && order.status !== 'cancelled' && (
              confirmAction ? (
                <div className="mt-2 space-y-1.5">
                  <p className="text-[11px] text-slate-400 text-center">
                    {confirmAction === 'completed'
                      ? t('Force-complete this order?', 'להשלים את ההזמנה בכפייה?')
                      : t('Force-cancel this order?', 'לבטל את ההזמנה בכפייה?')}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { onUpdate(order.id, confirmAction); setConfirmAction(null); }}
                      className={`flex-1 py-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 ${confirmAction === 'completed' ? 'bg-emerald-600/30 border border-emerald-500/40 text-emerald-200' : 'bg-red-600/30 border border-red-500/40 text-red-200'}`}
                    >
                      {confirmAction === 'completed' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {t('Confirm', 'אשר')}
                    </button>
                    <button
                      onClick={() => setConfirmAction(null)}
                      className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-400"
                    >
                      {t('Cancel', 'ביטול')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => setConfirmAction('completed')}
                    className="flex-1 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-[11px] font-semibold text-emerald-300 flex items-center justify-center gap-1"
                  >
                    <CheckCircle className="w-3 h-3" />{t('Force Complete', 'השלם')}
                  </button>
                  <button
                    onClick={() => setConfirmAction('cancelled')}
                    className="flex-1 py-2 rounded-lg bg-red-600/20 border border-red-500/30 text-[11px] font-semibold text-red-300 flex items-center justify-center gap-1"
                  >
                    <XCircle className="w-3 h-3" />{t('Force Cancel', 'בטל')}
                  </button>
                </div>
              )
            )}
          </div>
        )}
      </Card>
    </FadeIn>
  );
}