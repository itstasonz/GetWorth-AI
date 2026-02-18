import React, { useState, useEffect } from 'react';
import {
  Package, Truck, MapPin, Clock, Check, CheckCircle, XCircle,
  ChevronRight, ArrowLeft, ShoppingBag, Loader2, AlertTriangle,
  MessageCircle, Shield, Star, Bell, BellOff, ThumbsDown,
  CornerDownRight,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, Badge, FadeIn, SlideUp, InputField } from '../components/ui';
import { formatPrice, timeAgo } from '../lib/utils';

// ═══════════════════════════════════════════════════════
// ORDER STATUS CONFIG
// ═══════════════════════════════════════════════════════
const STATUS_CONFIG = {
  pending:      { label: { en: 'Requested',        he: 'ממתין לאישור' },    color: 'amber',   icon: Clock,          step: 1 },
  accepted:     { label: { en: 'Accepted',          he: 'אושר' },           color: 'blue',    icon: Check,          step: 2 },
  declined:     { label: { en: 'Declined',          he: 'נדחה' },           color: 'red',     icon: ThumbsDown,     step: 0 },
  shipped:      { label: { en: 'Shipped',           he: 'נשלח' },           color: 'blue',    icon: Truck,          step: 3 },
  ready_pickup: { label: { en: 'Ready for Pickup',  he: 'מוכן לאיסוף' },    color: 'blue',    icon: MapPin,         step: 3 },
  delivered:    { label: { en: 'Received',          he: 'התקבל' },          color: 'emerald', icon: Package,        step: 4 },
  completed:    { label: { en: 'Completed',         he: 'הושלם' },          color: 'emerald', icon: CheckCircle,    step: 5 },
  cancelled:    { label: { en: 'Cancelled',         he: 'בוטל' },           color: 'red',     icon: XCircle,        step: 0 },
  disputed:     { label: { en: 'Disputed',          he: 'במחלוקת' },        color: 'red',     icon: AlertTriangle,  step: 0 },
};

const STEPS_PICKUP   = ['pending', 'accepted', 'ready_pickup', 'delivered', 'completed'];
const STEPS_SHIPPING = ['pending', 'accepted', 'shipped', 'delivered', 'completed'];

function badgeCls(color) {
  return color === 'amber' ? 'bg-amber-500/15 text-amber-300' :
    color === 'blue' ? 'bg-blue-500/15 text-blue-300' :
    color === 'emerald' ? 'bg-emerald-500/15 text-emerald-300' :
    'bg-red-500/15 text-red-300';
}
function txtCls(color) {
  return color === 'amber' ? 'text-amber-400' :
    color === 'blue' ? 'text-blue-400' :
    color === 'emerald' ? 'text-emerald-400' : 'text-red-400';
}
function bgCls(color) {
  return color === 'amber' ? 'bg-amber-500/10 border-amber-500/20' :
    color === 'blue' ? 'bg-blue-500/10 border-blue-500/20' :
    color === 'emerald' ? 'bg-emerald-500/10 border-emerald-500/20' :
    'bg-red-500/10 border-red-500/20';
}

