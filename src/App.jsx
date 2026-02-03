import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Camera, Upload, X, Sparkles, DollarSign, Package, Smartphone, Watch, ChevronRight, ChevronLeft, Loader2, ImagePlus, Share2, AlertCircle, Shirt, Dumbbell, Scan, User, LogOut, Plus, Trash2, Clock, Globe, Home, ShoppingBag, CheckCircle, Circle, Box, Shield, AlertTriangle, Eye, MessageCircle, Phone, Check, MapPin, Search, SlidersHorizontal, Heart, Grid, RefreshCw } from 'lucide-react';
import { supabase } from './lib/supabase';

// Translations
const T = {
  en: { appName: "GetWorth", tagline: "AI Valuation", aiPowered: "AI-Powered", heroTitle1: "Know Your", heroTitle2: "Item's Value", heroSub: "Snap or upload any item for instant AI valuation.", drop: "Drop image here", orButtons: "or use buttons below", scan: "Scan", upload: "Upload", analyzing: "Analyzing...", marketValue: "Market Value", range: "Range", listItem: "List This Item", scanAnother: "Scan Another", welcome: "Welcome back", createAcc: "Create account", signInAccess: "Sign in to access", join: "Join GetWorth", google: "Continue with Google", or: "or", name: "Full Name", email: "Email", password: "Password", signIn: "Sign In", signUp: "Sign Up", noAcc: "No account?", haveAcc: "Have account?", back: "Back", myListings: "My Listings", noListings: "No listings yet", home: "Home", browse: "Browse", sell: "Sell", saved: "Saved", profile: "Profile", condition: "Select Condition", newSealed: "New", likeNew: "Like New", used: "Used", poor: "Poor", yourPrice: "Your Price", more: "Tell Us More", scratches: "Scratches?", battery: "Battery?", issues: "Issues?", yes: "Yes", no: "No", good: "Good", degraded: "Degraded", continue: "Continue", review: "Review Listing", title: "Title", desc: "Description", phone: "Phone", location: "Location", publish: "Publish", publishing: "Publishing...", published: "Listed!", live: "Your item is live", view: "View", share: "Share", seller: "Seller", contact: "Contact", call: "Call", whatsapp: "WhatsApp", today: "today", yesterday: "yesterday", daysAgo: "d ago", noSaved: "No saved items", signInReq: "Sign In Required", signInSave: "Sign in to save", signInContact: "Sign in to contact", signInList: "Sign in to list", cancel: "Cancel", all: "All", phones: "Phones", watches: "Watches", clothing: "Clothing", furniture: "Furniture", sports: "Sports", filters: "Filters", clear: "Clear", min: "Min", max: "Max", results: "results", newest: "Newest", lowHigh: "Low-High", highLow: "High-Low", noResults: "No items found", failed: "Analysis failed", cameraDenied: "Camera access denied" },
  he: { appName: "GetWorth", tagline: "הערכת שווי", aiPowered: "AI", heroTitle1: "גלה את", heroTitle2: "שווי הפריט", heroSub: "צלם או העלה תמונה לקבלת הערכה.", drop: "גרור תמונה", orButtons: "או לחץ למטה", scan: "סרוק", upload: "העלה", analyzing: "מנתח...", marketValue: "שווי שוק", range: "טווח", listItem: "פרסם", scanAnother: "סרוק עוד", welcome: "שלום", createAcc: "צור חשבון", signInAccess: "התחבר", join: "הצטרף", google: "המשך עם Google", or: "או", name: "שם", email: "אימייל", password: "סיסמה", signIn: "התחבר", signUp: "הירשם", noAcc: "אין חשבון?", haveAcc: "יש חשבון?", back: "חזור", myListings: "המודעות שלי", noListings: "אין מודעות", home: "בית", browse: "חיפוש", sell: "מכירה", saved: "שמורים", profile: "פרופיל", condition: "בחר מצב", newSealed: "חדש", likeNew: "כמו חדש", used: "משומש", poor: "גרוע", yourPrice: "מחיר", more: "פרטים נוספים", scratches: "שריטות?", battery: "סוללה?", issues: "בעיות?", yes: "כן", no: "לא", good: "טוב", degraded: "בינוני", continue: "המשך", review: "סקירה", title: "כותרת", desc: "תיאור", phone: "טלפון", location: "מיקום", publish: "פרסם", publishing: "מפרסם...", published: "פורסם!", live: "המודעה באוויר", view: "צפה", share: "שתף", seller: "מוכר", contact: "צור קשר", call: "התקשר", whatsapp: "וואטסאפ", today: "היום", yesterday: "אתמול", daysAgo: "ימים", noSaved: "אין שמורים", signInReq: "נדרשת התחברות", signInSave: "התחבר לשמירה", signInContact: "התחבר ליצירת קשר", signInList: "התחבר לפרסום", cancel: "ביטול", all: "הכל", phones: "טלפונים", watches: "שעונים", clothing: "ביגוד", furniture: "ריהוט", sports: "ספורט", filters: "סינון", clear: "נקה", min: "מינ׳", max: "מקס׳", results: "תוצאות", newest: "חדש", lowHigh: "מחיר ↑", highLow: "מחיר ↓", noResults: "לא נמצאו פריטים", failed: "הניתוח נכשל", cameraDenied: "הגישה למצלמה נדחתה" }
};

