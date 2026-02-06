import React from 'react';
import { ShoppingBag, Scan, Eye, Clock, Trash2, Heart, Box, Sparkles, Package, AlertTriangle, CheckCircle, Circle, Check, Share2, Loader2, Phone } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, Badge, FadeIn, ScaleIn, InputField, BackButton } from '../components/ui';
import ListingCard from '../components/ListingCard';
import LocationInput from '../components/LocationInput';
import { formatPrice, timeAgo, calcPrice } from '../lib/utils';

export function MyListingsView() {
  const { t, lang, rtl, user, myListings, deleteListing, goTab, reset } = useApp();

  return (
    <div className="space-y-5">
      <FadeIn className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t.myListings}</h2>
        {myListings.length > 0 && <Badge>{myListings.length} active</Badge>}
      </FadeIn>

      {!user ? (
        <FadeIn className="text-center py-16">
          <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mx-auto mb-4"><ShoppingBag className="w-10 h-10 text-slate-600" /></div>
          <p className="text-slate-400 mb-5">{t.signInList}</p>
          <Btn primary onClick={() => goTab('profile')}>{t.signIn}</Btn>
        </FadeIn>
      ) : myListings.length === 0 ? (
        <FadeIn>
          <Card className="p-10 text-center">
            <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mx-auto mb-4"><ShoppingBag className="w-10 h-10 text-slate-600" /></div>
            <p className="text-slate-400 mb-5">{t.noListings}</p>
            <Btn primary onClick={() => { reset(); goTab('home'); }}><Scan className="w-4 h-4" />{t.scan}</Btn>
          </Card>
        </FadeIn>
      ) : (
        <div className="space-y-4">
          {myListings.map((item, i) => (
            <FadeIn key={item.id} delay={i * 50}>
              <Card className="p-4 group">
                <div className="flex gap-4">
                  <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0">
                    <img src={item.images?.[0]} className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <h3 className="font-semibold truncate">{item.title}</h3>
                      <button onClick={() => deleteListing(item.id)} className="p-2 rounded-xl opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all">
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                    <p className="text-xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent mt-1">{formatPrice(item.price)}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{item.views || 0}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{timeAgo(item.created_at, t)}</span>
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

export function SavedView() {
  const { t, lang, rtl, user, savedItems, savedIds, heartAnim, toggleSave, viewItem, goTab } = useApp();

  return (
    <div className="space-y-5">
      <FadeIn><h2 className="text-2xl font-bold">{t.saved}</h2></FadeIn>
      {!user ? (
        <FadeIn className="text-center py-16">
          <div className="w-20 h-20 rounded-3xl bg-red-500/10 flex items-center justify-center mx-auto mb-4"><Heart className="w-10 h-10 text-red-400" /></div>
          <p className="text-slate-400 mb-5">{t.signInSave}</p>
          <Btn primary onClick={() => goTab('profile')}>{t.signIn}</Btn>
        </FadeIn>
      ) : savedItems.length === 0 ? (
        <FadeIn className="text-center py-16">
          <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mx-auto mb-4"><Heart className="w-10 h-10 text-slate-600" /></div>
          <p className="text-slate-400 mb-5">{t.noSaved}</p>
          <Btn primary onClick={() => goTab('browse')}>{t.browse}</Btn>
        </FadeIn>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {savedItems.map((item, i) => (
            <ListingCard key={item.id} item={item} index={i} lang={lang} t={t} rtl={rtl} savedIds={savedIds} heartAnim={heartAnim} toggleSave={toggleSave} viewItem={viewItem} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ListingFlowView() {
  const {
    t, lang, rtl, result, condition, answers, setAnswers,
    listingStep, setListingStep, listingData, setListingData,
    publishing, publishListing, selectCondition, setView,
    reset, goTab, playSound,
  } = useApp();

  if (!result) return null;

  return (
    <div className="space-y-5">
      {/* Step 0: Condition */}
      {listingStep === 0 && (
        <>
          <BackButton onClick={() => setView('results')} rtl={rtl} label={t.back} />
          <FadeIn className="text-center"><h2 className="text-2xl font-bold">{t.condition}</h2></FadeIn>
          <div className="space-y-3">
            {[
              { id: 'newSealed', icon: Box, gradient: 'from-emerald-500 to-green-500' },
              { id: 'likeNew', icon: Sparkles, gradient: 'from-blue-500 to-cyan-500' },
              { id: 'used', icon: Package, gradient: 'from-amber-500 to-orange-500' },
              { id: 'poor', icon: AlertTriangle, gradient: 'from-red-500 to-pink-500' }
            ].map((c, i) => (
              <FadeIn key={c.id} delay={i * 50}>
                <button onClick={() => selectCondition(c.id)}
                  className={`w-full p-5 rounded-2xl border-2 flex items-center gap-4 transition-all ${condition === c.id ? 'border-blue-500 bg-blue-500/10 scale-[1.02]' : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/5'}`}>
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${c.gradient} flex items-center justify-center shadow-lg`}>
                    <c.icon className="w-7 h-7 text-white" />
                  </div>
                  <span className="flex-1 font-semibold text-lg text-left">{t[c.id]}</span>
                  {condition === c.id ? <CheckCircle className="w-6 h-6 text-blue-400" /> : <Circle className="w-6 h-6 text-slate-600" />}
                </button>
              </FadeIn>
            ))}
          </div>
        </>
      )}

      {/* Step 1: Used condition details */}
      {listingStep === 1 && (
        <>
          <BackButton onClick={() => setListingStep(0)} rtl={rtl} label={t.back} />
          <FadeIn className="text-center"><h2 className="text-2xl font-bold">{t.more}</h2></FadeIn>
          <div className="space-y-4">
            {[
              { key: 'scratches', opts: ['yes', 'no'] },
              { key: 'battery', opts: ['good', 'degraded', 'poor'] },
              { key: 'issues', opts: ['yes', 'no'] }
            ].map((q, i) => (
              <FadeIn key={q.key} delay={i * 50}>
                <Card className="p-5">
                  <p className="font-medium mb-3">{t[q.key]}</p>
                  <div className="flex gap-2">
                    {q.opts.map((o) => (
                      <button key={o} onClick={() => setAnswers({ ...answers, [q.key]: o })}
                        className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all ${answers[q.key] === o ? 'bg-blue-600 shadow-lg shadow-blue-500/30' : 'bg-white/5 hover:bg-white/10'}`}>
                        {t[o]}
                      </button>
                    ))}
                  </div>
                </Card>
              </FadeIn>
            ))}
          </div>
          <FadeIn delay={150}>
            <Card className="p-5 text-center" gradient="linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))" glow>
              <p className="text-sm text-emerald-300 mb-1">{t.yourPrice}</p>
              <p className="text-4xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
                {formatPrice(calcPrice(result?.marketValue?.mid, 'used', answers))}
              </p>
            </Card>
          </FadeIn>
          <FadeIn delay={200}>
            <Btn primary className="w-full py-4" onClick={() => { setListingData((prev) => ({ ...prev, price: calcPrice(result?.marketValue?.mid, 'used', answers) })); setListingStep(2); }}>
              {t.continue}
            </Btn>
          </FadeIn>
        </>
      )}

      {/* Step 2: Review */}
      {listingStep === 2 && (
        <>
          <BackButton onClick={() => setListingStep(condition === 'used' ? 1 : 0)} rtl={rtl} label={t.back} />
          <FadeIn className="text-center"><h2 className="text-2xl font-bold">{t.review}</h2></FadeIn>
          <FadeIn delay={50}><InputField label={t.title} rtl={rtl} value={listingData.title} onChange={(e) => setListingData({ ...listingData, title: e.target.value })} /></FadeIn>
          <FadeIn delay={100}>
            <div className="space-y-2">
              <label className="text-sm text-slate-400 font-medium">{t.desc}</label>
              <textarea className="w-full px-4 py-4 rounded-2xl bg-white/5 border border-white/10 h-28 resize-none focus:border-blue-500/50 focus:bg-white/10 transition-all"
                value={listingData.desc} onChange={(e) => setListingData({ ...listingData, desc: e.target.value })} />
            </div>
          </FadeIn>
          <FadeIn delay={150}>
            <Card className="p-5" gradient="linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.02))">
              <span className="text-sm text-slate-400">{t.yourPrice}</span>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-3xl font-bold text-green-400">₪</span>
                <input type="number" className="flex-1 bg-transparent text-3xl font-bold text-green-400 focus:outline-none"
                  value={listingData.price} onChange={(e) => setListingData({ ...listingData, price: parseInt(e.target.value) || 0 })} />
              </div>
            </Card>
          </FadeIn>
          <FadeIn delay={200}><InputField label={t.phone} icon={Phone} rtl={rtl} placeholder="050-000-0000" value={listingData.phone} onChange={(e) => setListingData({ ...listingData, phone: e.target.value })} /></FadeIn>
          <FadeIn delay={250}>
            <LocationInput label={t.location} rtl={rtl} value={listingData.location}
              onChange={(e) => setListingData({ ...listingData, location: e.target.value })}
              placeholder={rtl ? 'תל אביב, ירושלים...' : 'Tel Aviv, Jerusalem...'} />
          </FadeIn>
          <FadeIn delay={300}>
            <Btn primary className="w-full py-4" onClick={publishListing} disabled={publishing}>
              {publishing ? <><Loader2 className="w-5 h-5 animate-spin" />{t.publishing}</> : <><Check className="w-5 h-5" />{t.publish}</>}
            </Btn>
          </FadeIn>
        </>
      )}

      {/* Step 3: Success */}
      {listingStep === 3 && (
        <div className="text-center py-10 space-y-6">
          <ScaleIn>
            <div className="relative w-28 h-28 mx-auto">
              <div className="absolute inset-0 bg-green-500/30 rounded-full animate-ping" />
              <div className="relative w-28 h-28 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center shadow-2xl shadow-green-500/40">
                <CheckCircle className="w-14 h-14 text-white" />
              </div>
            </div>
          </ScaleIn>
          <FadeIn delay={200}>
            <h2 className="text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">{t.published}</h2>
            <p className="text-slate-400 mt-2">{t.live}</p>
          </FadeIn>
          <FadeIn delay={300} className="flex gap-3 pt-4">
            <Btn className="flex-1" onClick={() => { reset(); goTab('sell'); }}><Eye className="w-4 h-4" />{t.view}</Btn>
            <Btn secondary className="flex-1"><Share2 className="w-4 h-4" />{t.share}</Btn>
          </FadeIn>
        </div>
      )}
    </div>
  );
}
