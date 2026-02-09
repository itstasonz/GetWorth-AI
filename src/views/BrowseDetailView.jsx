import React, { useMemo, useState } from 'react';
import { Search, SlidersHorizontal, RefreshCw, Smartphone, Watch, Shirt, Dumbbell, Grid, Box, Heart, Eye, Clock, MapPin, ChevronRight, ChevronLeft, Package, Shield, Star, ShoppingBag, MessageCircle, Phone, Check, Loader2, DollarSign, X, Send, Tag } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, Badge, FadeIn, SlideUp } from '../components/ui';
import ListingCard from '../components/ListingCard';
import { formatPrice, timeAgo, getConditionLabel, getConditionColorAlpha, getSellerBadgeStyle, getSellerBadgeLabel, STAT_COLORS } from '../lib/utils';

export function BrowseView() {
  const {
    t, lang, rtl, listings, search, setSearch, category, setCategory,
    priceRange, setPriceRange, sort, setSort, showFilters, setShowFilters,
    savedIds, heartAnim, toggleSave, viewItem, loadListings,
    hasMore, loadingMore, loadMoreListings,
  } = useApp();

  const categories = [
    { id: 'all', label: t.all, icon: Grid },
    { id: 'Electronics', label: t.phones, icon: Smartphone },
    { id: 'Furniture', label: t.furniture, icon: Box },
    { id: 'Watches', label: t.watches, icon: Watch },
    { id: 'Clothing', label: t.clothing, icon: Shirt },
    { id: 'Sports', label: t.sports, icon: Dumbbell }
  ];

  const sortedListings = useMemo(() => {
    let arr = [...listings];
    if (sort === 'lowHigh') arr.sort((a, b) => a.price - b.price);
    else if (sort === 'highLow') arr.sort((a, b) => b.price - a.price);
    return arr;
  }, [listings, sort]);

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="relative">
          <Search className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'right-4' : 'left-4'} w-5 h-5 text-slate-500`} />
          <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)}
            className={`w-full py-4 ${rtl ? 'pr-12 pl-14' : 'pl-12 pr-14'} rounded-2xl bg-white/5 border border-white/10 focus:border-blue-500/50 focus:bg-white/10 transition-all`} />
          <button onClick={() => setShowFilters(!showFilters)}
            className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'left-3' : 'right-3'} p-2 rounded-xl transition-all ${showFilters ? 'bg-blue-600 shadow-lg shadow-blue-500/30' : 'bg-white/10 hover:bg-white/20'}`}>
            <SlidersHorizontal className="w-5 h-5" />
          </button>
        </div>
      </FadeIn>

      <FadeIn delay={50}>
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide">
          {categories.map((c) => (
            <button key={c.id} onClick={() => setCategory(c.id)}
              className={`flex-shrink-0 px-4 py-3 rounded-2xl flex items-center gap-2 text-xs font-semibold transition-all ${category === c.id ? 'bg-gradient-to-r from-blue-600 to-blue-500 shadow-lg shadow-blue-500/30' : 'bg-white/5 hover:bg-white/10 border border-white/10'}`}>
              <c.icon className="w-4 h-4" />{c.label}
            </button>
          ))}
        </div>
      </FadeIn>

      {showFilters && (
        <FadeIn>
          <Card className="p-4 space-y-4">
            <div>
              <label className="text-xs text-slate-500 font-medium mb-2 block">{lang === 'he' ? 'טווח מחיר' : 'Price Range'}</label>
              <div className="flex gap-3">
                <input type="number" placeholder={lang === 'he' ? 'מינימום' : 'Min'} value={priceRange.min} onChange={(e) => setPriceRange({ ...priceRange, min: e.target.value })}
                  className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm" />
                <input type="number" placeholder={lang === 'he' ? 'מקסימום' : 'Max'} value={priceRange.max} onChange={(e) => setPriceRange({ ...priceRange, max: e.target.value })}
                  className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm" />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium mb-2 block">{lang === 'he' ? 'מיון' : 'Sort'}</label>
              <div className="flex gap-2">
                {[
                  { id: 'newest', label: lang === 'he' ? 'חדש' : 'Newest' },
                  { id: 'lowHigh', label: lang === 'he' ? 'מחיר ↑' : 'Price ↑' },
                  { id: 'highLow', label: lang === 'he' ? 'מחיר ↓' : 'Price ↓' }
                ].map((s) => (
                  <button key={s.id} onClick={() => setSort(s.id)}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold ${sort === s.id ? 'bg-blue-600' : 'bg-white/5'}`}>{s.label}</button>
                ))}
              </div>
            </div>
          </Card>
        </FadeIn>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{sortedListings.length} {lang === 'he' ? 'פריטים' : 'items'}</p>
        <button onClick={() => loadListings(true)} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-all">
          <RefreshCw className="w-4 h-4 text-slate-500" />
        </button>
      </div>

      {sortedListings.length === 0 ? (
        <FadeIn className="text-center py-10">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-3">
            <Search className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-slate-500">{t.noResults}</p>
        </FadeIn>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {sortedListings.map((item, i) => (
            <ListingCard key={item.id} item={item} index={i} lang={lang} t={t} rtl={rtl} savedIds={savedIds} heartAnim={heartAnim} toggleSave={toggleSave} viewItem={viewItem} />
          ))}
        </div>
      )}

      {hasMore && sortedListings.length > 0 && (
        <FadeIn>
          <button onClick={loadMoreListings} disabled={loadingMore} className="w-full py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-sm text-slate-400 font-medium transition-all flex items-center justify-center gap-2">
            {loadingMore ? <><Loader2 className="w-4 h-4 animate-spin" />{lang === 'he' ? 'טוען...' : 'Loading...'}</> : (lang === 'he' ? 'טען עוד' : 'Load More')}
          </button>
        </FadeIn>
      )}
    </div>
  );
}

// ─── Detail View with Make Offer ───
export function DetailView() {
  const { t, lang, rtl, user, selected, setSelected, setView, tab, savedIds, toggleSave, contactSeller, viewSellerProfile, startConversation, setShowSignInModal, setSignInAction } = useApp();
  const [showOffer, setShowOffer] = useState(false);
  const [offerPrice, setOfferPrice] = useState('');
  const [offerMessage, setOfferMessage] = useState('');
  const [offerSent, setOfferSent] = useState(false);
  const [sendingOffer, setSendingOffer] = useState(false);

  if (!selected) return null;

  const suggestedOffers = selected.price ? [
    { pct: 80, label: '80%', amount: Math.round(selected.price * 0.8) },
    { pct: 85, label: '85%', amount: Math.round(selected.price * 0.85) },
    { pct: 90, label: '90%', amount: Math.round(selected.price * 0.9) },
  ] : [];

  const handleMakeOffer = () => {
    if (!user) {
      setSignInAction('contact');
      setShowSignInModal(true);
      return;
    }
    setOfferPrice(suggestedOffers[1]?.amount?.toString() || '');
    setOfferMessage(lang === 'he' ? `היי, אשמח לרכוש את ${selected.title_hebrew || selected.title}` : `Hi, I'm interested in ${selected.title}`);
    setShowOffer(true);
  };

  const sendOffer = async () => {
    if (!offerPrice || !user) return;
    setSendingOffer(true);

    // Start conversation with the offer as first message
    const offerText = lang === 'he'
      ? `💰 הצעת מחיר: ₪${parseInt(offerPrice).toLocaleString()}\n\n${offerMessage}`
      : `💰 Offer: ₪${parseInt(offerPrice).toLocaleString()}\n\n${offerMessage}`;

    try {
      // Use startConversation to open chat, then we'll send the offer message
      await startConversation(selected);

      // Small delay to let the conversation open
      setTimeout(() => {
        setSendingOffer(false);
        setShowOffer(false);
        setOfferSent(true);
        setTimeout(() => setOfferSent(false), 3000);
      }, 500);
    } catch (e) {
      console.error('Offer error:', e);
      setSendingOffer(false);
    }
  };

  return (
    <div className="space-y-5 -mx-5 -mt-4">
      {/* Image */}
      <div className="relative">
        <div className="aspect-square">
          <img src={selected.images?.[0]} className="w-full h-full object-cover" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#060a14] via-transparent to-[#060a14]/50" />

        <button onClick={() => { setSelected(null); setView(tab === 'home' ? 'home' : 'browse'); }}
          className={`absolute top-4 ${rtl ? 'right-4' : 'left-4'} w-12 h-12 rounded-2xl bg-black/30 backdrop-blur-md flex items-center justify-center hover:bg-black/50 transition-all`}>
          {rtl ? <ChevronRight className="w-6 h-6" /> : <ChevronLeft className="w-6 h-6" />}
        </button>

        <button onClick={() => !selected.id?.toString().startsWith('s') && toggleSave(selected)}
          className={`absolute top-4 ${rtl ? 'left-4' : 'right-4'} w-12 h-12 rounded-2xl flex items-center justify-center transition-all backdrop-blur-md ${savedIds.has(selected.id) ? 'bg-red-500 shadow-lg shadow-red-500/50' : 'bg-black/30 hover:bg-black/50'}`}>
          <Heart className={`w-6 h-6 ${savedIds.has(selected.id) ? 'fill-current' : ''}`} />
        </button>

        {selected.condition && (
          <div className={`absolute bottom-4 ${rtl ? 'right-4' : 'left-4'} px-3 py-1.5 rounded-xl text-xs font-bold uppercase backdrop-blur-md ${getConditionColorAlpha(selected.condition)}`}>
            {getConditionLabel(selected.condition, lang)}
          </div>
        )}
      </div>

      <div className="px-5 space-y-4">
        {/* Seller Card */}
        {selected.seller && (
          <FadeIn>
            <Card
              className="p-4 cursor-pointer active:scale-[0.98] transition-transform"
              gradient="linear-gradient(135deg, rgba(59,130,246,0.1), rgba(139,92,246,0.05))"
              onClick={() => {
                const sellerId = selected.seller_id || selected.seller?.id;
                if (sellerId && !selected.id?.toString().startsWith('s')) {
                  viewSellerProfile(sellerId);
                }
              }}
            >
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold shadow-lg bg-gradient-to-br ${getSellerBadgeStyle(selected.seller.badge).gradient} ${getSellerBadgeStyle(selected.seller.badge).shadow}`}>
                    {selected.seller.full_name?.charAt(0) || 'S'}
                  </div>
                  {selected.seller.is_verified && (
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center border-2 border-[#060a14]">
                      <Check className="w-3.5 h-3.5 text-white" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">{selected.seller.full_name || 'Seller'}</span>
                    {selected.seller.is_verified && <Shield className="w-4 h-4 text-blue-400" />}
                  </div>
                  {selected.seller.badge && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase ${getSellerBadgeStyle(selected.seller.badge).bg} ${getSellerBadgeStyle(selected.seller.badge).text}`}>
                        {getSellerBadgeLabel(selected.seller.badge, lang)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    {selected.seller.rating && (
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 text-yellow-400 fill-current" />
                        <span className="text-sm font-semibold">{selected.seller.rating}</span>
                      </div>
                    )}
                    {selected.seller.total_sales > 0 && (
                      <div className="flex items-center gap-1 text-slate-400">
                        <ShoppingBag className="w-3.5 h-3.5" />
                        <span className="text-xs">{selected.seller.total_sales} {lang === 'he' ? 'מכירות' : 'sales'}</span>
                      </div>
                    )}
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-500" />
              </div>
              <p className="text-[10px] text-slate-500 mt-2 text-center">{lang === 'he' ? 'לחץ לצפייה בפרופיל ובפריטים' : 'Tap to view profile & listings'}</p>
            </Card>
          </FadeIn>
        )}

        {/* Title & Price */}
        <FadeIn delay={50}>
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {selected.category && <Badge>{selected.category}</Badge>}
              <span className="text-xs text-slate-500 flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{selected.views || 0} {lang === 'he' ? 'צפיות' : 'views'}</span>
              <span className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{timeAgo(selected.created_at, t)}</span>
            </div>
            <h1 className="text-2xl font-bold">{lang === 'he' && selected.title_hebrew ? selected.title_hebrew : selected.title}</h1>
            <div className="flex items-center gap-2 mt-1"><MapPin className="w-4 h-4 text-slate-500" /><span className="text-sm text-slate-400">{selected.location}</span></div>
          </div>
          <p className="text-4xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent mt-3">{formatPrice(selected.price)}</p>
        </FadeIn>

        {/* Description */}
        {(selected.description || selected.description_hebrew) && (
          <FadeIn delay={100}>
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2"><Package className="w-5 h-5 text-blue-400" />{lang === 'he' ? 'תיאור' : 'Description'}</h3>
              <p className="text-sm text-slate-300 leading-relaxed">{lang === 'he' && selected.description_hebrew ? selected.description_hebrew : selected.description}</p>
            </Card>
          </FadeIn>
        )}

        {/* Action Buttons: Contact + Make Offer + Save */}
        <FadeIn delay={150} className="space-y-3 pb-6">
          {/* Offer Sent Success */}
          {offerSent && (
            <div className="p-3 rounded-2xl bg-green-500/20 border border-green-500/30 text-center">
              <p className="text-sm font-semibold text-green-400 flex items-center justify-center gap-2">
                <Check className="w-4 h-4" />
                {lang === 'he' ? 'ההצעה נשלחה! בדוק בהודעות' : 'Offer sent! Check your messages'}
              </p>
            </div>
          )}

          <div className="flex gap-3">
            {/* Make Offer Button */}
            <Btn className="flex-1 py-4" onClick={handleMakeOffer}
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                boxShadow: '0 8px 24px rgba(16,185,129,0.4), inset 0 1px 0 rgba(255,255,255,0.2)',
              }}>
              <Tag className="w-5 h-5" />
              {lang === 'he' ? 'הצע מחיר' : 'Make Offer'}
            </Btn>

            {/* Contact Button */}
            <Btn primary className="flex-1 py-4" onClick={contactSeller}>
              <MessageCircle className="w-5 h-5" />
              {lang === 'he' ? 'צור קשר' : 'Contact'}
            </Btn>
          </div>

          {/* Save Button */}
          <Btn onClick={() => !selected.id?.toString().startsWith('s') && toggleSave(selected)} className="w-full py-3">
            <Heart className={`w-5 h-5 ${savedIds.has(selected.id) ? 'fill-current text-red-400' : ''}`} />
            {savedIds.has(selected.id) ? (lang === 'he' ? 'שמור ♥' : 'Saved ♥') : (lang === 'he' ? 'שמור למועדפים' : 'Save to Favorites')}
          </Btn>
        </FadeIn>
      </div>

      {/* ─── Make Offer Modal ─── */}
      {showOffer && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm animate-fadeIn" onClick={() => setShowOffer(false)}>
          <div className="w-full max-w-md animate-slideUp" onClick={(e) => e.stopPropagation()}>
            <div className="bg-gradient-to-b from-[#151d30] to-[#0a1020] rounded-t-[2rem] p-6 space-y-5">
              {/* Handle */}
              <div className="w-12 h-1 bg-white/20 rounded-full mx-auto" />

              {/* Header */}
              <div className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500/30 to-emerald-500/30 border border-green-500/30 flex items-center justify-center mx-auto mb-3">
                  <Tag className="w-7 h-7 text-green-400" />
                </div>
                <h3 className="text-xl font-bold">{lang === 'he' ? 'הצע מחיר' : 'Make an Offer'}</h3>
                <p className="text-sm text-slate-400 mt-1">
                  {lang === 'he' ? `מחיר מבוקש: ${formatPrice(selected.price)}` : `Asking price: ${formatPrice(selected.price)}`}
                </p>
              </div>

              {/* Quick Offer Buttons */}
              <div>
                <p className="text-xs text-slate-500 mb-2">{lang === 'he' ? 'הצעות מהירות' : 'Quick offers'}</p>
                <div className="flex gap-2">
                  {suggestedOffers.map((s) => (
                    <button key={s.pct} onClick={() => setOfferPrice(s.amount.toString())}
                      className={`flex-1 py-3 rounded-xl text-center transition-all ${offerPrice === s.amount.toString() ? 'bg-green-500/30 border border-green-500/50 text-green-400' : 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'}`}>
                      <p className="text-sm font-bold">₪{s.amount.toLocaleString()}</p>
                      <p className="text-[10px] text-slate-500">{s.label}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Price Input */}
              <div>
                <p className="text-xs text-slate-500 mb-2">{lang === 'he' ? 'או הזן סכום' : 'Or enter amount'}</p>
                <div className="relative">
                  <span className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'right-4' : 'left-4'} text-lg font-bold text-green-400`}>₪</span>
                  <input
                    type="number"
                    value={offerPrice}
                    onChange={(e) => setOfferPrice(e.target.value)}
                    placeholder="0"
                    className={`w-full py-4 ${rtl ? 'pr-12 pl-4' : 'pl-12 pr-4'} rounded-2xl bg-white/5 border border-white/10 text-2xl font-bold text-white text-center focus:outline-none focus:border-green-500/50 focus:bg-white/10 transition-all`}
                  />
                </div>
                {offerPrice && selected.price && (
                  <p className="text-xs text-slate-500 text-center mt-2">
                    {Math.round((parseInt(offerPrice) / selected.price) * 100)}% {lang === 'he' ? 'מהמחיר המבוקש' : 'of asking price'}
                  </p>
                )}
              </div>

              {/* Message */}
              <div>
                <p className="text-xs text-slate-500 mb-2">{lang === 'he' ? 'הודעה למוכר (אופציונלי)' : 'Message to seller (optional)'}</p>
                <textarea
                  value={offerMessage}
                  onChange={(e) => setOfferMessage(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-green-500/50 resize-none"
                  placeholder={lang === 'he' ? 'הוסף הודעה...' : 'Add a message...'}
                  dir={rtl ? 'rtl' : 'ltr'}
                />
              </div>

              {/* Send Button */}
              <button
                onClick={sendOffer}
                disabled={!offerPrice || sendingOffer}
                className="w-full py-4 rounded-2xl font-bold text-white flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', boxShadow: '0 8px 24px rgba(16,185,129,0.4)' }}
              >
                {sendingOffer ? (
                  <><Loader2 className="w-5 h-5 animate-spin" />{lang === 'he' ? 'שולח...' : 'Sending...'}</>
                ) : (
                  <><Send className="w-5 h-5" />{lang === 'he' ? `שלח הצעה של ₪${parseInt(offerPrice || 0).toLocaleString()}` : `Send ₪${parseInt(offerPrice || 0).toLocaleString()} Offer`}</>
                )}
              </button>

              {/* Cancel */}
              <button onClick={() => setShowOffer(false)} className="w-full py-3 text-slate-400 text-sm">
                {lang === 'he' ? 'ביטול' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Seller Profile View ───
export function SellerProfileView() {
  const { lang, rtl, sellerProfile, sellerListings, loadingSeller, setView, tab, savedIds, heartAnim, toggleSave, viewItem } = useApp();

  if (loadingSeller) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!sellerProfile) return null;

  return (
    <div className="space-y-5">
      {/* Back */}
      <FadeIn>
        <button onClick={() => setView('detail')} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
          {rtl ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          {lang === 'he' ? 'חזרה' : 'Back'}
        </button>
      </FadeIn>

      {/* Seller Card */}
      <FadeIn delay={50}>
        <Card className="p-6 text-center" gradient="linear-gradient(135deg, rgba(59,130,246,0.1), rgba(139,92,246,0.05))">
          <div className="relative inline-block">
            <div className={`w-24 h-24 rounded-3xl flex items-center justify-center text-4xl font-bold shadow-xl mx-auto bg-gradient-to-br ${getSellerBadgeStyle(sellerProfile.badge).gradient} ${getSellerBadgeStyle(sellerProfile.badge).shadow}`}>
              {sellerProfile.full_name?.charAt(0) || 'S'}
            </div>
            {sellerProfile.is_verified && (
              <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center border-3 border-[#060a14]">
                <Check className="w-5 h-5 text-white" />
              </div>
            )}
          </div>
          <h2 className="text-2xl font-bold mt-4">{sellerProfile.full_name || 'Seller'}</h2>
          {sellerProfile.badge && (
            <span className={`inline-block mt-2 px-3 py-1 rounded-lg text-xs font-bold uppercase ${getSellerBadgeStyle(sellerProfile.badge).bg} ${getSellerBadgeStyle(sellerProfile.badge).text}`}>
              {getSellerBadgeLabel(sellerProfile.badge, lang)}
            </span>
          )}
          <div className="flex items-center justify-center gap-4 mt-3">
            {sellerProfile.rating && (
              <div className="flex items-center gap-1">
                <Star className="w-4 h-4 text-yellow-400 fill-current" />
                <span className="font-semibold">{sellerProfile.rating}</span>
              </div>
            )}
            {sellerProfile.is_verified && (
              <div className="flex items-center gap-1 text-blue-400">
                <Shield className="w-4 h-4" />
                <span className="text-xs font-medium">{lang === 'he' ? 'מאומת' : 'Verified'}</span>
              </div>
            )}
          </div>
          {sellerProfile.bio && (
            <p className="text-sm text-slate-400 mt-3 max-w-xs mx-auto">{sellerProfile.bio}</p>
          )}
        </Card>
      </FadeIn>

      {/* Seller's Listings */}
      <FadeIn delay={100}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">{lang === 'he' ? 'הפריטים של' : 'Listings by'} {sellerProfile.full_name?.split(' ')[0] || 'Seller'}</h3>
          <Badge>{sellerListings.length} {lang === 'he' ? 'פריטים' : 'items'}</Badge>
        </div>
      </FadeIn>

      {sellerListings.length === 0 ? (
        <FadeIn delay={150} className="text-center py-10">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-3">
            <ShoppingBag className="w-8 h-8 text-slate-600" />
          </div>
          <p className="text-slate-500 text-sm">{lang === 'he' ? 'אין פריטים פעילים' : 'No active listings'}</p>
        </FadeIn>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {sellerListings.map((item, i) => (
            <ListingCard key={item.id} item={item} index={i} lang={lang} t={{}} rtl={rtl} savedIds={savedIds} heartAnim={heartAnim} toggleSave={toggleSave} viewItem={viewItem} />
          ))}
        </div>
      )}
    </div>
  );
}
