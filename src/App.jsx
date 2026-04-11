import React, { useEffect } from 'react';
import { DollarSign, Globe, Home, Search, ShoppingBag, MessageCircle, User, X, AlertCircle, Shield, Star, Phone, Volume2, VolumeX, ChevronRight, ChevronLeft, Bell, ArrowLeft, PlusCircle } from 'lucide-react';
import { AppProvider, useApp } from './contexts/AppContext';
import ErrorBoundary from './components/ErrorBoundary';
import { Card, Btn, Toast, FadeIn, SlideUp, ScaleIn } from './components/ui';
import { formatPrice, getSellerBadgeStyle } from './lib/utils';

export const BUILD_VERSION = '2.1.0-20260226';

// Views
import HomeView from './views/HomeView';
import { CameraView, AnalyzingView, ResultsView } from './views/CameraResultsView';
import { BrowseView, DetailView, SellerProfileView } from './views/BrowseDetailView';
import { InboxView, ChatView } from './views/ChatViews';
import { AuthView, ProfileView } from './views/AuthProfileView';
import { MyListingsView, SavedView, ListingFlowView } from './views/SellViews';
import { CheckoutSheet, OrdersView, OrderDetailView, NotificationsView } from './views/OrderViews';
import AnalyticsView from './views/AnalyticsView';
import AdminPanel from './views/AdminPanel';

