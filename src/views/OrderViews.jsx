import React, { useState, useEffect } from 'react';
import { Package, Truck, MapPin, Clock, Check, CheckCircle, XCircle, ChevronRight, ArrowLeft, ShoppingBag, Loader2, AlertTriangle, MessageCircle, Shield, Star } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, Badge, FadeIn, SlideUp, InputField } from '../components/ui';
import { formatPrice, timeAgo } from '../lib/utils';

// ═══════════════════════════════════════════════════════
// ORDER STATUS CONFIG
// ═══════════════════════════════════════════════════════
const STATUS_CONFIG = {
  pending: { label: { en: 'Pending', he: 'ממתין לאישור' }, color: 'amber', icon: Clock, step: 1 },
  accepted: { label: { en: 'Accepted', he: 'אושר' }, color: 'blue', icon: Check, step: 2 },
  shipped: { label: { en: 'Shipped', he: 'נשלח' }, color: 'blue', icon: Truck, step: 3 },
  ready_pickup: { label: { en: 'Ready for Pickup', he: 'מוכן לאיסוף' }, color: 'blue', icon: MapPin, step: 3 },
  delivered: { label: { en: 'Delivered', he: 'התקבל' }, color: 'emerald', icon: Package, step: 4 },
  completed: { label: { en: 'Completed', he: 'הושלם' }, color: 'emerald', icon: CheckCircle, step: 5 },
  cancelled: { label: { en: 'Cancelled', he: 'בוטל' }, color: 'red', icon: XCircle, step: 0 },
  disputed: { label: { en: 'Disputed', he: 'במחלוקת' }, color: 'red', icon: AlertTriangle, step: 0 },
};

const STEPS_PICKUP = ['pending', 'accepted', 'ready_pickup', 'delivered', 'completed'];
const STEPS_SHIPPING = ['pending', 'accepted', 'shipped', 'delivered', 'completed'];

