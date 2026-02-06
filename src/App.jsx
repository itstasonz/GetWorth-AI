import React from 'react';
import { DollarSign, Globe, Home, Search, ShoppingBag, MessageCircle, User, X, AlertCircle, Shield, Star, Phone, Volume2, VolumeX, ChevronRight, ChevronLeft } from 'lucide-react';
import { AppProvider, useApp } from './contexts/AppContext';
import ErrorBoundary from './components/ErrorBoundary';
import { Card, Btn, Toast, FadeIn, SlideUp, ScaleIn } from './components/ui';
import { formatPrice, getSellerBadgeStyle } from './lib/utils';

// Views
import HomeView from './views/HomeView';
import { CameraView, AnalyzingView, ResultsView } from './views/CameraResultsView';
import { BrowseView, DetailView, SellerProfileView } from './views/BrowseDetailView';
import { InboxView, ChatView } from './views/ChatViews';
import { AuthView, ProfileView } from './views/AuthProfileView';
import { MyListingsView, SavedView, ListingFlowView } from './views/SellViews';

function AppShell() {
  const {
    lang, setLang, t, rtl,
    user, loading,
    tab, view, goTab, reset, handleFile,
    error, setError, toast, setToast,
    soundEnabled, setSoundEnabled,
    // Modals
    showSignInModal, setShowSignInModal, signInAction,
    showContact, setShowContact, selected, startConversation,
    // Misc
    myListings, unreadCount, fileRef,
  } = useApp();

  // Loading screen
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#060a14]">
        <div className="text-center space-y-4">
          <div className="relative">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center animate-pulse shadow-2xl shadow-blue-500/30">
              <DollarSign className="w-10 h-10 text-white" />
            </div>
            <div className="absolute -inset-4 bg-blue-500/20 rounded-full blur-2xl animate-pulse" />
          </div>
          <div className="flex gap-1 justify-center">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white flex flex-col" style={{ fontFamily: rtl ? 'Heebo, sans-serif' : 'Inter, sans-serif', background: 'linear-gradient(180deg, #060a14 0%, #0a1020 50%, #060a14 100%)' }} dir={rtl ? 'rtl' : 'ltr'}>
      
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-blue-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 right-0 w-[300px] h-[300px] bg-cyan-500/10 rounded-full blur-[80px]" />
      </div>

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
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500/20 to-blue-600/20 flex items-center justify-center mx-auto">
                <User className="w-10 h-10 text-blue-400" />
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
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-xl font-bold shadow-lg shadow-blue-500/30">
                    {selected.seller?.full_name?.charAt(0) || 'S'}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{selected.seller?.full_name || 'Seller'}</span>
                      {selected.seller?.is_verified && <Shield className="w-4 h-4 text-blue-400" />}
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
                  className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 text-center font-semibold flex items-center justify-center gap-3 shadow-lg shadow-blue-500/30 active:scale-[0.98] transition-transform">
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
        <header className="px-5 pt-12 pb-6 flex items-center justify-between">
          <div className="flex items-center gap-4 cursor-pointer group" onClick={() => { reset(); goTab('home'); }}>
            <div className="relative">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30 group-hover:shadow-blue-500/50 transition-all group-hover:scale-105">
                <DollarSign className="w-6 h-6 text-white" />
              </div>
              <div className="absolute -inset-1 bg-blue-500/20 rounded-2xl blur-md opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">{t.appName}</h1>
              <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em] font-medium">{t.tagline}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2.5 rounded-2xl border border-white/10 transition-all hover:scale-105 active:scale-95 ${soundEnabled ? 'bg-blue-500/20 hover:bg-blue-500/30' : 'bg-white/5 hover:bg-white/10'}`}
              title={soundEnabled ? (lang === 'he' ? 'השתק צלילים' : 'Mute sounds') : (lang === 'he' ? 'הפעל צלילים' : 'Enable sounds')}>
              {soundEnabled ? <Volume2 className="w-4 h-4 text-blue-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
            </button>
            <button onClick={() => setLang(lang === 'en' ? 'he' : 'en')}
              className="px-4 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium flex items-center gap-2 transition-all hover:scale-105 active:scale-95">
              <Globe className="w-4 h-4 text-blue-400" />{lang === 'en' ? 'עב' : 'EN'}
            </button>
          </div>
        </header>

        {/* Content - View Router */}
        <main className="flex-1 px-5 pb-4 overflow-y-auto">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />

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
        </main>

        {/* Bottom Nav */}
        <nav className="fixed bottom-0 left-0 right-0 z-40">
          <div className="absolute inset-0 bg-[#060a14]/90 backdrop-blur-xl border-t border-white/10" />
          <div className="relative max-w-md mx-auto flex">
            {[
              { id: 'home', icon: Home },
              { id: 'browse', icon: Search },
              { id: 'sell', icon: ShoppingBag },
              { id: 'messages', icon: MessageCircle },
              { id: 'profile', icon: User }
            ].map((n) => (
              <button key={n.id} onClick={() => goTab(n.id)}
                className={`flex-1 py-4 flex flex-col items-center gap-1.5 relative transition-all ${tab === n.id ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}>
                {tab === n.id && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-gradient-to-r from-blue-500 to-blue-400 rounded-full" />}
                <div className={`relative transition-transform ${tab === n.id ? 'scale-110' : ''}`}>
                  <n.icon className={`w-6 h-6 ${n.id === 'messages' && unreadCount > 0 && tab !== 'messages' ? 'text-blue-400' : ''}`} />
                  {n.id === 'sell' && myListings.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 text-[9px] flex items-center justify-center font-bold">{myListings.length}</span>
                  )}
                  {n.id === 'messages' && unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gradient-to-r from-red-500 to-pink-500 text-[9px] flex items-center justify-center font-bold">{unreadCount}</span>
                  )}
                </div>
                <span className="text-[10px] font-medium">{n.id === 'messages' ? (lang === 'he' ? 'הודעות' : 'Chat') : t[n.id]}</span>
              </button>
            ))}
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
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
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