export default function GetWorth() {
  // Core state
  const [lang, setLang] = useState('he');
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Navigation
  const [tab, setTab] = useState('home');
  const [view, setView] = useState('home');
  
  // Data
  const [listings, setListings] = useState([]);
  const [myListings, setMyListings] = useState([]);
  const [savedIds, setSavedIds] = useState(new Set());
  const [savedItems, setSavedItems] = useState([]);
  
  // UI state
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);
  
  // Scan/Upload
  const [images, setImages] = useState([]);
  const [result, setResult] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  // Listing flow
  const [listingStep, setListingStep] = useState(0);
  const [condition, setCondition] = useState(null);
  const [answers, setAnswers] = useState({});
  const [listingData, setListingData] = useState({ title: '', desc: '', price: 0, phone: '', location: '' });
  const [publishing, setPublishing] = useState(false);
  
  // Browse
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [priceRange, setPriceRange] = useState({ min: '', max: '' });
  const [sort, setSort] = useState('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState(null);
  
  // Auth
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState(null);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [signInAction, setSignInAction] = useState(null);
  const [showContact, setShowContact] = useState(false);

  const t = T[lang];
  const rtl = lang === 'he';

  // === AUTH ===
  useEffect(() => {
    let mounted = true;
    
    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (mounted && session?.user) {
          setUser(session.user);
          const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
          if (mounted && data) setProfile(data);
        }
      } catch (e) {
        console.error('Auth init error:', e);
      }
      if (mounted) setLoading(false);
    };
    
    init();
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      
      if (session?.user) {
        setUser(session.user);
        const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        if (data) setProfile(data);
        if (event === 'SIGNED_IN' && view === 'auth') {
          setView('profile');
          setTab('profile');
        }
      } else {
        setUser(null);
        setProfile(null);
      }
    });
    
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  // === LOAD DATA ===
  useEffect(() => {
    loadListings();
  }, [category, priceRange.min, priceRange.max, search]);

  useEffect(() => {
    if (user) loadUserData();
    else { setMyListings([]); setSavedItems([]); setSavedIds(new Set()); }
  }, [user]);

  const loadListings = async () => {
    let query = supabase.from('listings').select('*, seller:profiles(id, full_name, avatar_url, badge, is_verified)').eq('status', 'active').order('created_at', { ascending: false });
    if (category !== 'all') query = query.eq('category', category);
    if (priceRange.min) query = query.gte('price', parseInt(priceRange.min));
    if (priceRange.max) query = query.lte('price', parseInt(priceRange.max));
    if (search) query = query.or(`title.ilike.%${search}%,title_hebrew.ilike.%${search}%`);
    const { data } = await query;
    if (data) setListings(data);
  };

  const loadUserData = async () => {
    if (!user) return;
    const [{ data: myData }, { data: savedData }] = await Promise.all([
      supabase.from('listings').select('*').eq('seller_id', user.id).neq('status', 'deleted').order('created_at', { ascending: false }),
      supabase.from('saved_items').select('*, listing:listings(*, seller:profiles(id, full_name, badge))').eq('user_id', user.id)
    ]);
    if (myData) setMyListings(myData);
    if (savedData) {
      setSavedItems(savedData.map(s => s.listing).filter(Boolean));
      setSavedIds(new Set(savedData.map(s => s.listing_id)));
    }
  };

  // === HELPERS ===
  const showToastMsg = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2000); };
  const formatPrice = (p) => p ? `₪${p.toLocaleString()}` : '';
  const timeAgo = (d) => { const days = Math.floor((Date.now() - new Date(d)) / 86400000); return days === 0 ? t.today : days === 1 ? t.yesterday : `${days} ${t.daysAgo}`; };
  
  const calcPrice = (base, cond, ans) => {
    if (!base) return 0;
    const disc = { newSealed: 0, likeNew: 0.15, used: 0.3, poor: 0.7 }[cond] || 0;
    let extra = 0;
    if (cond === 'used') {
      if (ans.scratches === 'yes') extra += 0.02;
      if (ans.battery === 'poor') extra += 0.02;
      if (ans.issues === 'yes') extra += 0.03;
    }
    return Math.round(base * (1 - disc - extra));
  };

  // === AUTH HANDLERS ===
  const signInGoogle = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  };

  const signInEmail = async (e) => {
    e.preventDefault();
    setAuthError(null);
    const { error } = authMode === 'login' 
      ? await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password })
      : await supabase.auth.signUp({ email: authForm.email, password: authForm.password, options: { data: { full_name: authForm.name } } });
    if (error) setAuthError(error.message);
    else if (authMode === 'signup') setAuthError('Check your email!');
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setTab('home');
    setView('home');
    showToastMsg('Signed out');
  };

  // === ITEM ACTIONS ===
  const toggleSave = async (item) => {
    if (!user) { setSignInAction('save'); setShowSignInModal(true); return; }
    if (savedIds.has(item.id)) {
      await supabase.from('saved_items').delete().eq('user_id', user.id).eq('listing_id', item.id);
      setSavedIds(prev => { const n = new Set(prev); n.delete(item.id); return n; });
      setSavedItems(prev => prev.filter(i => i.id !== item.id));
      showToastMsg('Removed');
    } else {
      await supabase.from('saved_items').insert({ user_id: user.id, listing_id: item.id });
      setSavedIds(prev => new Set(prev).add(item.id));
      setSavedItems(prev => [...prev, item]);
      showToastMsg('Saved!');
    }
  };

  const deleteListing = async (id) => {
    await supabase.from('listings').update({ status: 'deleted' }).eq('id', id);
    loadUserData();
    showToastMsg('Deleted');
  };

  // === SCAN/UPLOAD ===
  const analyzeImage = async (imgData) => {
    const res = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageData: imgData.split(',')[1], lang }) });
    const data = await res.json();
    if (data.content?.[0]?.text) return JSON.parse(data.content[0].text.replace(/```json\n?|\n?```/g, '').trim());
    throw new Error('Failed');
  };

  const handleFile = (file) => {
    if (!file?.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      setImages([e.target.result]);
      setView('analyzing');
      try {
        const r = await analyzeImage(e.target.result);
        setResult(r);
        setView('results');
      } catch {
        setError(t.failed);
        setView('home');
      }
    };
    reader.readAsDataURL(file);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setView('camera');
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); } }, 100);
    } catch { setError(t.cameraDenied); }
  };

  const capture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;
    ctx.drawImage(videoRef.current, 0, 0);
    const img = canvasRef.current.toDataURL('image/jpeg');
    videoRef.current.srcObject?.getTracks().forEach(t => t.stop());
    setImages([img]);
    setView('analyzing');
    analyzeImage(img).then(r => { setResult(r); setView('results'); }).catch(() => { setError(t.failed); setView('home'); });
  };

  const stopCamera = () => { videoRef.current?.srcObject?.getTracks().forEach(t => t.stop()); setView('home'); };

  // === LISTING FLOW ===
  const startListing = () => {
    if (!user) { setSignInAction('list'); setShowSignInModal(true); return; }
    setListingData({ title: result?.name || '', desc: '', price: result?.marketValue?.mid || 0, phone: '', location: '' });
    setCondition(null);
    setAnswers({});
    setListingStep(0);
    setView('listing');
  };

  const selectCondition = (c) => {
    setCondition(c);
    setListingData(prev => ({ ...prev, price: calcPrice(result?.marketValue?.mid, c, answers) }));
    setListingStep(c === 'used' ? 1 : 2);
  };

  const publishListing = async () => {
    setPublishing(true);
    try {
      await supabase.from('listings').insert({
        seller_id: user.id, title: listingData.title, title_hebrew: result?.nameHebrew || '', description: listingData.desc,
        category: result?.category || 'Other', condition, price: listingData.price, images: images,
        location: listingData.location, contact_phone: listingData.phone
      });
      loadUserData();
      loadListings();
      setListingStep(3);
      showToastMsg(t.published);
    } catch (e) { setError(e.message); }
    setPublishing(false);
  };

  // === NAVIGATION ===
  const reset = () => { setImages([]); setResult(null); setView('home'); setError(null); setCondition(null); setListingStep(0); setSelected(null); };
  
  const goTab = (newTab) => {
    setTab(newTab);
    setSelected(null);
    if (newTab === 'home') setView('home');
    else if (newTab === 'browse') setView('browse');
    else if (newTab === 'sell') setView('myListings');
    else if (newTab === 'saved') setView('saved');
    else if (newTab === 'profile') setView(user ? 'profile' : 'auth');
  };

  const viewItem = (item) => { setSelected(item); setView('detail'); };

  const contactSeller = () => {
    if (!user) { setSignInAction('contact'); setShowSignInModal(true); return; }
    setShowContact(true);
  };

  // === COMPONENTS ===
  const Card = ({ children, className = '', onClick }) => (
    <div onClick={onClick} className={`rounded-2xl bg-white/[0.03] border border-white/[0.06] ${onClick ? 'cursor-pointer active:scale-[0.98]' : ''} ${className}`}>{children}</div>
  );

  const Btn = ({ children, primary, disabled, className = '', ...p }) => (
    <button disabled={disabled} className={`px-5 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 ${primary ? 'bg-blue-600 text-white' : 'bg-white/5 border border-white/10 text-white'} ${className}`} {...p}>{children}</button>
  );

  const Inp = ({ label, ...p }) => (
    <div className="space-y-1">{label && <label className="text-sm text-slate-400">{label}</label>}<input className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:border-blue-500/50" dir={rtl ? 'rtl' : 'ltr'} {...p} /></div>
  );

  const Back = ({ onClick }) => (
    <button onClick={onClick} className="flex items-center gap-2 text-slate-400 hover:text-white mb-4">{rtl ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}<span className="text-sm">{t.back}</span></button>
  );

  const ListingCard = ({ item }) => (
    <Card className="overflow-hidden" onClick={() => viewItem(item)}>
      <div className="relative aspect-square">
        <img src={item.images?.[0]} alt="" className="w-full h-full object-cover" />
        <button onClick={(e) => { e.stopPropagation(); toggleSave(item); }} className={`absolute top-2 ${rtl ? 'left-2' : 'right-2'} w-8 h-8 rounded-full flex items-center justify-center ${savedIds.has(item.id) ? 'bg-red-500' : 'bg-black/50'}`}>
          <Heart className={`w-4 h-4 ${savedIds.has(item.id) ? 'fill-current' : ''}`} />
        </button>
      </div>
      <div className="p-3">
        <h3 className="font-medium text-sm truncate">{lang === 'he' && item.title_hebrew ? item.title_hebrew : item.title}</h3>
        <p className="text-lg font-bold text-green-400">{formatPrice(item.price)}</p>
        <div className="flex justify-between mt-1 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{item.location || 'Israel'}</span>
          <span>{timeAgo(item.created_at)}</span>
        </div>
      </div>
    </Card>
  );

  const categories = [{ id: 'all', label: t.all, icon: Grid }, { id: 'Electronics', label: t.phones, icon: Smartphone }, { id: 'Furniture', label: t.furniture, icon: Box }, { id: 'Watches', label: t.watches, icon: Watch }, { id: 'Clothing', label: t.clothing, icon: Shirt }, { id: 'Sports', label: t.sports, icon: Dumbbell }];

  const sortedListings = useMemo(() => {
    let arr = [...listings];
    if (sort === 'lowHigh') arr.sort((a, b) => a.price - b.price);
    else if (sort === 'highLow') arr.sort((a, b) => b.price - a.price);
    return arr;
  }, [listings, sort]);

  // === LOADING SCREEN ===
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0f1a]">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  // === MAIN RENDER ===
  return (
    <div className="min-h-screen text-white flex flex-col bg-[#0a0f1a]" style={{ fontFamily: rtl ? 'Heebo, sans-serif' : 'Inter, sans-serif' }} dir={rtl ? 'rtl' : 'ltr'}>
      
      {/* Toast */}
      {toast && <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-green-500 text-sm font-medium shadow-lg">{toast}</div>}
      
      {/* Error */}
      {error && <div className="fixed top-20 left-4 right-4 z-50 p-3 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center gap-2"><AlertCircle className="w-4 h-4 text-red-400" /><span className="flex-1 text-sm text-red-300">{error}</span><button onClick={() => setError(null)}><X className="w-4 h-4" /></button></div>}

      {/* Sign In Modal */}
      {showSignInModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-5">
          <Card className="p-6 max-w-sm w-full text-center space-y-4">
            <User className="w-12 h-12 text-blue-400 mx-auto" />
            <h3 className="text-lg font-bold">{t.signInReq}</h3>
            <p className="text-slate-400 text-sm">{signInAction === 'save' ? t.signInSave : signInAction === 'contact' ? t.signInContact : t.signInList}</p>
            <div className="flex gap-3">
              <Btn className="flex-1" onClick={() => setShowSignInModal(false)}>{t.cancel}</Btn>
              <Btn primary className="flex-1" onClick={() => { setShowSignInModal(false); goTab('profile'); }}>{t.signIn}</Btn>
            </div>
          </Card>
        </div>
      )}

      {/* Contact Modal */}
      {showContact && selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70">
          <div className="w-full max-w-md bg-[#0f1629] rounded-t-3xl p-5 space-y-4">
            <div className="w-12 h-1 bg-white/20 rounded-full mx-auto" />
            <h3 className="text-lg font-bold text-center">{t.contact}</h3>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5">
              <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center text-lg font-bold">{selected.seller?.full_name?.charAt(0) || 'S'}</div>
              <span className="font-medium">{selected.seller?.full_name || 'Seller'}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <a href={`tel:${selected.contact_phone}`} className="py-3 rounded-xl bg-green-600 text-center font-medium flex items-center justify-center gap-2"><Phone className="w-5 h-5" />{t.call}</a>
              <a href={`https://wa.me/972${(selected.contact_phone || '').replace(/^0/, '').replace(/-/g, '')}`} target="_blank" className="py-3 rounded-xl bg-[#25D366] text-center font-medium flex items-center justify-center gap-2"><MessageCircle className="w-5 h-5" />{t.whatsapp}</a>
            </div>
            <Btn className="w-full" onClick={() => setShowContact(false)}>{t.cancel}</Btn>
          </div>
        </div>
      )}

      <div className="flex-1 max-w-md mx-auto w-full flex flex-col pb-20">
        {/* Header */}
        <header className="px-5 pt-10 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => { reset(); goTab('home'); }}>
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center"><DollarSign className="w-5 h-5" /></div>
            <div><h1 className="text-lg font-bold">{t.appName}</h1><p className="text-[9px] text-slate-500 uppercase">{t.tagline}</p></div>
          </div>
          <button onClick={() => setLang(lang === 'en' ? 'he' : 'en')} className="px-3 py-1.5 rounded-lg bg-white/5 text-xs flex items-center gap-1"><Globe className="w-3.5 h-3.5 text-blue-400" />{lang === 'en' ? 'עב' : 'EN'}</button>
        </header>

        {/* Content */}
        <main className="flex-1 px-5 pb-4 overflow-y-auto">
          
          {/* HOME */}
          {view === 'home' && (
            <div className="space-y-6 pt-4">
              <div className="text-center space-y-3">
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300"><Sparkles className="w-3.5 h-3.5" />{t.aiPowered}</span>
                <h2 className="text-3xl font-bold">{t.heroTitle1}<br/><span className="text-blue-400">{t.heroTitle2}</span></h2>
                <p className="text-slate-400 text-sm">{t.heroSub}</p>
              </div>
              <div className={`rounded-xl border-2 border-dashed ${dragActive ? 'border-blue-500 bg-blue-500/10' : 'border-white/10'} p-8 text-center`} onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }} onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setDragActive(false); handleFile(e.dataTransfer.files[0]); }}>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
                <ImagePlus className="w-12 h-12 text-slate-500 mx-auto mb-3" />
                <p className="text-slate-300 text-sm">{t.drop}</p>
                <p className="text-slate-500 text-xs mt-1">{t.orButtons}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={startCamera} className="py-3.5 rounded-xl bg-blue-600 font-semibold flex items-center justify-center gap-2"><Scan className="w-5 h-5" />{t.scan}</button>
                <button onClick={() => fileRef.current?.click()} className="py-3.5 rounded-xl bg-white/5 border border-white/10 font-semibold flex items-center justify-center gap-2"><Upload className="w-5 h-5" />{t.upload}</button>
              </div>
            </div>
          )}

          {/* CAMERA */}
          {view === 'camera' && (
            <div className="fixed inset-0 z-50 bg-black">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute bottom-0 inset-x-0 p-8 flex justify-center gap-6 bg-gradient-to-t from-black">
                <button onClick={stopCamera} className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center"><X className="w-6 h-6" /></button>
                <button onClick={capture} className="w-[72px] h-[72px] rounded-full bg-blue-600 flex items-center justify-center"><div className="w-14 h-14 rounded-full border-4 border-white/30" /></button>
                <div className="w-14" />
              </div>
            </div>
          )}

          {/* ANALYZING */}
          {view === 'analyzing' && (
            <div className="flex-1 flex flex-col items-center justify-center py-16">
              <div className="relative">
                <div className="absolute -inset-4 bg-blue-500/20 rounded-2xl blur-xl animate-pulse" />
                <div className="relative w-40 h-40 rounded-2xl overflow-hidden border-2 border-blue-500/30">
                  {images[0] && <img src={images[0]} className="w-full h-full object-cover" />}
                </div>
              </div>
              <div className="mt-6 flex items-center gap-2"><Loader2 className="w-5 h-5 text-blue-400 animate-spin" /><span>{t.analyzing}</span></div>
            </div>
          )}

          {/* RESULTS */}
          {view === 'results' && result && (
            <div className="space-y-4 pb-4">
              <div className="relative aspect-[4/3] rounded-xl overflow-hidden">
                <img src={images[0]} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent" />
                <div className="absolute bottom-3 left-3 right-3">
                  <span className="text-xs bg-white/10 px-2 py-1 rounded">{result.category}</span>
                  <h2 className="text-lg font-bold mt-1">{lang === 'he' && result.nameHebrew ? result.nameHebrew : result.name}</h2>
                </div>
              </div>
              <Card className="p-4 text-center bg-blue-500/10 border-blue-500/20">
                <p className="text-sm text-slate-400">{t.marketValue}</p>
                <p className="text-3xl font-bold text-blue-400">{formatPrice(result.marketValue?.mid)}</p>
                {result.marketValue?.low > 0 && <p className="text-xs text-slate-500 mt-1">{t.range}: {formatPrice(result.marketValue.low)} - {formatPrice(result.marketValue.high)}</p>}
              </Card>
              <div className="flex gap-3">
                <Btn primary className="flex-1" onClick={startListing}><Plus className="w-4 h-4" />{t.listItem}</Btn>
                <Btn><Share2 className="w-4 h-4" /></Btn>
              </div>
              <button onClick={reset} className="w-full py-2 text-slate-400 text-sm flex items-center justify-center gap-2"><RefreshCw className="w-4 h-4" />{t.scanAnother}</button>
            </div>
          )}

          {/* BROWSE */}
          {view === 'browse' && !selected && (
            <div className="space-y-4">
              <div className="relative">
                <Search className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'right-4' : 'left-4'} w-5 h-5 text-slate-500`} />
                <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className={`w-full py-3 ${rtl ? 'pr-12 pl-12' : 'pl-12 pr-12'} rounded-xl bg-white/5 border border-white/10`} />
                <button onClick={() => setShowFilters(!showFilters)} className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'left-3' : 'right-3'} p-1.5 rounded-lg ${showFilters ? 'bg-blue-600' : 'bg-white/10'}`}><SlidersHorizontal className="w-4 h-4" /></button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5">
                {categories.map(c => <button key={c.id} onClick={() => setCategory(c.id)} className={`flex-shrink-0 px-3 py-2 rounded-lg flex items-center gap-2 text-xs font-medium ${category === c.id ? 'bg-blue-600' : 'bg-white/5'}`}><c.icon className="w-4 h-4" />{c.label}</button>)}
              </div>
              {showFilters && (
                <Card className="p-4 space-y-3">
                  <div className="flex justify-between"><span className="font-medium">{t.filters}</span><button onClick={() => { setPriceRange({ min: '', max: '' }); setSort('newest'); }} className="text-xs text-blue-400">{t.clear}</button></div>
                  <div className="flex gap-2">
                    <input type="number" placeholder={t.min} value={priceRange.min} onChange={(e) => setPriceRange({ ...priceRange, min: e.target.value })} className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" />
                    <input type="number" placeholder={t.max} value={priceRange.max} onChange={(e) => setPriceRange({ ...priceRange, max: e.target.value })} className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {['newest', 'lowHigh', 'highLow'].map(s => <button key={s} onClick={() => setSort(s)} className={`py-2 rounded-lg text-xs font-medium ${sort === s ? 'bg-blue-600' : 'bg-white/5'}`}>{t[s]}</button>)}
                  </div>
                </Card>
              )}
              <p className="text-sm text-slate-400">{sortedListings.length} {t.results}</p>
              {sortedListings.length === 0 ? (
                <div className="text-center py-12"><Search className="w-10 h-10 text-slate-600 mx-auto mb-2" /><p className="text-slate-400">{t.noResults}</p></div>
              ) : (
                <div className="grid grid-cols-2 gap-3">{sortedListings.map(item => <ListingCard key={item.id} item={item} />)}</div>
              )}
            </div>
          )}

          {/* DETAIL */}
          {view === 'detail' && selected && (
            <div className="space-y-4 -mx-5 -mt-4">
              <div className="relative aspect-square">
                <img src={selected.images?.[0]} className="w-full h-full object-cover" />
                <button onClick={() => { setSelected(null); setView('browse'); }} className={`absolute top-4 ${rtl ? 'right-4' : 'left-4'} w-10 h-10 rounded-full bg-black/50 flex items-center justify-center`}>{rtl ? <ChevronRight /> : <ChevronLeft />}</button>
                <button onClick={() => toggleSave(selected)} className={`absolute top-4 ${rtl ? 'left-4' : 'right-4'} w-10 h-10 rounded-full flex items-center justify-center ${savedIds.has(selected.id) ? 'bg-red-500' : 'bg-black/50'}`}><Heart className={`w-5 h-5 ${savedIds.has(selected.id) ? 'fill-current' : ''}`} /></button>
              </div>
              <div className="px-5 space-y-4">
                <div>
                  <h1 className="text-xl font-bold">{lang === 'he' && selected.title_hebrew ? selected.title_hebrew : selected.title}</h1>
                  <p className="text-3xl font-bold text-green-400 mt-1">{formatPrice(selected.price)}</p>
                </div>
                {selected.description && <Card className="p-4"><p className="text-sm text-slate-300">{selected.description}</p></Card>}
                {selected.seller && (
                  <Card className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center text-lg font-bold">{selected.seller.full_name?.charAt(0) || 'S'}</div>
                      <div><span className="font-medium">{selected.seller.full_name || 'Seller'}</span>{selected.seller.is_verified && <Shield className="w-4 h-4 text-blue-400 inline ml-1" />}</div>
                    </div>
                  </Card>
                )}
                <div className="flex gap-3 pb-4">
                  <Btn primary className="flex-1" onClick={contactSeller}><MessageCircle className="w-4 h-4" />{t.contact}</Btn>
                  <Btn onClick={() => toggleSave(selected)}><Heart className={`w-4 h-4 ${savedIds.has(selected.id) ? 'fill-current text-red-400' : ''}`} /></Btn>
                </div>
              </div>
            </div>
          )}

          {/* SAVED */}
          {view === 'saved' && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold">{t.saved}</h2>
              {!user ? (
                <div className="text-center py-12"><Heart className="w-10 h-10 text-slate-600 mx-auto mb-2" /><p className="text-slate-400 mb-4">{t.signInSave}</p><Btn primary onClick={() => goTab('profile')}>{t.signIn}</Btn></div>
              ) : savedItems.length === 0 ? (
                <div className="text-center py-12"><Heart className="w-10 h-10 text-slate-600 mx-auto mb-2" /><p className="text-slate-400 mb-4">{t.noSaved}</p><Btn primary onClick={() => goTab('browse')}>{t.browse}</Btn></div>
              ) : (
                <div className="grid grid-cols-2 gap-3">{savedItems.map(item => <ListingCard key={item.id} item={item} />)}</div>
              )}
            </div>
          )}

          {/* AUTH */}
          {view === 'auth' && (
            <div className="space-y-5 pt-4">
              <div className="text-center">
                <h2 className="text-xl font-bold">{authMode === 'login' ? t.welcome : t.createAcc}</h2>
                <p className="text-slate-400 text-sm">{authMode === 'login' ? t.signInAccess : t.join}</p>
              </div>
              {authError && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-300">{authError}</div>}
              <button onClick={signInGoogle} className="w-full py-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center gap-3">
                <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                {t.google}
              </button>
              <div className="flex items-center gap-4"><div className="flex-1 h-px bg-white/10" /><span className="text-xs text-slate-500">{t.or}</span><div className="flex-1 h-px bg-white/10" /></div>
              <form onSubmit={signInEmail} className="space-y-3">
                {authMode === 'signup' && <Inp label={t.name} value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} />}
                <Inp label={t.email} type="email" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} required />
                <Inp label={t.password} type="password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} required />
                <Btn primary className="w-full">{authMode === 'login' ? t.signIn : t.signUp}</Btn>
              </form>
              <p className="text-center text-sm text-slate-400">{authMode === 'login' ? t.noAcc : t.haveAcc} <button onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(null); }} className="text-blue-400">{authMode === 'login' ? t.signUp : t.signIn}</button></p>
            </div>
          )}

          {/* PROFILE */}
          {view === 'profile' && user && (
            <div className="space-y-4">
              <Card className="p-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-blue-600 flex items-center justify-center text-xl font-bold">{profile?.full_name?.charAt(0) || user.email?.charAt(0) || 'U'}</div>
                  <div className="flex-1">
                    <h3 className="font-bold">{profile?.full_name || user.email?.split('@')[0]}</h3>
                    <p className="text-xs text-slate-400">{user.email}</p>
                  </div>
                  <button onClick={signOut} className="p-2 rounded-lg bg-white/5"><LogOut className="w-4 h-4 text-slate-400" /></button>
                </div>
              </Card>
              <div className="grid grid-cols-3 gap-2">
                <Card className="p-3 text-center"><p className="text-xl font-bold text-blue-400">{myListings.length}</p><p className="text-[10px] text-slate-500">{t.myListings}</p></Card>
                <Card className="p-3 text-center"><p className="text-xl font-bold text-green-400">{profile?.total_sales || 0}</p><p className="text-[10px] text-slate-500">Sales</p></Card>
                <Card className="p-3 text-center"><p className="text-xl font-bold text-red-400">{savedItems.length}</p><p className="text-[10px] text-slate-500">{t.saved}</p></Card>
              </div>
            </div>
          )}

          {/* MY LISTINGS */}
          {view === 'myListings' && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold">{t.myListings}</h2>
              {!user ? (
                <div className="text-center py-12"><ShoppingBag className="w-10 h-10 text-slate-600 mx-auto mb-2" /><p className="text-slate-400 mb-4">{t.signInList}</p><Btn primary onClick={() => goTab('profile')}>{t.signIn}</Btn></div>
              ) : myListings.length === 0 ? (
                <Card className="p-8 text-center"><ShoppingBag className="w-10 h-10 text-slate-600 mx-auto mb-2" /><p className="text-slate-400 mb-4">{t.noListings}</p><Btn primary onClick={() => { reset(); goTab('home'); }}><Scan className="w-4 h-4" />{t.scan}</Btn></Card>
              ) : (
                <div className="space-y-3">{myListings.map(item => (
                  <Card key={item.id} className="p-3">
                    <div className="flex gap-3">
                      <div className="w-20 h-20 rounded-lg overflow-hidden"><img src={item.images?.[0]} className="w-full h-full object-cover" /></div>
                      <div className="flex-1">
                        <div className="flex justify-between"><h3 className="font-medium text-sm">{item.title}</h3><button onClick={() => deleteListing(item.id)} className="p-1"><Trash2 className="w-4 h-4 text-red-400" /></button></div>
                        <p className="text-lg font-bold text-green-400">{formatPrice(item.price)}</p>
                        <p className="text-xs text-slate-500 flex items-center gap-1"><Eye className="w-3 h-3" />{item.views || 0} • {timeAgo(item.created_at)}</p>
                      </div>
                    </div>
                  </Card>
                ))}</div>
              )}
            </div>
          )}

          {/* LISTING FLOW */}
          {view === 'listing' && result && (
            <div className="space-y-4">
              {listingStep === 0 && (
                <>
                  <Back onClick={() => setView('results')} />
                  <h2 className="text-lg font-bold text-center">{t.condition}</h2>
                  <div className="space-y-2">
                    {[{ id: 'newSealed', icon: Box, color: 'emerald' }, { id: 'likeNew', icon: Sparkles, color: 'blue' }, { id: 'used', icon: Package, color: 'amber' }, { id: 'poor', icon: AlertTriangle, color: 'red' }].map(c => (
                      <button key={c.id} onClick={() => selectCondition(c.id)} className={`w-full p-4 rounded-xl border-2 flex items-center gap-4 ${condition === c.id ? 'border-blue-500 bg-blue-500/10' : 'border-white/10 bg-white/5'}`}>
                        <div className={`w-10 h-10 rounded-lg bg-${c.color}-500 flex items-center justify-center`}><c.icon className="w-5 h-5" /></div>
                        <span className="flex-1 font-medium text-left">{t[c.id]}</span>
                        {condition === c.id ? <CheckCircle className="w-5 h-5 text-blue-400" /> : <Circle className="w-5 h-5 text-slate-600" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {listingStep === 1 && (
                <>
                  <Back onClick={() => setListingStep(0)} />
                  <h2 className="text-lg font-bold text-center">{t.more}</h2>
                  <div className="space-y-3">
                    {[{ key: 'scratches', opts: ['yes', 'no'] }, { key: 'battery', opts: ['good', 'degraded', 'poor'] }, { key: 'issues', opts: ['yes', 'no'] }].map(q => (
                      <Card key={q.key} className="p-3">
                        <p className="text-sm font-medium mb-2">{t[q.key]}</p>
                        <div className="flex gap-2">{q.opts.map(o => <button key={o} onClick={() => setAnswers({ ...answers, [q.key]: o })} className={`flex-1 py-2 rounded-lg text-sm ${answers[q.key] === o ? 'bg-blue-600' : 'bg-white/5'}`}>{t[o]}</button>)}</div>
                      </Card>
                    ))}
                  </div>
                  <Card className="p-3 text-center bg-green-500/10 border-green-500/20">
                    <p className="text-xs text-slate-400">{t.yourPrice}</p>
                    <p className="text-2xl font-bold text-green-400">{formatPrice(calcPrice(result?.marketValue?.mid, 'used', answers))}</p>
                  </Card>
                  <Btn primary className="w-full" onClick={() => { setListingData(prev => ({ ...prev, price: calcPrice(result?.marketValue?.mid, 'used', answers) })); setListingStep(2); }}>{t.continue}</Btn>
                </>
              )}
              {listingStep === 2 && (
                <>
                  <Back onClick={() => setListingStep(condition === 'used' ? 1 : 0)} />
                  <h2 className="text-lg font-bold text-center">{t.review}</h2>
                  <Inp label={t.title} value={listingData.title} onChange={(e) => setListingData({ ...listingData, title: e.target.value })} />
                  <div className="space-y-1"><label className="text-sm text-slate-400">{t.desc}</label><textarea className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 h-20 resize-none" value={listingData.desc} onChange={(e) => setListingData({ ...listingData, desc: e.target.value })} /></div>
                  <Card className="p-4 bg-green-500/10 border-green-500/20">
                    <span className="text-sm text-slate-400">{t.yourPrice}</span>
                    <div className="flex items-center gap-2 mt-1"><span className="text-2xl font-bold text-green-400">₪</span><input type="number" className="flex-1 bg-transparent text-2xl font-bold text-green-400 focus:outline-none" value={listingData.price} onChange={(e) => setListingData({ ...listingData, price: parseInt(e.target.value) || 0 })} /></div>
                  </Card>
                  <Inp label={t.phone} placeholder="050-000-0000" value={listingData.phone} onChange={(e) => setListingData({ ...listingData, phone: e.target.value })} />
                  <Inp label={t.location} value={listingData.location} onChange={(e) => setListingData({ ...listingData, location: e.target.value })} />
                  <Btn primary className="w-full py-4" onClick={publishListing} disabled={publishing}>{publishing ? <><Loader2 className="w-4 h-4 animate-spin" />{t.publishing}</> : <><Check className="w-4 h-4" />{t.publish}</>}</Btn>
                </>
              )}
              {listingStep === 3 && (
                <div className="text-center py-8 space-y-6">
                  <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto"><CheckCircle className="w-10 h-10 text-green-400" /></div>
                  <div><h2 className="text-2xl font-bold text-green-400">{t.published}</h2><p className="text-slate-400">{t.live}</p></div>
                  <div className="flex gap-3">
                    <Btn className="flex-1" onClick={() => { reset(); goTab('sell'); }}><Eye className="w-4 h-4" />{t.view}</Btn>
                    <Btn primary className="flex-1"><Share2 className="w-4 h-4" />{t.share}</Btn>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        {/* Bottom Nav */}
        <nav className="fixed bottom-0 left-0 right-0 bg-[#0a0f1a]/95 border-t border-white/10 z-40">
          <div className="max-w-md mx-auto flex">
            {[{ id: 'home', icon: Home }, { id: 'browse', icon: Search }, { id: 'sell', icon: ShoppingBag }, { id: 'saved', icon: Heart }, { id: 'profile', icon: User }].map(n => (
              <button key={n.id} onClick={() => goTab(n.id)} className={`flex-1 py-3 flex flex-col items-center gap-0.5 ${tab === n.id ? 'text-blue-400' : 'text-slate-500'}`}>
                <n.icon className={`w-5 h-5 ${n.id === 'saved' && savedItems.length > 0 && tab !== 'saved' ? 'text-red-400' : ''}`} />
                <span className="text-[10px]">{t[n.id]}</span>
                {n.id === 'sell' && myListings.length > 0 && <span className="absolute top-1 right-1/4 w-4 h-4 rounded-full bg-blue-500 text-[9px] flex items-center justify-center">{myListings.length}</span>}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