// ═══════════════════════════════════════════════════════
// CHECKOUT SHEET — buyer fills delivery details
// ═══════════════════════════════════════════════════════
export function CheckoutSheet() {
  const { lang, selected, user, createOrder, showCheckout, setShowCheckout } = useApp();
  const [deliveryMethod, setDeliveryMethod] = useState('pickup');
  const [shippingAddress, setShippingAddress] = useState('');
  const [buyerNote, setBuyerNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!showCheckout || !selected) return null;

  const handleSubmit = async () => {
    if (deliveryMethod === 'shipping' && !shippingAddress.trim()) return;
    setSubmitting(true);
    await createOrder({
      listingId: selected.id, sellerId: selected.seller_id, price: selected.price,
      deliveryMethod,
      shippingAddress: deliveryMethod === 'shipping' ? shippingAddress.trim() : null,
      buyerNote: buyerNote.trim() || null,
    });
    setSubmitting(false);
  };

  const listing = selected;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm animate-fadeIn">
      <SlideUp className="w-full max-w-md">
        <div className="bg-gradient-to-b from-[#151d30] to-[#0a1020] rounded-t-[2rem] p-6 space-y-5 max-h-[85vh] overflow-y-auto">
          <div className="w-12 h-1 bg-white/20 rounded-full mx-auto" />
          <div className="flex items-center gap-4">
            {listing.images?.[0] && <img src={listing.images[0]} alt="" className="w-16 h-16 rounded-2xl object-cover" />}
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-lg truncate">{lang === 'he' && listing.title_hebrew ? listing.title_hebrew : listing.title}</h3>
              <p className="text-2xl font-bold text-emerald-400">{formatPrice(listing.price)}</p>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold mb-3">{lang === 'he' ? 'אופן מסירה' : 'Delivery method'}</p>
            <div className="grid grid-cols-2 gap-3">
              {[{ key: 'pickup', Icon: MapPin, he: 'איסוף עצמי', en: 'Pickup' }, { key: 'shipping', Icon: Truck, he: 'משלוח', en: 'Shipping' }].map(m => (
                <button key={m.key} onClick={() => setDeliveryMethod(m.key)}
                  className={`p-4 rounded-2xl border text-center transition-all ${deliveryMethod === m.key ? 'border-blue-500 bg-blue-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
                  <m.Icon className={`w-6 h-6 mx-auto mb-2 ${deliveryMethod === m.key ? 'text-blue-400' : 'text-slate-400'}`} />
                  <span className={`text-sm font-medium ${deliveryMethod === m.key ? 'text-blue-300' : 'text-slate-300'}`}>{lang === 'he' ? m.he : m.en}</span>
                  {m.key === 'pickup' && listing.location && <p className="text-[10px] text-slate-500 mt-1 truncate">{listing.location}</p>}
                </button>
              ))}
            </div>
          </div>
          {deliveryMethod === 'shipping' && (
            <FadeIn><InputField label={lang === 'he' ? 'כתובת למשלוח' : 'Shipping address'} icon={MapPin} value={shippingAddress} onChange={e => setShippingAddress(e.target.value)} required /></FadeIn>
          )}
          <div>
            <label className="text-sm text-slate-400 mb-1.5 block">{lang === 'he' ? 'הערה למוכר (אופציונלי)' : 'Note to seller (optional)'}</label>
            <textarea value={buyerNote} onChange={e => setBuyerNote(e.target.value)}
              placeholder={lang === 'he' ? 'למשל: זמין בערבים...' : 'e.g. Available evenings...'}
              className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-blue-500/50" rows={2} />
          </div>
          <Card className="p-4" gradient="linear-gradient(135deg, rgba(251,191,36,0.1), rgba(251,191,36,0.03))">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-200">{lang === 'he' ? 'תשלום מחוץ לאפליקציה' : 'Payment outside the app'}</p>
                <p className="text-xs text-slate-400 mt-1">{lang === 'he' ? 'התשלום ישירות (מזומן, ביט, העברה). אשר קבלה אחרי שתקבל.' : 'Payment arranged directly. Confirm receipt after you get the item.'}</p>
              </div>
            </div>
          </Card>
          <div className="bg-white/5 rounded-2xl p-4 space-y-2">
            <div className="flex justify-between text-sm"><span className="text-slate-400">{lang === 'he' ? 'מחיר' : 'Price'}</span><span className="font-bold">{formatPrice(listing.price)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-slate-400">{lang === 'he' ? 'מסירה' : 'Delivery'}</span><span className="text-slate-300">{deliveryMethod === 'pickup' ? (lang === 'he' ? 'איסוף' : 'Pickup') : (lang === 'he' ? 'משלוח' : 'Shipping')}</span></div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowCheckout(false)} className="flex-1 py-3.5 rounded-xl bg-white/5 border border-white/10 text-sm font-medium hover:bg-white/10 transition-all">{lang === 'he' ? 'ביטול' : 'Cancel'}</button>
            <Btn primary className="flex-1 py-3.5" onClick={handleSubmit} disabled={submitting || (deliveryMethod === 'shipping' && !shippingAddress.trim())}>
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />{lang === 'he' ? 'שולח...' : 'Sending...'}</> : <><ShoppingBag className="w-4 h-4" />{lang === 'he' ? 'שלח הזמנה' : 'Place Order'}</>}
            </Btn>
          </div>
        </div>
      </SlideUp>
    </div>
  );
}


// ═══════════════════════════════════════════════════════
// ORDERS LIST — Buying / Requests / Sales tabs
// ═══════════════════════════════════════════════════════
export function OrdersView() {
  const { lang, user, orders, ordersLoading, loadOrders, viewOrder, setView, notifUnreadCount } = useApp();
  useEffect(() => { loadOrders(); }, [loadOrders]);
  const [activeTab, setActiveTab] = useState('buying');

  if (!user) return null;

  const buyOrders       = orders.filter(o => o.buyer_id === user.id);
  const sellOrders      = orders.filter(o => o.seller_id === user.id);
  const pendingRequests = sellOrders.filter(o => o.status === 'pending');
  const otherSellOrders = sellOrders.filter(o => o.status !== 'pending');

  const renderOrder = (order) => {
    const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
    const StatusIcon = cfg.icon;
    const listing = order.listing;
    return (
      <FadeIn key={order.id}>
        <button onClick={() => viewOrder(order)} className="w-full text-left">
          <Card className="p-4 hover:bg-white/[0.03] transition-all">
            <div className="flex items-center gap-4">
              {listing?.images?.[0] ? <img src={listing.images[0]} alt="" className="w-14 h-14 rounded-xl object-cover" /> : <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center"><Package className="w-6 h-6 text-slate-500" /></div>}
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-sm truncate">{lang === 'he' && listing?.title_hebrew ? listing.title_hebrew : (listing?.title || 'Order')}</h4>
                <p className="text-lg font-bold text-emerald-400">{formatPrice(order.price)}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${badgeCls(cfg.color)}`}><StatusIcon className="w-3 h-3" />{cfg.label[lang === 'he' ? 'he' : 'en']}</span>
                  <span className="text-[10px] text-slate-500">{timeAgo(order.created_at, { ago: lang === 'he' ? 'לפני' : 'ago' })}</span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-500" />
            </div>
          </Card>
        </button>
      </FadeIn>
    );
  };

  const renderPendingRequest = (order) => {
    const listing = order.listing;
    const buyer = order.buyer;
    return (
      <FadeIn key={order.id}>
        <Card className="p-4 space-y-3" gradient="linear-gradient(135deg, rgba(251,191,36,0.06), rgba(251,191,36,0.01))">
          <div className="flex items-center gap-4">
            {listing?.images?.[0] ? <img src={listing.images[0]} alt="" className="w-14 h-14 rounded-xl object-cover" /> : <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center"><Package className="w-6 h-6 text-slate-500" /></div>}
            <div className="flex-1 min-w-0">
              <h4 className="font-semibold text-sm truncate">{lang === 'he' && listing?.title_hebrew ? listing.title_hebrew : (listing?.title || '')}</h4>
              <p className="text-lg font-bold text-emerald-400">{formatPrice(order.price)}</p>
              <p className="text-xs text-slate-400 mt-0.5">{lang === 'he' ? 'מאת: ' : 'From: '}{buyer?.full_name || (lang === 'he' ? 'קונה' : 'Buyer')}{buyer?.is_verified && <Shield className="w-3 h-3 text-blue-400 inline ml-1" />}</p>
            </div>
          </div>
          {order.buyer_note && <div className="bg-white/5 rounded-xl p-3"><p className="text-xs text-slate-400"><CornerDownRight className="w-3 h-3 inline mr-1" />{order.buyer_note}</p></div>}
          <div className="flex gap-3">
            <button onClick={() => viewOrder(order)} className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm font-medium hover:bg-white/10 transition-all">{lang === 'he' ? 'פרטים' : 'Details'}</button>
            <Btn primary className="flex-1 py-2.5" onClick={() => viewOrder(order)}><Check className="w-4 h-4" />{lang === 'he' ? 'בדוק ואשר' : 'Review & Accept'}</Btn>
          </div>
        </Card>
      </FadeIn>
    );
  };

  const currentList = activeTab === 'buying' ? buyOrders : activeTab === 'requests' ? pendingRequests : otherSellOrders;

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => setView('profile')} className="p-2 rounded-xl bg-white/5 hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></button>
          <h2 className="text-xl font-bold flex-1">{lang === 'he' ? 'ההזמנות שלי' : 'My Orders'}</h2>
          <button onClick={() => setView('notifications')} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 relative">
            <Bell className="w-5 h-5" />
            {notifUnreadCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gradient-to-r from-red-500 to-pink-500 text-[9px] flex items-center justify-center font-bold animate-pulse">{notifUnreadCount}</span>}
          </button>
        </div>
      </FadeIn>

      <div className="flex gap-1 bg-white/5 rounded-xl p-1">
        {[
          { key: 'buying', he: 'קניות', en: 'Buying', count: buyOrders.length, color: 'blue' },
          { key: 'requests', he: 'בקשות', en: 'Requests', count: pendingRequests.length, color: 'amber' },
          { key: 'selling', he: 'מכירות', en: 'Sales', count: otherSellOrders.length, color: 'blue' },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === tab.key ? `bg-${tab.color}-600/30 text-${tab.color}-300` : 'text-slate-400 hover:text-white'}`}>
            {lang === 'he' ? tab.he : tab.en}
            {tab.count > 0 && tab.key === 'requests' && <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-[10px] font-bold text-black">{tab.count}</span>}
            {tab.count > 0 && tab.key !== 'requests' && ` (${tab.count})`}
          </button>
        ))}
      </div>

      {ordersLoading ? (
        <div className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto" /></div>
      ) : currentList.length === 0 ? (
        <FadeIn><div className="text-center py-16 space-y-3">
          <Package className="w-12 h-12 text-slate-600 mx-auto" />
          <p className="text-slate-400">{activeTab === 'buying' ? (lang === 'he' ? 'אין קניות' : 'No purchases yet') : activeTab === 'requests' ? (lang === 'he' ? 'אין בקשות חדשות' : 'No pending requests') : (lang === 'he' ? 'אין מכירות' : 'No sales yet')}</p>
        </div></FadeIn>
      ) : (
        <div className="space-y-3">{activeTab === 'requests' ? currentList.map(renderPendingRequest) : currentList.map(renderOrder)}</div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════
// ORDER DETAIL — timeline + actions for BOTH sides
// ═══════════════════════════════════════════════════════
export function OrderDetailView() {
  const { lang, user, activeOrder, activeOrderId, updateOrderStatus, cancelOrder, setView, startConversation, submitReview, loadOrders, fetchOrderById, setActiveOrder } = useApp();
  const [updating, setUpdating] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);
  const [loading, setLoading] = useState(false);

  // If we have an activeOrderId but no activeOrder (or stale), fetch the full order
  useEffect(() => {
    if (activeOrderId && !activeOrder) {
      setLoading(true);
      fetchOrderById(activeOrderId).then(data => {
        if (data) setActiveOrder(data);
        setLoading(false);
      });
    }
  }, [activeOrderId, activeOrder, fetchOrderById, setActiveOrder]);

  // Show loading if we're fetching the order
  if (loading || (!activeOrder && activeOrderId)) {
    return (
      <div className="space-y-5">
        <FadeIn>
          <div className="flex items-center gap-3">
            <button onClick={() => { setView('orders'); loadOrders(); }} className="p-2 rounded-xl bg-white/5 hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></button>
            <h2 className="text-xl font-bold">{lang === 'he' ? 'פרטי הזמנה' : 'Order Details'}</h2>
          </div>
        </FadeIn>
        <div className="text-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto" /></div>
      </div>
    );
  }

  if (!activeOrder || !user) return null;

  const order    = activeOrder;
  const isBuyer  = user.id === order.buyer_id;
  const isSeller = user.id === order.seller_id;
  const listing  = order.listing;
  const cfg      = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const StatusIcon = cfg.icon;

  const steps = order.delivery_method === 'shipping' ? STEPS_SHIPPING : STEPS_PICKUP;
  const currentStepIndex = steps.indexOf(order.status);
  const isTerminal = ['completed', 'cancelled', 'disputed', 'declined'].includes(order.status);

  const handleAction = async (s) => { setUpdating(true); await updateOrderStatus(order.id, s); setUpdating(false); };
  const handleCancel = async () => { setUpdating(true); await cancelOrder(order.id, cancelReason); setShowCancel(false); setUpdating(false); };
  const handleContact = async () => {
    if (!listing) return;
    isBuyer ? await startConversation(listing) : await startConversation({ ...listing, seller_id: order.buyer_id, seller: order.buyer });
  };

  const stepLabels = {
    pending: { en: 'Order Requested', he: 'בקשה נשלחה' },
    accepted: { en: 'Seller Accepted', he: 'המוכר אישר' },
    shipped: { en: 'Shipped', he: 'נשלח' },
    ready_pickup: { en: 'Ready for Pickup', he: 'מוכן לאיסוף' },
    delivered: { en: 'Buyer Received', he: 'הקונה קיבל' },
    completed: { en: 'Completed', he: 'הושלם' },
  };

  const otherName = isBuyer ? (order.seller?.full_name || (lang === 'he' ? 'מוכר' : 'Seller')) : (order.buyer?.full_name || (lang === 'he' ? 'קונה' : 'Buyer'));
  const otherVerified = isBuyer ? order.seller?.is_verified : order.buyer?.is_verified;

  return (
    <div className="space-y-5">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center gap-3">
          <button onClick={() => { setView('orders'); loadOrders(); }} className="p-2 rounded-xl bg-white/5 hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></button>
          <h2 className="text-xl font-bold">{lang === 'he' ? 'פרטי הזמנה' : 'Order Details'}</h2>
        </div>
      </FadeIn>

      {/* Listing */}
      <FadeIn delay={50}>
        <Card className="p-4">
          <div className="flex items-center gap-4">
            {listing?.images?.[0] ? <img src={listing.images[0]} alt="" className="w-16 h-16 rounded-2xl object-cover" /> : <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center"><Package className="w-7 h-7 text-slate-500" /></div>}
            <div className="flex-1 min-w-0">
              <h3 className="font-bold truncate">{lang === 'he' && listing?.title_hebrew ? listing.title_hebrew : (listing?.title || '')}</h3>
              <p className="text-2xl font-bold text-emerald-400">{formatPrice(order.price)}</p>
            </div>
          </div>
        </Card>
      </FadeIn>

      {/* Status */}
      <FadeIn delay={100}>
        <div className={`flex items-center justify-center gap-2 py-3 rounded-2xl border ${bgCls(cfg.color)}`}>
          <StatusIcon className={`w-5 h-5 ${txtCls(cfg.color)}`} />
          <span className={`font-semibold ${txtCls(cfg.color)}`}>{cfg.label[lang === 'he' ? 'he' : 'en']}</span>
        </div>
      </FadeIn>

      {/* Context message */}
      {!isTerminal && (
        <FadeIn delay={120}>
          <Card className="p-4" gradient="linear-gradient(135deg, rgba(59,130,246,0.08), rgba(59,130,246,0.02))">
            <p className="text-sm text-blue-200 text-center">
              {order.status === 'pending' && isBuyer && (lang === 'he' ? 'ממתין לאישור המוכר...' : 'Waiting for seller to accept...')}
              {order.status === 'pending' && isSeller && (lang === 'he' ? 'יש לך בקשת קנייה חדשה! אשר או דחה למטה.' : 'New purchase request! Accept or decline below.')}
              {order.status === 'accepted' && isBuyer && (lang === 'he' ? 'המוכר אישר! ממתין שיסמן מוכן.' : 'Seller accepted! Waiting for them to mark ready.')}
              {order.status === 'accepted' && isSeller && (lang === 'he' ? 'סמן מוכן כשהפריט מוכן לאיסוף/משלוח.' : 'Mark ready when item is prepared.')}
              {(order.status === 'ready_pickup' || order.status === 'shipped') && isBuyer && (lang === 'he' ? 'המוצר מוכן! אשר קבלה אחרי שתקבל.' : 'Item ready! Confirm receipt after you get it.')}
              {(order.status === 'ready_pickup' || order.status === 'shipped') && isSeller && (lang === 'he' ? 'ממתין שהקונה יאשר קבלה.' : 'Waiting for buyer to confirm receipt.')}
              {order.status === 'delivered' && (lang === 'he' ? 'הקונה קיבל! השלם את העסקה.' : 'Buyer received! Complete the transaction.')}
            </p>
          </Card>
        </FadeIn>
      )}

      {/* Timeline */}
      {!isTerminal && (
        <FadeIn delay={150}>
          <Card className="p-5">
            {steps.map((step, i) => {
              const isActive = i <= currentStepIndex;
              const isCurrent = step === order.status;
              const label = stepLabels[step] || { en: step, he: step };
              return (
                <div key={step} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isActive ? 'border-blue-500 bg-blue-500' : 'border-slate-600'}`}>
                      {isActive && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    {i < steps.length - 1 && <div className={`w-0.5 h-8 ${isActive && i < currentStepIndex ? 'bg-blue-500' : 'bg-slate-700'}`} />}
                  </div>
                  <div className={`pt-0 pb-4 ${isCurrent ? 'text-white font-semibold' : isActive ? 'text-slate-300' : 'text-slate-500'}`}>
                    <span className="text-sm">{label[lang === 'he' ? 'he' : 'en']}</span>
                    {isCurrent && <span className="ml-2 text-[10px] text-blue-400 font-medium">{lang === 'he' ? '← כאן' : '← current'}</span>}
                  </div>
                </div>
              );
            })}
          </Card>
        </FadeIn>
      )}

      {/* Info */}
      <FadeIn delay={200}>
        <Card className="p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{lang === 'he' ? 'מסירה' : 'Delivery'}</span>
            <span className="flex items-center gap-1.5">{order.delivery_method === 'pickup' ? <MapPin className="w-3.5 h-3.5 text-slate-400" /> : <Truck className="w-3.5 h-3.5 text-slate-400" />}{order.delivery_method === 'pickup' ? (lang === 'he' ? 'איסוף' : 'Pickup') : (lang === 'he' ? 'משלוח' : 'Shipping')}</span>
          </div>
          {order.shipping_address && <div className="flex justify-between text-sm"><span className="text-slate-400">{lang === 'he' ? 'כתובת' : 'Address'}</span><span className="text-slate-300 text-right max-w-[200px]">{order.shipping_address}</span></div>}
          {order.buyer_note && <div className="flex justify-between text-sm"><span className="text-slate-400">{lang === 'he' ? 'הערה' : 'Note'}</span><span className="text-slate-300 text-right max-w-[200px]">{order.buyer_note}</span></div>}
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{lang === 'he' ? (isBuyer ? 'מוכר' : 'קונה') : (isBuyer ? 'Seller' : 'Buyer')}</span>
            <span className="text-slate-300 flex items-center gap-1.5">{otherName}{otherVerified && <Shield className="w-3 h-3 text-blue-400" />}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{lang === 'he' ? 'תאריך' : 'Date'}</span>
            <span className="text-slate-300">{new Date(order.created_at).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US')}</span>
          </div>
        </Card>
      </FadeIn>

      {/* ═══════ ACTIONS ═══════ */}
      {!isTerminal && (
        <FadeIn delay={250}>
          <div className="space-y-3">
            {/* SELLER: Accept / Decline */}
            {isSeller && order.status === 'pending' && (
              <>
                <Btn primary className="w-full py-4" onClick={() => handleAction('accepted')} disabled={updating}>
                  {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-5 h-5" />}
                  {lang === 'he' ? 'אשר הזמנה' : 'Accept Order'}
                </Btn>
                <button onClick={() => handleAction('declined')} disabled={updating}
                  className="w-full py-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-sm font-semibold text-red-300 flex items-center justify-center gap-2 hover:bg-red-500/20 transition-all disabled:opacity-40">
                  <ThumbsDown className="w-4 h-4" />{lang === 'he' ? 'דחה הזמנה' : 'Decline Order'}
                </button>
              </>
            )}

            {/* SELLER: Mark Ready / Shipped */}
            {isSeller && order.status === 'accepted' && (
              <Btn primary className="w-full py-4" onClick={() => handleAction(order.delivery_method === 'shipping' ? 'shipped' : 'ready_pickup')} disabled={updating}>
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : (order.delivery_method === 'shipping' ? <Truck className="w-5 h-5" /> : <MapPin className="w-5 h-5" />)}
                {order.delivery_method === 'shipping' ? (lang === 'he' ? 'סמן כנשלח' : 'Mark as Shipped') : (lang === 'he' ? 'מוכן לאיסוף' : 'Ready for Pickup')}
              </Btn>
            )}

            {/* BUYER: Confirm Received */}
            {isBuyer && (order.status === 'shipped' || order.status === 'ready_pickup') && (
              <Btn primary className="w-full py-4" onClick={() => handleAction('delivered')} disabled={updating}>
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-5 h-5" />}
                {lang === 'he' ? 'קיבלתי את המוצר' : 'I Received the Item'}
              </Btn>
            )}

            {/* EITHER: Complete after received */}
            {order.status === 'delivered' && (
              <Btn primary className="w-full py-4" onClick={() => handleAction('completed')} disabled={updating}>
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                {lang === 'he' ? 'אשר והשלם עסקה' : 'Complete Transaction'}
              </Btn>
            )}

            {/* Contact */}
            <button onClick={handleContact} className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-medium flex items-center justify-center gap-2 hover:bg-white/10 transition-all">
              <MessageCircle className="w-4 h-4" />{lang === 'he' ? (isBuyer ? 'הודעה למוכר' : 'הודעה לקונה') : (isBuyer ? 'Message Seller' : 'Message Buyer')}
            </button>

            {/* Cancel */}
            {((isBuyer && (order.status === 'pending' || order.status === 'accepted')) || (isSeller && order.status === 'pending')) && (
              <button onClick={() => setShowCancel(true)} className="w-full py-3 text-red-400/70 text-sm hover:text-red-400 transition-colors">{lang === 'he' ? 'בטל הזמנה' : 'Cancel Order'}</button>
            )}
          </div>
        </FadeIn>
      )}

      {/* Terminal states */}
      {order.status === 'completed' && (
        <FadeIn delay={250}>
          <Card className="p-6 text-center" gradient="linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))">
            <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-emerald-300">{lang === 'he' ? 'העסקה הושלמה!' : 'Transaction Complete!'}</h3>
          </Card>
        </FadeIn>
      )}
      {order.status === 'declined' && (
        <FadeIn delay={250}>
          <Card className="p-5 text-center" gradient="linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.03))">
            <ThumbsDown className="w-10 h-10 text-red-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-red-300">{lang === 'he' ? 'ההזמנה נדחתה' : 'Order Declined'}</p>
          </Card>
        </FadeIn>
      )}
      {order.status === 'cancelled' && (
        <FadeIn delay={250}>
          <Card className="p-5 text-center" gradient="linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.03))">
            <XCircle className="w-10 h-10 text-red-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-red-300">{lang === 'he' ? 'ההזמנה בוטלה' : 'Order Cancelled'}</p>
            {order.cancel_reason && <p className="text-xs text-slate-400 mt-1">{order.cancel_reason}</p>}
          </Card>
        </FadeIn>
      )}

      {/* Review — bidirectional (buyer rates seller, seller rates buyer) */}
      {order.status === 'completed' && !reviewDone && (
        <FadeIn delay={300}>
          <Card className="p-5 space-y-4" gradient="linear-gradient(135deg, rgba(251,191,36,0.08), rgba(251,191,36,0.02))">
            <div className="text-center">
              <Star className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
              <h4 className="font-bold">{isBuyer ? (lang === 'he' ? 'דרג את המוכר' : 'Rate the Seller') : (lang === 'he' ? 'דרג את הקונה' : 'Rate the Buyer')}</h4>
            </div>
            <div className="flex justify-center gap-2">
              {[1,2,3,4,5].map(s => (
                <button key={s} onClick={() => setReviewRating(s)} className="p-1 transition-transform hover:scale-110 active:scale-95">
                  <Star className={`w-9 h-9 transition-colors ${s <= reviewRating ? 'text-yellow-400 fill-current' : 'text-slate-600'}`} />
                </button>
              ))}
            </div>
            {reviewRating > 0 && <p className="text-center text-sm font-medium text-yellow-300">{[,'גרוע','לא טוב','בסדר','טוב','מעולה!'][reviewRating]}</p>}
            <textarea value={reviewComment} onChange={e => setReviewComment(e.target.value)} placeholder={lang === 'he' ? 'ספר על החוויה...' : 'Tell about your experience...'} className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-yellow-500/50" rows={2} />
            <Btn primary className="w-full py-3.5" disabled={reviewRating === 0 || reviewSubmitting}
              onClick={async () => { setReviewSubmitting(true); const ok = await submitReview(order.id, order.listing_id, order.seller_id, reviewRating, reviewComment, isBuyer ? 'buyer' : 'seller'); setReviewSubmitting(false); if (ok) setReviewDone(true); }}>
              {reviewSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" />{lang === 'he' ? 'שולח...' : 'Submitting...'}</> : <><Star className="w-4 h-4" />{lang === 'he' ? 'שלח ביקורת' : 'Submit Review'}</>}
            </Btn>
          </Card>
        </FadeIn>
      )}
      {reviewDone && (
        <FadeIn><Card className="p-4 text-center" gradient="linear-gradient(135deg, rgba(251,191,36,0.1), rgba(251,191,36,0.03))">
          <div className="flex items-center justify-center gap-2"><CheckCircle className="w-5 h-5 text-yellow-400" /><span className="text-sm font-semibold text-yellow-300">{lang === 'he' ? 'הביקורת נשלחה!' : 'Review submitted!'}</span></div>
        </Card></FadeIn>
      )}

      {/* Cancel Modal */}
      {showCancel && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm animate-fadeIn">
          <SlideUp className="w-full max-w-md">
            <div className="bg-gradient-to-b from-[#151d30] to-[#0a1020] rounded-t-[2rem] p-6 space-y-4">
              <div className="w-12 h-1 bg-white/20 rounded-full mx-auto" />
              <h3 className="text-lg font-bold text-center text-red-300">{lang === 'he' ? 'בטל הזמנה?' : 'Cancel Order?'}</h3>
              <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder={lang === 'he' ? 'סיבה (אופציונלי)' : 'Reason (optional)'} className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-red-500/50" rows={2} />
              <div className="flex gap-3">
                <button onClick={() => setShowCancel(false)} className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-medium">{lang === 'he' ? 'חזור' : 'Go Back'}</button>
                <button onClick={handleCancel} disabled={updating} className="flex-1 py-3 rounded-xl bg-red-600/20 border border-red-500/30 text-sm font-semibold text-red-300 flex items-center justify-center gap-2">
                  {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}{lang === 'he' ? 'בטל' : 'Cancel'}
                </button>
              </div>
            </div>
          </SlideUp>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════
// NOTIFICATIONS INBOX
// ═══════════════════════════════════════════════════════
export function NotificationsView() {
  const { lang, user, setView, orderNotifications, notifUnreadCount, loadNotifications, markNotifRead, markAllNotifsRead, loadOrders, viewOrder, fetchOrderById } = useApp();
  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  if (!user) return null;

  const ICONS = {
    ORDER_REQUESTED: { icon: ShoppingBag, color: 'text-amber-400' },
    ORDER_ACCEPTED:  { icon: Check,        color: 'text-emerald-400' },
    ORDER_DECLINED:  { icon: ThumbsDown,   color: 'text-red-400' },
    ORDER_READY:     { icon: MapPin,        color: 'text-blue-400' },
    ORDER_RECEIVED:  { icon: Package,       color: 'text-emerald-400' },
    ORDER_COMPLETED: { icon: CheckCircle,   color: 'text-emerald-400' },
    ORDER_CANCELLED: { icon: XCircle,       color: 'text-red-400' },
    REVIEW_RECEIVED: { icon: Star,          color: 'text-yellow-400' },
  };

  const handleTap = async (notif) => {
    if (!notif.read_at) await markNotifRead(notif.id);
    const oid = notif.data?.order_id;
    if (oid) {
      // Fetch the specific order by ID (avoids stale closure on orders array)
      const order = await fetchOrderById(oid);
      if (order) {
        viewOrder(order);
      } else {
        // Order not found — go to orders list
        await loadOrders();
        setView('orders');
      }
      return;
    }
    setView('orders');
  };

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex items-center gap-3">
          <button onClick={() => setView('orders')} className="p-2 rounded-xl bg-white/5 hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></button>
          <h2 className="text-xl font-bold flex-1">{lang === 'he' ? 'התראות' : 'Notifications'}</h2>
          {notifUnreadCount > 0 && <button onClick={markAllNotifsRead} className="text-xs text-blue-400 hover:text-blue-300">{lang === 'he' ? 'סמן הכל כנקרא' : 'Mark all read'}</button>}
        </div>
      </FadeIn>

      {orderNotifications.length === 0 ? (
        <FadeIn><div className="text-center py-16 space-y-3"><BellOff className="w-12 h-12 text-slate-600 mx-auto" /><p className="text-slate-400">{lang === 'he' ? 'אין התראות' : 'No notifications'}</p></div></FadeIn>
      ) : (
        <div className="space-y-2">
          {orderNotifications.map(notif => {
            const c = ICONS[notif.type] || { icon: Bell, color: 'text-slate-400' };
            const Icon = c.icon;
            const unread = !notif.read_at;
            return (
              <FadeIn key={notif.id}>
                <button onClick={() => handleTap(notif)} className="w-full text-left">
                  <Card className={`p-4 hover:bg-white/[0.03] transition-all ${unread ? 'border-l-2 border-l-blue-500' : ''}`}>
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${unread ? 'bg-blue-500/15' : 'bg-white/5'}`}>
                        <Icon className={`w-4 h-4 ${c.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${unread ? 'font-semibold text-white' : 'font-medium text-slate-300'}`}>{notif.title}</p>
                        {notif.body && <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{notif.body}</p>}
                        <p className="text-[10px] text-slate-500 mt-1">{timeAgo(notif.created_at, { ago: lang === 'he' ? 'לפני' : 'ago' })}</p>
                      </div>
                      {unread && <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0" />}
                    </div>
                  </Card>
                </button>
              </FadeIn>
            );
          })}
        </div>
      )}
    </div>
  );
}