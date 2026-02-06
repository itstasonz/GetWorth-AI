import React, { useMemo } from 'react';
import { Search, SlidersHorizontal, RefreshCw, Smartphone, Watch, Shirt, Dumbbell, Grid, Box, Heart, Eye, Clock, MapPin, ChevronRight, ChevronLeft, Package, Shield, Star, ShoppingBag, MessageCircle, Phone, Check, Loader2 } from 'lucide-react';
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
          <Card className="p-5 space-y-4">
            <div className="flex justify-between items-center">
              <span className="font-semibold">{t.filters}</span>
              <button onClick={() => { setPriceRange({ min: '', max: '' }); setSort('newest'); }} className="text-xs text-blue-400 hover:text-blue-300">{t.clear}</button>
            </div>
            <div className="flex gap-3">
              <input type="number" placeholder={t.min} value={priceRange.min} onChange={(e) => setPriceRange({ ...priceRange, min: e.target.value })} className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm" />
              <span className="self-center text-slate-500">—</span>
              <input type="number" placeholder={t.max} value={priceRange.max} onChange={(e) => setPriceRange({ ...priceRange, max: e.target.value })} className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['newest', 'lowHigh', 'highLow'].map((s) => (
                <button key={s} onClick={() => setSort(s)} className={`py-3 rounded-xl text-xs font-semibold transition-all ${sort === s ? 'bg-blue-600 shadow-lg shadow-blue-500/20' : 'bg-white/5 hover:bg-white/10'}`}>{t[s]}</button>
              ))}
            </div>
          </Card>
        </FadeIn>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{sortedListings.length} {t.results}</p>
        <button onClick={() => loadListings(true)} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {sortedListings.length === 0 ? (
        <FadeIn className="text-center py-16">
          <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mx-auto mb-4">
            <Search className="w-10 h-10 text-slate-600" />
          </div>
          <p className="text-slate-400 font-medium">{t.noResults}</p>
        </FadeIn>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            {sortedListings.map((item, i) => (
              <ListingCard key={item.id} item={item} index={i} lang={lang} t={t} rtl={rtl} savedIds={savedIds} heartAnim={heartAnim} toggleSave={toggleSave} viewItem={viewItem} />
            ))}
          </div>

          {hasMore && (
            <FadeIn className="text-center pt-4">
              <Btn onClick={loadMoreListings} disabled={loadingMore} className="mx-auto">
                {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {loadingMore ? (lang === 'he' ? 'טוען...' : 'Loading...') : (lang === 'he' ? 'טען עוד' : 'Load More')}
              </Btn>
            </FadeIn>
          )}
        </>
      )}
    </div>
  );
}

export function DetailView() {
  // [FIX #3] Added viewSellerProfile to navigate to seller's listings
  const { t, lang, rtl, user, selected, setSelected, setView, tab, savedIds, toggleSave, contactSeller, viewSellerProfile } = useApp();

  if (!selected) return null;

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
        {/* [FIX #3] Seller Card — now clickable to view seller's profile & listings */}
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

        {/* Contact */}
        <FadeIn delay={150} className="flex gap-3 pb-6">
          <Btn primary className="flex-1 py-4" onClick={contactSeller}>
            <MessageCircle className="w-5 h-5" />{lang === 'he' ? 'צור קשר' : 'Contact'}
          </Btn>
          <Btn onClick={() => !selected.id?.toString().startsWith('s') && toggleSave(selected)} className="px-5">
            <Heart className={`w-5 h-5 ${savedIds.has(selected.id) ? 'fill-current text-red-400' : ''}`} />
          </Btn>
        </FadeIn>
      </div>
    </div>
  );
}

// ─── [FIX #3] Seller Profile View — shows seller info + their listings ───
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