// ─── In-App Message Notification Banner ───
// Slides down from top when a message arrives and user is NOT in that chat
function MessageNotificationBanner() {
  const { msgNotification, openNotification, dismissNotification, lang } = useApp();
  if (!msgNotification) return null;

  const n = msgNotification;
  return (
    <div className="fixed top-4 left-3 right-3 z-[60] animate-slideDown" style={{ pointerEvents: 'auto' }}>
      <div
        onClick={() => openNotification(n)}
        className="relative overflow-hidden rounded-2xl p-3.5 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform shadow-2xl"
        style={{
          background: 'linear-gradient(135deg, rgba(59,130,246,0.25) 0%, rgba(30,64,175,0.35) 100%)',
          border: '1px solid rgba(59,130,246,0.3)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        {/* Listing thumbnail or avatar */}
        <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-white/10">
          {n.listingImage ? (
            <img src={n.listingImage} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <MessageCircle className="w-6 h-6 text-blue-300" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-white truncate">{n.senderName}</span>
            {n.listingTitle && (
              <span className="text-[10px] text-blue-200 truncate max-w-[120px]">• {n.listingTitle}</span>
            )}
          </div>
          <p className="text-xs text-slate-200 truncate mt-0.5">
            {n.isOffer
              ? `💰 ${lang === 'he' ? 'הצעת מחיר' : 'Price offer'}: ₪${n.offerAmount?.toLocaleString() || ''}`
              : n.content
            }
          </p>
          <p className="text-[10px] text-blue-300 mt-1">
            {lang === 'he' ? 'לחץ לפתוח שיחה' : 'Tap to open chat'} →
          </p>
        </div>

        {/* Dismiss X */}
        <button
          onClick={(e) => { e.stopPropagation(); dismissNotification(); }}
          className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 hover:bg-white/20 transition-colors"
        >
          <X className="w-3.5 h-3.5 text-white/70" />
        </button>

        {/* Animated progress bar at bottom (auto-dismiss indicator) */}
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-400/20">
          <div className="h-full bg-blue-400/60 animate-notifProgress" />
        </div>
      </div>
    </div>
  );
}

function AppShell() {
  const {
    lang, setLang, t, rtl,
    user, profile, loading,
    tab, view, goTab, reset, handleFile,
    error, setError, toast, setToast,
    soundEnabled, setSoundEnabled,
    // Modals
    showSignInModal, setShowSignInModal, signInAction,
    showContact, setShowContact, selected, startConversation,
    // Misc
    myListings, unreadCount, notifUnreadCount, fileRef, orders,
  } = useApp();

  // Force service worker update on mount — prevents stale cached builds
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(r => {
          r.update().catch(() => {});
          if (r.waiting) r.waiting.postMessage({ type: 'SKIP_WAITING' });
        });
      });
    }
  }, []);

  // Loading screen
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#060a14]">
        <div className="text-center space-y-4">
          <div className="relative">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center animate-pulse shadow-2xl" style={{ background: 'linear-gradient(135deg, #6FEEE1 0%, #4FD1C5 100%)', boxShadow: '0 0 40px rgba(111,238,225,0.3)' }}>
              <DollarSign className="w-10 h-10" style={{ color: '#003733' }} />
            </div>
            <div className="absolute -inset-4 rounded-full blur-2xl animate-pulse" style={{ background: 'rgba(111,238,225,0.12)' }} />
          </div>
          <div className="flex gap-1 justify-center">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-2 h-2 rounded-full animate-bounce" style={{ background: '#6FEEE1', animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const tabItems = [
    { id: 'home', icon: Home, label: lang === 'he' ? 'בית' : 'Home' },
    { id: 'browse', icon: Search, label: lang === 'he' ? 'עיון' : 'Browse' },
    { id: 'sell', icon: PlusCircle, label: lang === 'he' ? 'מכור' : 'Sell' },
    { id: 'messages', icon: MessageCircle, label: lang === 'he' ? 'צ\'אט' : 'Chat' },
    { id: 'profile', icon: User, label: lang === 'he' ? 'פרופיל' : 'Profile' },
  ];


  return (
    <div className="min-h-screen text-white flex flex-col" style={{ fontFamily: rtl ? 'Heebo, sans-serif' : 'Inter, sans-serif', background: '#131313' }} dir={rtl ? 'rtl' : 'ltr'}>
      
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full blur-[120px]" style={{ background: 'rgba(111,238,225,0.06)' }} />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 right-0 w-[300px] h-[300px] bg-cyan-500/10 rounded-full blur-[80px]" />
      </div>

      {/* ── Message Notification Banner (renders above everything) ── */}
      <MessageNotificationBanner />

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {error && (
        <div className="fixed top-20 left-4 right-4 z-50 animate-slideDown">
          <Card className="p-4 flex items-center gap-3" gradient="linear-gradient(135deg, rgba(239,68,68,0.2), rgba(239,68,68,0.1))">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span className="flex-1 text-sm text-red-300">{error}</span>
            <button onClick={() => setError(null)} className="p-1 hover:bg-white/10 rounded-lg"><X className="w-4 h-4" /></button>
          </Card>
        </div>
      )}

      {/* Sign In Modal */}
      {showSignInModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-5 animate-fadeIn">
          <ScaleIn>
            <Card className="p-8 max-w-sm w-full text-center space-y-5" glow>
              <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto" style={{ background: 'rgba(111,238,225,0.12)' }}>
                <User className="w-10 h-10" style={{ color: '#6FEEE1' }} />
              </div>
              <h3 className="text-2xl font-bold">{t.signInReq}</h3>
              <p className="text-slate-400">{signInAction === 'save' ? t.signInSave : signInAction === 'contact' ? t.signInContact : t.signInList}</p>
              <div className="flex gap-3 pt-2">
                <Btn className="flex-1" onClick={() => setShowSignInModal(false)}>{t.cancel}</Btn>
                <Btn primary className="flex-1" onClick={() => { setShowSignInModal(false); goTab('profile'); }}>{t.signIn}</Btn>
              </div>
            </Card>
          </ScaleIn>
        </div>
      )}

      {/* Contact Modal */}
      {showContact && selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm animate-fadeIn">
          <SlideUp className="w-full max-w-md">
            <div className="bg-gradient-to-b from-[#151d30] to-[#0a1020] rounded-t-[2rem] p-6 space-y-5">
              <div className="w-12 h-1 bg-white/20 rounded-full mx-auto" />
              <h3 className="text-2xl font-bold text-center">{lang === 'he' ? 'יצירת קשר' : 'Contact Seller'}</h3>

              <Card className="p-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold shadow-lg" style={{ background: 'linear-gradient(135deg, #6FEEE1 0%, #4FD1C5 100%)', color: '#003733', boxShadow: '0 8px 24px rgba(111,238,225,0.25)' }}>
                    {selected.seller?.full_name?.charAt(0) || 'S'}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{selected.seller?.full_name || 'Seller'}</span>
                      {selected.seller?.is_verified && <Shield className="w-4 h-4" style={{ color: '#6FEEE1' }} />}
                    </div>
                    {selected.seller?.rating && (
                      <div className="flex items-center gap-1 text-sm text-slate-400 mt-0.5">
                        <Star className="w-3.5 h-3.5 text-yellow-400 fill-current" />
                        <span>{selected.seller.rating}</span>
                        {selected.seller?.total_sales > 0 && <span className="text-slate-500">• {selected.seller.total_sales} {lang === 'he' ? 'מכירות' : 'sales'}</span>}
                      </div>
                    )}
                  </div>
                </div>
              </Card>

              <div className="space-y-3">
                <button onClick={() => { setShowContact(false); startConversation(selected); }}
                  className="w-full py-4 rounded-2xl text-center font-semibold flex items-center justify-center gap-3 active:scale-[0.98] transition-transform" style={{ background: 'linear-gradient(135deg, #6FEEE1 0%, #4FD1C5 100%)', color: '#003733', boxShadow: '0 8px 24px rgba(111,238,225,0.3)' }}>
                  <MessageCircle className="w-5 h-5" />{lang === 'he' ? 'שלח הודעה באפליקציה' : 'Message in App'}
                </button>

                <div className="grid grid-cols-2 gap-3">
                  <a href={`https://wa.me/972${(selected.contact_phone || '').replace(/^0/, '').replace(/-/g, '')}?text=${encodeURIComponent(lang === 'he' ? `היי, ראיתי את המודעה שלך ב-GetWorth: ${selected.title}` : `Hi, I saw your listing on GetWorth: ${selected.title}`)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="py-4 rounded-2xl bg-gradient-to-r from-[#25D366] to-[#128C7E] text-center font-semibold flex items-center justify-center gap-2 shadow-lg shadow-green-500/30 active:scale-95 transition-transform">
                    💬 WhatsApp
                  </a>
                  {selected.contact_phone && (
                    <a href={`tel:${selected.contact_phone}`}
                      className="py-4 rounded-2xl bg-white/10 text-center font-semibold flex items-center justify-center gap-2 hover:bg-white/20 transition-all active:scale-95">
                      <Phone className="w-5 h-5" />{lang === 'he' ? 'התקשר' : 'Call'}
                    </a>
                  )}
                </div>
              </div>

              <button onClick={() => setShowContact(false)} className="w-full py-3 text-slate-400 text-sm">{lang === 'he' ? 'סגור' : 'Close'}</button>
            </div>
          </SlideUp>
        </div>
      )}

      <div className="relative flex-1 max-w-md mx-auto w-full flex flex-col pb-24">
        {/* Header */}
        {/* ═══ STITCH TOPBAR — faithful port of HTML header ═══ */}
        <header
          className="sticky top-0 w-full z-50"
          style={{
            background: 'rgba(19, 19, 19, 0.60)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            // Safe area: respect notch / Dynamic Island / status bar
            // env() returns 0 on browsers without support, so max() ensures a minimum
            paddingTop: 'max(env(safe-area-inset-top), 12px)',
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
          }}
        >
          <div className="flex items-center justify-between px-6 h-16 w-full max-w-7xl mx-auto">
            {/* Left: back arrow + Marketplace title */}
            <div className="flex items-center gap-4 cursor-pointer" onClick={() => { reset(); goTab('home'); }}>
              {rtl
                ? <ChevronRight className="w-6 h-6 cursor-pointer hover:opacity-80 transition-opacity" style={{ color: '#6FEEE1' }} />
                : <ArrowLeft className="w-6 h-6 cursor-pointer hover:opacity-80 transition-opacity" style={{ color: '#6FEEE1' }} />
              }
              <h1
                className="text-lg font-semibold tracking-tight"
                style={{ fontFamily: '"Manrope", system-ui, sans-serif', color: '#6FEEE1' }}
              >
                {lang === 'he' ? 'שוק' : 'Marketplace'}
              </h1>
            </div>

            {/* Right: language toggle (subtle), sound toggle (subtle), bell, avatar */}
            <div className="flex items-center gap-2">
              {/* Language toggle — minimal icon-only button */}
              <button
                onClick={() => setLang(lang === 'en' ? 'he' : 'en')}
                className="p-2 rounded-full transition-colors hover:bg-[#2A2A2A]"
                title={lang === 'en' ? 'עברית' : 'English'}
              >
                <Globe className="w-5 h-5" style={{ color: '#BBC9C7' }} />
              </button>
              {/* Sound toggle — minimal icon-only button */}
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="p-2 rounded-full transition-colors hover:bg-[#2A2A2A]"
                title={soundEnabled ? (lang === 'he' ? 'השתק' : 'Mute') : (lang === 'he' ? 'הפעל צליל' : 'Sound on')}
              >
                {soundEnabled
                  ? <Volume2 className="w-5 h-5" style={{ color: '#BBC9C7' }} />
                  : <VolumeX className="w-5 h-5" style={{ color: '#BBC9C7' }} />
                }
              </button>
              {/* Notifications bell */}
              <button
                onClick={() => goTab('profile')}
                className="p-2 rounded-full transition-colors hover:bg-[#2A2A2A] relative"
                title={lang === 'he' ? 'התראות' : 'Notifications'}
              >
                <Bell className="w-5 h-5" style={{ color: '#BBC9C7' }} />
                {notifUnreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                )}
              </button>
              {/* Avatar */}
              <button
                onClick={() => goTab('profile')}
                className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center"
                style={{
                  background: '#2A2A2A',
                  border: '1px solid rgba(60, 73, 71, 0.15)',
                }}
              >
                {profile?.avatar_url
                  ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                  : <User className="w-4 h-4" style={{ color: '#BBC9C7' }} />
                }
              </button>
            </div>
          </div>
        </header>

        {/* Content - View Router */}
        <main className="flex-1 px-5 pb-4 overflow-y-auto">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
          <div key={view} className="animate-viewFade">
            {view === 'home' && <HomeView />}
            {view === 'camera' && <CameraView />}
            {view === 'analyzing' && <AnalyzingView />}
            {view === 'results' && <ResultsView />}
            {view === 'browse' && !selected && <BrowseView />}
            {view === 'detail' && selected && <DetailView />}
            {view === 'sellerProfile' && <SellerProfileView />}
            {view === 'saved' && <SavedView />}
            {view === 'inbox' && <InboxView />}
            {view === 'chat' && <ChatView />}
            {view === 'auth' && <AuthView />}
            {view === 'profile' && user && <ProfileView />}
            {view === 'myListings' && <MyListingsView />}
            {view === 'listing' && <ListingFlowView />}
            {view === 'analytics' && <AnalyticsView />}
            {view === 'admin' && <AdminPanel />}
            {view === 'orders' && <OrdersView />}
            {view === 'orderDetail' && <OrderDetailView />}
            {view === 'notifications' && <NotificationsView />}
          </div>
        </main>

        {/* Checkout Sheet (modal overlay) */}
        <CheckoutSheet />

        {/* Bottom Nav */}
        {/* ═══ STITCH BOTTOM NAV — sliding pill edition ═══ */}
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 overflow-hidden"
          style={{
            background: 'rgba(28, 27, 27, 0.95)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderTopLeftRadius: '32px',
            borderTopRightRadius: '32px',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
            boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div
            className="relative flex w-full items-center"
            style={{
              paddingTop: '12px',
              paddingBottom: 'max(env(safe-area-inset-bottom), 12px)',
              paddingLeft: 'max(env(safe-area-inset-left), 16px)',
              paddingRight: 'max(env(safe-area-inset-right), 16px)',
            }}
          >
            {tabItems.map((n) => {
              const active = tab === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => goTab(n.id)}
                  className="flex-1 flex flex-col items-center justify-center py-1.5 relative z-10 active:scale-95 transition-all duration-200"
                  style={{ color: active ? '#6FEEE1' : '#BBC9C7' }}
                >
                  <div className="relative mb-0.5">
                    <n.icon
                      className="w-6 h-6"
                      strokeWidth={active ? 2.5 : 2}
                      fill={active ? 'currentColor' : 'none'}
                    />
                    {n.id === 'sell' && (() => {
                      const pendingCount = (orders || []).filter(o => o.seller_id === user?.id && o.status === 'pending').length;
                      if (pendingCount > 0) return (
                        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-[9px] flex items-center justify-center font-bold text-black animate-pulse">{pendingCount}</span>
                      );
                      if (myListings.length > 0) return (
                        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-bold text-black" style={{ background: '#6FEEE1' }}>{myListings.length}</span>
                      );
                      return null;
                    })()}
                    {n.id === 'messages' && unreadCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gradient-to-r from-red-500 to-pink-500 text-[9px] flex items-center justify-center font-bold animate-pulse">{unreadCount}</span>
                    )}
                    {n.id === 'profile' && notifUnreadCount > 0 && !active && (
                      <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-[9px] flex items-center justify-center font-bold animate-pulse">{notifUnreadCount}</span>
                    )}
                  </div>
                  <span
                    className="text-[10px] tracking-wide"
                    style={{
                      fontFamily: '"Inter", system-ui, sans-serif',
                      fontWeight: active ? 700 : 500,
                    }}
                  >
                    {n.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Global Styles */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(100%); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideDown { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
        @keyframes toastIn { 0% { opacity: 0; transform: translate(-50%, -20px) scale(0.9); } 100% { opacity: 1; transform: translate(-50%, 0) scale(1); } }
        @keyframes heartPop { 0%, 100% { transform: scale(1); } 25% { transform: scale(1.3); } 50% { transform: scale(0.95); } 75% { transform: scale(1.15); } }
        @keyframes shimmer { 100% { transform: translateX(100%); } }
        @keyframes shimmer-fast { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes scan { 0% { top: 0%; opacity: 1; } 50% { opacity: 0.5; } 100% { top: 100%; opacity: 1; } }
        @keyframes progress { 0% { width: 0%; } 50% { width: 70%; } 100% { width: 100%; } }
        @keyframes float { 0%, 100% { transform: translateY(0) scale(1); opacity: 0.6; } 50% { transform: translateY(-15px) scale(1.2); opacity: 1; } }
        @keyframes flash { 0% { opacity: 0.9; } 100% { opacity: 0; } }
        @keyframes notifProgress { from { width: 100%; } to { width: 0%; } }
        .animate-fadeIn { animation: fadeIn 0.5s ease-out forwards; opacity: 0; }
        .animate-slideUp { animation: slideUp 0.4s ease-out forwards; }
        .animate-slideDown { animation: slideDown 0.3s ease-out forwards; }
        .animate-scaleIn { animation: scaleIn 0.3s ease-out forwards; }
        .animate-toastIn { animation: toastIn 0.3s ease-out forwards; }
        .animate-heartPop { animation: heartPop 0.6s ease-in-out; }
        .animate-shimmer { animation: shimmer 2s infinite; }
        .animate-shimmer-fast { animation: shimmer-fast 1.5s infinite; }
        .animate-spin-slow { animation: spin-slow 4s linear infinite; }
        .animate-scan { animation: scan 2s ease-in-out infinite; }
        .animate-progress { animation: progress 3s ease-in-out infinite; }
        .animate-float { animation: float 2s ease-in-out infinite; }
        .animate-flash { animation: flash 0.15s ease-out forwards; }
        .animate-notifProgress { animation: notifProgress 6s linear forwards; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes viewFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .animate-viewFade { animation: viewFade 0.22s ease-out forwards; }
        .btn-spring { transition: transform 0.35s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s ease; -webkit-tap-highlight-color: transparent; will-change: transform; }
        .btn-spring:active { transform: scale(0.95); transition-duration: 0.08s; transition-timing-function: ease; }
        .btn-spring-primary:active { box-shadow: 0 0 20px rgba(111,238,225,0.35), 0 0 40px rgba(111,238,225,0.15) !important; }
      `}</style>
    </div>
  );
}

export default function GetWorth() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </ErrorBoundary>
  );
}