// ═══════════════════════════════════════════════════════
// CHECKOUT SHEET — buyer fills delivery details
// ═══════════════════════════════════════════════════════
export function CheckoutSheet() {
  const {
    lang, selected, user, createOrder, showCheckout, setShowCheckout,
  } = useApp();

  const [deliveryMethod, setDeliveryMethod] = useState('pickup');
  const [shippingAddress, setShippingAddress] = useState('');
  const [buyerNote, setBuyerNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!showCheckout || !selected) return null;

  const handleSubmit = async () => {
    if (deliveryMethod === 'shipping' && !shippingAddress.trim()) return;
    setSubmitting(true);
    await createOrder({
      listingId: selected.id,
      sellerId: selected.seller_id,
      price: selected.price,
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

          {/* Header */}
          <div className="flex items-center gap-4">
            {listing.images?.[0] && (
              <img src={listing.images[0]} alt="" className="w-16 h-16 rounded-2xl object-cover" />
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-lg truncate">
                {lang === 'he' && listing.title_hebrew ? listing.title_hebrew : listing.title}
              </h3>
              <p className="text-2xl font-bold text-emerald-400">{formatPrice(listing.price)}</p>
            </div>
          </div>

          {/* Delivery Method */}
          <div>
            <p className="text-sm font-semibold mb-3">{lang === 'he' ? 'אופן מסירה' : 'Delivery method'}</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setDeliveryMethod('pickup')}
                className={`p-4 rounded-2xl border text-center transition-all ${
                  deliveryMethod === 'pickup'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <MapPin className={`w-6 h-6 mx-auto mb-2 ${deliveryMethod === 'pickup' ? 'text-blue-400' : 'text-slate-400'}`} />
                <span className={`text-sm font-medium ${deliveryMethod === 'pickup' ? 'text-blue-300' : 'text-slate-300'}`}>
                  {lang === 'he' ? 'איסוף עצמי' : 'Pickup'}
                </span>
                {listing.location && (
                  <p className="text-[10px] text-slate-500 mt-1 truncate">{listing.location}</p>
                )}
              </button>
              <button
                onClick={() => setDeliveryMethod('shipping')}
                className={`p-4 rounded-2xl border text-center transition-all ${
                  deliveryMethod === 'shipping'
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <Truck className={`w-6 h-6 mx-auto mb-2 ${deliveryMethod === 'shipping' ? 'text-blue-400' : 'text-slate-400'}`} />
                <span className={`text-sm font-medium ${deliveryMethod === 'shipping' ? 'text-blue-300' : 'text-slate-300'}`}>
                  {lang === 'he' ? 'משלוח' : 'Shipping'}
                </span>
              </button>
            </div>
          </div>

          {/* Shipping Address (only if shipping) */}
          {deliveryMethod === 'shipping' && (
            <FadeIn>
              <InputField
                label={lang === 'he' ? 'כתובת למשלוח' : 'Shipping address'}
                icon={MapPin}
                value={shippingAddress}
                onChange={(e) => setShippingAddress(e.target.value)}
                required
              />
            </FadeIn>
          )}

          {/* Buyer Note */}
          <div>
            <label className="text-sm text-slate-400 mb-1.5 block">{lang === 'he' ? 'הערה למוכר (אופציונלי)' : 'Note to seller (optional)'}</label>
            <textarea
              value={buyerNote}
              onChange={(e) => setBuyerNote(e.target.value)}
              placeholder={lang === 'he' ? 'למשל: זמין בערבים, אפשר גם ביום חמישי...' : 'e.g. Available evenings, can also meet Thursday...'}
              className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-blue-500/50"
              rows={2}
            />
          </div>

          {/* Payment Note */}
          <Card className="p-4" gradient="linear-gradient(135deg, rgba(251,191,36,0.1), rgba(251,191,36,0.03))">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-200">
                  {lang === 'he' ? 'תשלום מחוץ לאפליקציה' : 'Payment outside the app'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {lang === 'he'
                    ? 'התשלום יתבצע ישירות בין הקונה למוכר (מזומן, ביט, העברה). אשר קבלה באפליקציה לאחר שתקבל את המוצר.'
                    : 'Payment is arranged directly between buyer and seller (cash, Bit, transfer). Confirm receipt in the app after you receive the item.'}
                </p>
              </div>
            </div>
          </Card>

          {/* Summary */}
          <div className="bg-white/5 rounded-2xl p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">{lang === 'he' ? 'מחיר' : 'Price'}</span>
              <span className="font-bold text-white">{formatPrice(listing.price)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">{lang === 'he' ? 'מסירה' : 'Delivery'}</span>
              <span className="text-slate-300">{deliveryMethod === 'pickup' ? (lang === 'he' ? 'איסוף' : 'Pickup') : (lang === 'he' ? 'משלוח' : 'Shipping')}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button onClick={() => setShowCheckout(false)} className="flex-1 py-3.5 rounded-xl bg-white/5 border border-white/10 text-sm font-medium hover:bg-white/10 transition-all">
              {lang === 'he' ? 'ביטול' : 'Cancel'}
            </button>
            <Btn
              primary
              className="flex-1 py-3.5"
              onClick={handleSubmit}
              disabled={submitting || (deliveryMethod === 'shipping' && !shippingAddress.trim())}
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" />{lang === 'he' ? 'שולח...' : 'Sending...'}</>
              ) : (
                <><ShoppingBag className="w-4 h-4" />{lang === 'he' ? 'שלח הזמנה' : 'Place Order'}</>
              )}
            </Btn>
          </div>
        </div>
      </SlideUp>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ORDERS LIST VIEW — shows all user's orders
// ═══════════════════════════════════════════════════════
export function OrdersView() {
  const { lang, user, orders, ordersLoading, loadOrders, viewOrder, setView } = useApp();

  useEffect(() => { loadOrders(); }, [loadOrders]);

  if (!user) return null;

  const buyOrders = orders.filter(o => o.buyer_id === user.id);
  const sellOrders = orders.filter(o => o.seller_id === user.id);

  const [activeTab, setActiveTab] = useState('buying');

  const renderOrder = (order) => {
    const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
    const StatusIcon = cfg.icon;
    const listing = order.listing;

    return (
      <FadeIn key={order.id}>
        <button onClick={() => viewOrder(order)} className="w-full text-left">
          <Card className="p-4 hover:bg-white/[0.03] transition-all">
            <div className="flex items-center gap-4">
              {listing?.images?.[0] ? (
                <img src={listing.images[0]} alt="" className="w-14 h-14 rounded-xl object-cover" />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center">
                  <Package className="w-6 h-6 text-slate-500" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-sm truncate">
                  {lang === 'he' && listing?.title_hebrew ? listing.title_hebrew : (listing?.title || 'Order')}
                </h4>
                <p className="text-lg font-bold text-emerald-400">{formatPrice(order.price)}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                    cfg.color === 'amber' ? 'bg-amber-500/15 text-amber-300' :
                    cfg.color === 'blue' ? 'bg-blue-500/15 text-blue-300' :
                    cfg.color === 'emerald' ? 'bg-emerald-500/15 text-emerald-300' :
                    'bg-red-500/15 text-red-300'
                  }`}>
                    <StatusIcon className="w-3 h-3" />
                    {cfg.label[lang === 'he' ? 'he' : 'en']}
                  </span>
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

  const currentList = activeTab === 'buying' ? buyOrders : sellOrders;

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => setView('profile')} className="p-2 rounded-xl bg-white/5 hover:bg-white/10">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold">{lang === 'he' ? 'ההזמנות שלי' : 'My Orders'}</h2>
        </div>
      </FadeIn>

      {/* Tabs: Buying / Selling */}
      <div className="flex gap-2 bg-white/5 rounded-xl p-1">
        <button
          onClick={() => setActiveTab('buying')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'buying' ? 'bg-blue-600/30 text-blue-300' : 'text-slate-400 hover:text-white'
          }`}
        >
          {lang === 'he' ? 'קניות' : 'Purchases'} {buyOrders.length > 0 && `(${buyOrders.length})`}
        </button>
        <button
          onClick={() => setActiveTab('selling')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'selling' ? 'bg-blue-600/30 text-blue-300' : 'text-slate-400 hover:text-white'
          }`}
        >
          {lang === 'he' ? 'מכירות' : 'Sales'} {sellOrders.length > 0 && `(${sellOrders.length})`}
        </button>
      </div>

      {ordersLoading ? (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto" />
        </div>
      ) : currentList.length === 0 ? (
        <FadeIn>
          <div className="text-center py-16 space-y-3">
            <Package className="w-12 h-12 text-slate-600 mx-auto" />
            <p className="text-slate-400">
              {activeTab === 'buying'
                ? (lang === 'he' ? 'אין הזמנות עדיין' : 'No purchases yet')
                : (lang === 'he' ? 'אין מכירות עדיין' : 'No sales yet')}
            </p>
          </div>
        </FadeIn>
      ) : (
        <div className="space-y-3">
          {currentList.map(renderOrder)}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ORDER DETAIL VIEW — status timeline + actions
// ═══════════════════════════════════════════════════════
export function OrderDetailView() {
  const {
    lang, user, activeOrder, updateOrderStatus, cancelOrder, setView,
    startConversation, submitReview,
  } = useApp();

  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [updating, setUpdating] = useState(false);
  // Review state
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);

  if (!activeOrder || !user) return null;

  const order = activeOrder;
  const isBuyer = user.id === order.buyer_id;
  const isSeller = user.id === order.seller_id;
  const listing = order.listing;
  const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const StatusIcon = cfg.icon;

  const steps = order.delivery_method === 'shipping' ? STEPS_SHIPPING : STEPS_PICKUP;
  const currentStepIndex = steps.indexOf(order.status);
  const isTerminal = order.status === 'completed' || order.status === 'cancelled' || order.status === 'disputed';

  const handleAction = async (newStatus) => {
    setUpdating(true);
    await updateOrderStatus(order.id, newStatus);
    setUpdating(false);
  };

  const handleCancel = async () => {
    setUpdating(true);
    await cancelOrder(order.id, cancelReason);
    setShowCancel(false);
    setUpdating(false);
  };

  const handleContactParty = async () => {
    if (listing) {
      if (isBuyer) {
        // Buyer messaging seller — works naturally
        await startConversation(listing);
      } else {
        // Seller messaging buyer — swap seller_id to buyer so conversation creates correctly
        await startConversation({ ...listing, seller_id: order.buyer_id, seller: order.buyer });
      }
    }
  };

  // Step labels
  const stepLabels = {
    pending: { en: 'Order Placed', he: 'הזמנה נשלחה' },
    accepted: { en: 'Seller Accepted', he: 'אושר ע"י המוכר' },
    shipped: { en: 'Shipped', he: 'נשלח' },
    ready_pickup: { en: 'Ready for Pickup', he: 'מוכן לאיסוף' },
    delivered: { en: 'Received', he: 'התקבל' },
    completed: { en: 'Completed', he: 'הושלם' },
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center gap-3">
          <button onClick={() => setView('orders')} className="p-2 rounded-xl bg-white/5 hover:bg-white/10">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold">{lang === 'he' ? 'פרטי הזמנה' : 'Order Details'}</h2>
        </div>
      </FadeIn>

      {/* Listing Card */}
      <FadeIn delay={50}>
        <Card className="p-4">
          <div className="flex items-center gap-4">
            {listing?.images?.[0] ? (
              <img src={listing.images[0]} alt="" className="w-16 h-16 rounded-2xl object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
                <Package className="w-7 h-7 text-slate-500" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-bold truncate">
                {lang === 'he' && listing?.title_hebrew ? listing.title_hebrew : (listing?.title || '')}
              </h3>
              <p className="text-2xl font-bold text-emerald-400">{formatPrice(order.price)}</p>
            </div>
          </div>
        </Card>
      </FadeIn>

      {/* Status Badge */}
      <FadeIn delay={100}>
        <div className={`flex items-center justify-center gap-2 py-3 rounded-2xl ${
          cfg.color === 'amber' ? 'bg-amber-500/10 border border-amber-500/20' :
          cfg.color === 'blue' ? 'bg-blue-500/10 border border-blue-500/20' :
          cfg.color === 'emerald' ? 'bg-emerald-500/10 border border-emerald-500/20' :
          'bg-red-500/10 border border-red-500/20'
        }`}>
          <StatusIcon className={`w-5 h-5 ${
            cfg.color === 'amber' ? 'text-amber-400' :
            cfg.color === 'blue' ? 'text-blue-400' :
            cfg.color === 'emerald' ? 'text-emerald-400' : 'text-red-400'
          }`} />
          <span className={`font-semibold ${
            cfg.color === 'amber' ? 'text-amber-300' :
            cfg.color === 'blue' ? 'text-blue-300' :
            cfg.color === 'emerald' ? 'text-emerald-300' : 'text-red-300'
          }`}>
            {cfg.label[lang === 'he' ? 'he' : 'en']}
          </span>
        </div>
      </FadeIn>

      {/* Progress Timeline */}
      {!isTerminal && (
        <FadeIn delay={150}>
          <Card className="p-5">
            <div className="space-y-0">
              {steps.map((step, i) => {
                const isActive = i <= currentStepIndex;
                const isCurrent = step === order.status;
                const label = stepLabels[step] || { en: step, he: step };
                return (
                  <div key={step} className="flex items-start gap-3">
                    {/* Dot + Line */}
                    <div className="flex flex-col items-center">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        isActive
                          ? 'border-blue-500 bg-blue-500'
                          : 'border-slate-600 bg-transparent'
                      }`}>
                        {isActive && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                      {i < steps.length - 1 && (
                        <div className={`w-0.5 h-8 ${isActive && i < currentStepIndex ? 'bg-blue-500' : 'bg-slate-700'}`} />
                      )}
                    </div>
                    {/* Label */}
                    <div className={`pt-0 pb-4 ${isCurrent ? 'text-white font-semibold' : isActive ? 'text-slate-300' : 'text-slate-500'}`}>
                      <span className="text-sm">{label[lang === 'he' ? 'he' : 'en']}</span>
                      {isCurrent && (
                        <span className="ml-2 text-[10px] text-blue-400 font-medium uppercase">
                          {lang === 'he' ? '← כאן' : '← current'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </FadeIn>
      )}

      {/* Order Info */}
      <FadeIn delay={200}>
        <Card className="p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{lang === 'he' ? 'מסירה' : 'Delivery'}</span>
            <span className="flex items-center gap-1.5">
              {order.delivery_method === 'pickup' ? <MapPin className="w-3.5 h-3.5 text-slate-400" /> : <Truck className="w-3.5 h-3.5 text-slate-400" />}
              {order.delivery_method === 'pickup' ? (lang === 'he' ? 'איסוף' : 'Pickup') : (lang === 'he' ? 'משלוח' : 'Shipping')}
            </span>
          </div>
          {order.shipping_address && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">{lang === 'he' ? 'כתובת' : 'Address'}</span>
              <span className="text-slate-300 text-right max-w-[200px]">{order.shipping_address}</span>
            </div>
          )}
          {order.buyer_note && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">{lang === 'he' ? 'הערה' : 'Note'}</span>
              <span className="text-slate-300 text-right max-w-[200px]">{order.buyer_note}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{lang === 'he' ? (isBuyer ? 'מוכר' : 'קונה') : (isBuyer ? 'Seller' : 'Buyer')}</span>
            <span className="text-slate-300 flex items-center gap-1.5">
              {(isBuyer ? order.seller?.full_name : order.buyer?.full_name) || '—'}
              {isBuyer && order.seller?.is_verified && <Shield className="w-3 h-3 text-blue-400" />}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">{lang === 'he' ? 'תאריך' : 'Date'}</span>
            <span className="text-slate-300">{new Date(order.created_at).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US')}</span>
          </div>
        </Card>
      </FadeIn>

      {/* Action Buttons */}
      {!isTerminal && (
        <FadeIn delay={250}>
          <div className="space-y-3">
            {/* Seller: Accept order */}
            {isSeller && order.status === 'pending' && (
              <Btn primary className="w-full py-4" onClick={() => handleAction('accepted')} disabled={updating}>
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-5 h-5" />}
                {lang === 'he' ? 'אשר הזמנה' : 'Accept Order'}
              </Btn>
            )}

            {/* Seller: Mark as shipped/ready */}
            {isSeller && order.status === 'accepted' && (
              <Btn primary className="w-full py-4" onClick={() => handleAction(order.delivery_method === 'shipping' ? 'shipped' : 'ready_pickup')} disabled={updating}>
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : (order.delivery_method === 'shipping' ? <Truck className="w-5 h-5" /> : <MapPin className="w-5 h-5" />)}
                {order.delivery_method === 'shipping'
                  ? (lang === 'he' ? 'סמן כנשלח' : 'Mark as Shipped')
                  : (lang === 'he' ? 'מוכן לאיסוף' : 'Ready for Pickup')}
              </Btn>
            )}

            {/* Buyer: Confirm delivery */}
            {isBuyer && (order.status === 'shipped' || order.status === 'ready_pickup') && (
              <Btn primary className="w-full py-4" onClick={() => handleAction('delivered')} disabled={updating}>
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-5 h-5" />}
                {lang === 'he' ? 'קיבלתי את המוצר' : 'I Received the Item'}
              </Btn>
            )}

            {/* Buyer: Complete transaction */}
            {isBuyer && order.status === 'delivered' && (
              <div className="space-y-2">
                <Card className="p-4" gradient="linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.03))">
                  <p className="text-sm text-emerald-200 text-center">
                    {lang === 'he'
                      ? 'קיבלת את המוצר? אשר את העסקה כדי להשלים'
                      : 'Got the item? Confirm to complete the transaction'}
                  </p>
                </Card>
                <Btn primary className="w-full py-4" onClick={() => handleAction('completed')} disabled={updating}>
                  {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                  {lang === 'he' ? 'אשר והשלם עסקה' : 'Confirm & Complete'}
                </Btn>
              </div>
            )}

            {/* Contact other party */}
            <button onClick={handleContactParty} className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-medium flex items-center justify-center gap-2 hover:bg-white/10 transition-all">
              <MessageCircle className="w-4 h-4" />
              {lang === 'he'
                ? (isBuyer ? 'שלח הודעה למוכר' : 'שלח הודעה לקונה')
                : (isBuyer ? 'Message Seller' : 'Message Buyer')}
            </button>

            {/* Cancel */}
            {(order.status === 'pending' || (order.status === 'accepted' && isBuyer)) && (
              <button onClick={() => setShowCancel(true)} className="w-full py-3 text-red-400/70 text-sm hover:text-red-400 transition-colors">
                {lang === 'he' ? 'בטל הזמנה' : 'Cancel Order'}
              </button>
            )}
          </div>
        </FadeIn>
      )}

      {/* Completed Badge + Review Prompt */}
      {order.status === 'completed' && (
        <FadeIn delay={250}>
          <Card className="p-6 text-center" gradient="linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))">
            <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-emerald-300">{lang === 'he' ? 'העסקה הושלמה!' : 'Transaction Complete!'}</h3>
            <p className="text-sm text-slate-400 mt-1">{lang === 'he' ? 'תודה על השימוש ב-GetWorth' : 'Thanks for using GetWorth'}</p>
          </Card>
        </FadeIn>
      )}

      {/* Review Form — buyer only, after completion */}
      {order.status === 'completed' && isBuyer && !reviewDone && (
        <FadeIn delay={300}>
          <Card className="p-5 space-y-4" gradient="linear-gradient(135deg, rgba(251,191,36,0.08), rgba(251,191,36,0.02))">
            <div className="text-center">
              <Star className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
              <h4 className="font-bold">{lang === 'he' ? 'דרג את המוכר' : 'Rate the Seller'}</h4>
              <p className="text-xs text-slate-400 mt-1">
                {lang === 'he' ? 'הביקורת שלך עוזרת לקונים אחרים' : 'Your review helps other buyers'}
              </p>
            </div>

            {/* Star rating */}
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setReviewRating(star)}
                  className="p-1 transition-transform hover:scale-110 active:scale-95"
                >
                  <Star className={`w-9 h-9 transition-colors ${
                    star <= reviewRating
                      ? 'text-yellow-400 fill-current'
                      : 'text-slate-600'
                  }`} />
                </button>
              ))}
            </div>

            {/* Rating label */}
            {reviewRating > 0 && (
              <p className="text-center text-sm font-medium text-yellow-300">
                {reviewRating === 1 ? (lang === 'he' ? 'גרוע' : 'Poor') :
                 reviewRating === 2 ? (lang === 'he' ? 'לא טוב' : 'Fair') :
                 reviewRating === 3 ? (lang === 'he' ? 'בסדר' : 'OK') :
                 reviewRating === 4 ? (lang === 'he' ? 'טוב' : 'Good') :
                 (lang === 'he' ? 'מעולה!' : 'Excellent!')}
              </p>
            )}

            {/* Comment */}
            <textarea
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              placeholder={lang === 'he' ? 'ספר על החוויה שלך (אופציונלי)' : 'Tell us about your experience (optional)'}
              className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-yellow-500/50"
              rows={2}
            />

            {/* Submit */}
            <Btn
              primary
              className="w-full py-3.5"
              disabled={reviewRating === 0 || reviewSubmitting}
              onClick={async () => {
                setReviewSubmitting(true);
                const ok = await submitReview(order.id, order.listing_id, order.seller_id, reviewRating, reviewComment);
                setReviewSubmitting(false);
                if (ok) setReviewDone(true);
              }}
            >
              {reviewSubmitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" />{lang === 'he' ? 'שולח...' : 'Submitting...'}</>
              ) : (
                <><Star className="w-4 h-4" />{lang === 'he' ? 'שלח ביקורת' : 'Submit Review'}</>
              )}
            </Btn>
          </Card>
        </FadeIn>
      )}

      {/* Review submitted confirmation */}
      {reviewDone && (
        <FadeIn>
          <Card className="p-4 text-center" gradient="linear-gradient(135deg, rgba(251,191,36,0.1), rgba(251,191,36,0.03))">
            <div className="flex items-center justify-center gap-2">
              <CheckCircle className="w-5 h-5 text-yellow-400" />
              <span className="text-sm font-semibold text-yellow-300">{lang === 'he' ? 'הביקורת נשלחה!' : 'Review submitted!'}</span>
            </div>
          </Card>
        </FadeIn>
      )}

      {/* Cancelled */}
      {order.status === 'cancelled' && (
        <FadeIn delay={250}>
          <Card className="p-5 text-center" gradient="linear-gradient(135deg, rgba(239,68,68,0.1), rgba(239,68,68,0.03))">
            <XCircle className="w-10 h-10 text-red-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-red-300">{lang === 'he' ? 'ההזמנה בוטלה' : 'Order Cancelled'}</p>
            {order.cancel_reason && <p className="text-xs text-slate-400 mt-1">{order.cancel_reason}</p>}
          </Card>
        </FadeIn>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancel && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm animate-fadeIn">
          <SlideUp className="w-full max-w-md">
            <div className="bg-gradient-to-b from-[#151d30] to-[#0a1020] rounded-t-[2rem] p-6 space-y-4">
              <div className="w-12 h-1 bg-white/20 rounded-full mx-auto" />
              <h3 className="text-lg font-bold text-center text-red-300">
                {lang === 'he' ? 'בטל הזמנה?' : 'Cancel Order?'}
              </h3>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={lang === 'he' ? 'סיבת ביטול (אופציונלי)' : 'Reason for cancellation (optional)'}
                className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-red-500/50"
                rows={2}
              />
              <div className="flex gap-3">
                <button onClick={() => setShowCancel(false)} className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-sm font-medium">
                  {lang === 'he' ? 'חזור' : 'Go Back'}
                </button>
                <button onClick={handleCancel} disabled={updating}
                  className="flex-1 py-3 rounded-xl bg-red-600/20 border border-red-500/30 text-sm font-semibold text-red-300 flex items-center justify-center gap-2">
                  {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  {lang === 'he' ? 'בטל' : 'Cancel Order'}
                </button>
              </div>
            </div>
          </SlideUp>
        </div>
      )}
    </div>
  );
}