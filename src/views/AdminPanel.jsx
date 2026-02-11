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

// ─── Admin Tabs ───
const TABS = [
  { id: 'overview', label: { en: 'Overview', he: 'סקירה' }, icon: BarChart3 },
  { id: 'verify', label: { en: 'Verify', he: 'אימות' }, icon: Shield },
  { id: 'reports', label: { en: 'Reports', he: 'דיווחים' }, icon: Flag },
  { id: 'orders', label: { en: 'Orders', he: 'הזמנות' }, icon: Package },
  { id: 'users', label: { en: 'Users', he: 'משתמשים' }, icon: Users },
];

export default function AdminPanel() {
  const { lang, setView, profile, showToastMsg } = useApp();
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(false);

  // Data
  const [stats, setStats] = useState(null);
  const [pendingVerifications, setPendingVerifications] = useState([]);
  const [reports, setReports] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [allUsers, setAllUsers] = useState([]);

  if (!profile?.is_admin) {
    return (
      <div className="text-center py-20">
        <Shield className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <p className="text-red-300 font-semibold">{lang === 'he' ? 'אין הרשאה' : 'Access Denied'}</p>
      </div>
    );
  }

  // ─── Load Overview Stats ───
  const loadStats = async () => {
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
    }
  };

  // ─── Load Verifications ───
  const loadVerifications = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email, avatar_url, verification_status, verification_photo_url, created_at')
      .eq('verification_status', 'pending')
      .order('updated_at', { ascending: true });
    setPendingVerifications(data || []);
    setLoading(false);
  };

  // ─── Approve / Reject Verification ───
  const handleVerification = async (userId, approve) => {
    try {
      const update = approve
        ? { verification_status: 'verified', is_verified: true, verified_at: new Date().toISOString() }
        : { verification_status: 'rejected' };

      const { error } = await supabase.from('profiles').update(update).eq('id', userId);
      if (error) throw error;

      showToastMsg(approve
        ? (lang === 'he' ? 'המשתמש אומת!' : 'User verified!')
        : (lang === 'he' ? 'הבקשה נדחתה' : 'Request rejected'));
      setPendingVerifications(prev => prev.filter(p => p.id !== userId));
    } catch (e) {
      console.error('[Admin] Verify error:', e);
    }
  };

  // ─── Load Reports ───
  const loadReports = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('reports')
        .select('*, reporter:profiles!reports_reporter_id_fkey(full_name), listing:listings(id, title, title_hebrew, images, price, seller_id, status)')
        .order('created_at', { ascending: false })
        .limit(50);
      setReports(data || []);
    } catch (e) {
      console.error('[Admin] Reports error:', e);
      setReports([]);
    }
    setLoading(false);
  };

  // ─── Remove listing ───
  const removeListing = async (listingId) => {
    try {
      await supabase.from('listings').update({ status: 'removed' }).eq('id', listingId);
      showToastMsg(lang === 'he' ? 'המודעה הוסרה' : 'Listing removed');
      loadReports();
    } catch (e) {
      console.error('[Admin] Remove error:', e);
    }
  };

  // ─── Dismiss report ───
  const dismissReport = async (reportId) => {
    try {
      await supabase.from('reports').delete().eq('id', reportId);
      setReports(prev => prev.filter(r => r.id !== reportId));
      showToastMsg(lang === 'he' ? 'הדיווח נמחק' : 'Report dismissed');
    } catch (e) {
      console.error('[Admin] Dismiss error:', e);
    }
  };

  // ─── Load Orders ───
  const loadAllOrders = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('orders')
        .select('*, listing:listings(id, title, title_hebrew, images), buyer:profiles!orders_buyer_id_fkey(full_name), seller:profiles!orders_seller_id_fkey(full_name)')
        .order('created_at', { ascending: false })
        .limit(50);
      setAllOrders(data || []);
    } catch (e) {
      console.error('[Admin] Orders error:', e);
    }
    setLoading(false);
  };

  // ─── Load Users ───
  const loadAllUsers = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, avatar_url, is_verified, is_admin, rating, review_count, total_sales, badge, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      setAllUsers(data || []);
    } catch (e) {
      console.error('[Admin] Users error:', e);
    }
    setLoading(false);
  };

  // ─── Admin override order status ───
  const adminUpdateOrder = async (orderId, newStatus) => {
    try {
      const timestamps = {};
      if (newStatus === 'completed') timestamps.completed_at = new Date().toISOString();
      if (newStatus === 'cancelled') {
        timestamps.cancelled_at = new Date().toISOString();
        timestamps.cancelled_by = profile.id;
        timestamps.cancel_reason = 'Admin action';
      }
      await supabase.from('orders').update({ status: newStatus, ...timestamps }).eq('id', orderId);
      showToastMsg(`Order → ${newStatus}`);
      loadAllOrders();
    } catch (e) {
      console.error('[Admin] Order update error:', e);
    }
  };

  // Auto-load on tab change
  useEffect(() => {
    if (tab === 'overview') loadStats();
    if (tab === 'verify') loadVerifications();
    if (tab === 'reports') loadReports();
    if (tab === 'orders') loadAllOrders();
    if (tab === 'users') loadAllUsers();
  }, [tab]);

  const t = (en, he) => lang === 'he' ? he : en;

  return (
    <div className="space-y-5">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center gap-3">
          <button onClick={() => setView('profile')} className="p-2 rounded-xl bg-white/5 hover:bg-white/10">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-400" />
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
                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/30'
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
          <Loader2 className="w-6 h-6 animate-spin text-blue-400 mx-auto" />
        </div>
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
                blue: 'text-blue-400', green: 'text-green-400', emerald: 'text-emerald-400',
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
                onReject={() => handleVerification(user.id, false)}
              />
            ))
          )}
        </div>
      )}

      {/* ═══ REPORTS TAB ═══ */}
      {tab === 'reports' && !loading && (
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
      {tab === 'orders' && !loading && (
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
      {tab === 'users' && !loading && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">{allUsers.length} {t('users', 'משתמשים')}</p>
          {allUsers.map((u) => (
            <FadeIn key={u.id}>
              <Card className="p-3">
                <div className="flex items-center gap-3">
                  {u.avatar_url ? (
                    <img src={u.avatar_url} alt="" className="w-10 h-10 rounded-xl object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-sm font-bold">
                      {u.full_name?.charAt(0) || '?'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold truncate">{u.full_name || 'Anonymous'}</span>
                      {u.is_verified && <CheckCircle className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />}
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
                </div>
              </Card>
            </FadeIn>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Verification Card ───
function VerificationCard({ user, lang, onApprove, onReject }) {
  const [expanded, setExpanded] = useState(false);
  const t = (en, he) => lang === 'he' ? he : en;

  return (
    <FadeIn>
      <Card className="overflow-hidden">
        <div className="p-4">
          <div className="flex items-center gap-3">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="w-12 h-12 rounded-xl object-cover" />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-lg font-bold">
                {user.full_name?.charAt(0) || '?'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{user.full_name || 'Anonymous'}</p>
              <p className="text-xs text-slate-400">{user.email}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{t('Joined', 'הצטרף')} {timeAgo(user.created_at, { ago: t('ago', 'לפני') })}</p>
            </div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10"
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Selfie preview */}
          {expanded && user.verification_photo_url && (
            <div className="mt-3 rounded-xl overflow-hidden border border-white/10">
              <img src={user.verification_photo_url} alt="Verification selfie" className="w-full max-h-64 object-contain bg-black" />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={onApprove}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-sm font-semibold text-emerald-300 flex items-center justify-center gap-1.5 hover:bg-emerald-600/30 transition-all"
            >
              <CheckCircle className="w-4 h-4" />{t('Approve', 'אשר')}
            </button>
            <button
              onClick={onReject}
              className="flex-1 py-2.5 rounded-xl bg-red-600/20 border border-red-500/30 text-sm font-semibold text-red-300 flex items-center justify-center gap-1.5 hover:bg-red-600/30 transition-all"
            >
              <XCircle className="w-4 h-4" />{t('Reject', 'דחה')}
            </button>
          </div>
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
  const t = (en, he) => lang === 'he' ? he : en;

  const statusColors = {
    pending: 'bg-amber-500/15 text-amber-300',
    accepted: 'bg-blue-500/15 text-blue-300',
    shipped: 'bg-blue-500/15 text-blue-300',
    ready_pickup: 'bg-blue-500/15 text-blue-300',
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

            {/* Admin override actions */}
            {order.status !== 'completed' && order.status !== 'cancelled' && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => onUpdate(order.id, 'completed')}
                  className="flex-1 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-[11px] font-semibold text-emerald-300 flex items-center justify-center gap-1"
                >
                  <CheckCircle className="w-3 h-3" />{t('Force Complete', 'השלם')}
                </button>
                <button
                  onClick={() => onUpdate(order.id, 'cancelled')}
                  className="flex-1 py-2 rounded-lg bg-red-600/20 border border-red-500/30 text-[11px] font-semibold text-red-300 flex items-center justify-center gap-1"
                >
                  <XCircle className="w-3 h-3" />{t('Force Cancel', 'בטל')}
                </button>
              </div>
            )}
          </div>
        )}
      </Card>
    </FadeIn>
  );
}