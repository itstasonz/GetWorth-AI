// ═══════════════════════════════════════════════════════
// NOTIFICATIONS — shared type metadata + deep-link resolution (FRONTEND-009)
//
// One authority for what each notification type means and where tapping it
// leads. Used by BOTH the bell panel (NotificationsPanel) and the full
// NotificationsView so the two surfaces can never disagree.
// ═══════════════════════════════════════════════════════
import {
  ShoppingBag, Check, ThumbsDown, MapPin, Package, CheckCircle, XCircle, Star, Bell,
} from 'lucide-react';

export const NOTIF_ICONS = {
  ORDER_REQUESTED: { icon: ShoppingBag, color: 'text-amber-400' },
  ORDER_ACCEPTED:  { icon: Check,       color: 'text-emerald-400' },
  ORDER_DECLINED:  { icon: ThumbsDown,  color: 'text-red-400' },
  ORDER_READY:     { icon: MapPin,      color: 'text-[#6FEEE1]' },
  ORDER_RECEIVED:  { icon: Package,     color: 'text-emerald-400' },
  ORDER_COMPLETED: { icon: CheckCircle, color: 'text-emerald-400' },
  ORDER_CANCELLED: { icon: XCircle,     color: 'text-red-400' },
  REVIEW_RECEIVED: { icon: Star,        color: 'text-yellow-400' },
};

export const notifIconFor = (type) => NOTIF_ICONS[type] || { icon: Bell, color: 'text-slate-400' };

// Resolve a notification tap to a navigation action.
// Returns one of:
//   { kind: 'order',   order }   — open that order's detail
//   { kind: 'orders' }           — open the orders list
//   { kind: 'reviews' }          — open own profile (reviews live there)
//   { kind: 'missing', fallback: 'orders' } — referenced entity no longer
//        exists; caller must SAY so (honest unavailable state), then show
//        the closest list.
export async function resolveNotificationTarget(notif, { fetchOrderById }) {
  // Review notifications are about the user's own reputation, not an order.
  if (notif.type === 'REVIEW_RECEIVED') return { kind: 'reviews' };

  const orderId = notif.data?.order_id;
  if (orderId) {
    const order = await fetchOrderById(orderId);
    if (order) return { kind: 'order', order };
    return { kind: 'missing', fallback: 'orders' };
  }
  return { kind: 'orders' };
}
