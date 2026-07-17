// ═══════════════════════════════════════════════════════
// NOTIFICATIONS PANEL — bell overlay (FRONTEND-009, Phase 5)
//
// The bell opens THIS — never a navigation. The current page stays visible
// under the backdrop; closing (X, backdrop tap, Escape, hardware back via
// urlSync interception) returns the user exactly where they were.
// Tapping a notification navigates only to its own destination.
// ═══════════════════════════════════════════════════════
import React, { useEffect, useRef } from 'react';
import { Bell, BellOff, X, Loader2, LogIn } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { notifIconFor, resolveNotificationTarget } from '../lib/notifications';
import { timeAgo } from '../lib/utils';
import { Card, SlideUp } from './ui';

export default function NotificationsPanel() {
  const {
    lang, user, goTab, setView, viewOrder, fetchOrderById, loadOrders, showToastMsg,
    showNotifications, setShowNotifications,
    orderNotifications, notifUnreadCount, notifLoading, notifError,
    loadNotifications, markNotifRead, markAllNotifsRead,
  } = useApp();

  const closeRef = useRef(null);

  // Refresh on open; Escape closes; initial focus lands on the close button.
  useEffect(() => {
    if (!showNotifications) return;
    if (user) loadNotifications();
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') setShowNotifications(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showNotifications, user, loadNotifications, setShowNotifications]);

  if (!showNotifications) return null;

  const close = () => setShowNotifications(false);

  const handleTap = async (notif) => {
    if (!notif.read_at) markNotifRead(notif.id); // fire-and-forget; navigation must not wait
    const target = await resolveNotificationTarget(notif, { fetchOrderById });
    close();
    if (target.kind === 'order') { viewOrder(target.order); return; }
    if (target.kind === 'reviews') { goTab('profile'); return; }
    if (target.kind === 'missing') {
      // Honest unavailable state: the referenced order no longer exists.
      showToastMsg(lang === 'he' ? 'ההזמנה אינה זמינה עוד' : 'This order is no longer available');
    }
    await loadOrders();
    setView('orders');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm animate-fadeIn"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label={lang === 'he' ? 'התראות' : 'Notifications'}
    >
      <SlideUp className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div
          className="bg-gradient-to-b from-[#1c1b1b] to-[#131313] rounded-t-[2rem] flex flex-col"
          style={{ maxHeight: '75dvh', paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
        >
          <div className="w-12 h-1 bg-white/20 rounded-full mx-auto mt-3 flex-shrink-0" />

          {/* Header */}
          <div className="flex items-center gap-3 px-6 pt-4 pb-3 flex-shrink-0">
            <Bell className="w-5 h-5" style={{ color: '#6FEEE1' }} />
            <h3 className="text-lg font-bold flex-1">{lang === 'he' ? 'התראות' : 'Notifications'}</h3>
            {user && notifUnreadCount > 0 && (
              <button
                onClick={markAllNotifsRead}
                className="text-xs font-semibold hover:opacity-70 transition-opacity"
                style={{ color: '#6FEEE1' }}
              >
                {lang === 'he' ? 'סמן הכל כנקרא' : 'Mark all read'}
              </button>
            )}
            <button
              ref={closeRef}
              onClick={close}
              aria-label={lang === 'he' ? 'סגור התראות' : 'Close notifications'}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
            >
              <X className="w-4 h-4 text-white/70" />
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto overscroll-contain px-4 pb-2 space-y-2">
            {!user ? (
              <div className="text-center py-10 space-y-3">
                <LogIn className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="text-sm text-slate-400">{lang === 'he' ? 'התחבר כדי לראות התראות' : 'Sign in to see your notifications'}</p>
                <button
                  onClick={() => { close(); goTab('profile'); }}
                  className="px-5 py-2 rounded-xl text-sm font-bold"
                  style={{ background: 'linear-gradient(135deg, #6FEEE1 0%, #4FD1C5 100%)', color: '#003733' }}
                >
                  {lang === 'he' ? 'התחברות' : 'Sign in'}
                </button>
              </div>
            ) : notifLoading && orderNotifications.length === 0 ? (
              <div className="text-center py-10">
                <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: '#6FEEE1' }} />
                <p className="text-xs text-slate-500 mt-2">{lang === 'he' ? 'טוען התראות...' : 'Loading notifications...'}</p>
              </div>
            ) : notifError && orderNotifications.length === 0 ? (
              /* A failed load is an ERROR with retry — never a false "no notifications" */
              <div className="text-center py-10 space-y-3">
                <p className="text-sm text-slate-300">{lang === 'he' ? 'לא ניתן לטעון התראות' : "Couldn't load notifications"}</p>
                <button
                  onClick={loadNotifications}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 transition-colors"
                >
                  {lang === 'he' ? 'נסה שוב' : 'Retry'}
                </button>
              </div>
            ) : orderNotifications.length === 0 ? (
              <div className="text-center py-10 space-y-2">
                <BellOff className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="text-sm text-slate-400">{lang === 'he' ? 'אין התראות' : 'No notifications'}</p>
              </div>
            ) : (
              orderNotifications.map((notif) => {
                const c = notifIconFor(notif.type);
                const Icon = c.icon;
                const unread = !notif.read_at;
                return (
                  <button key={notif.id} onClick={() => handleTap(notif)} className="w-full text-left">
                    <Card
                      className="p-3.5 hover:bg-white/[0.03] transition-all"
                      style={unread ? { borderLeft: '2px solid rgba(111,238,225,0.5)' } : {}}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${unread ? '' : 'bg-white/5'}`}
                          style={unread ? { background: 'rgba(111,238,225,0.1)' } : {}}
                        >
                          <Icon className={`w-4 h-4 ${c.color}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${unread ? 'font-semibold text-white' : 'font-medium text-slate-300'}`}>{notif.title}</p>
                          {notif.body && <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{notif.body}</p>}
                          <p className="text-[10px] text-slate-500 mt-1">{timeAgo(notif.created_at, { ago: lang === 'he' ? 'לפני' : 'ago' })}</p>
                        </div>
                        {unread && <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0" style={{ background: '#6FEEE1' }} />}
                      </div>
                    </Card>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </SlideUp>
    </div>
  );
}
