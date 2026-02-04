import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Camera, Upload, X, Sparkles, DollarSign, Package, Smartphone, Watch, ChevronRight, ChevronLeft, Loader2, ImagePlus, Share2, AlertCircle, Shirt, Dumbbell, Scan, User, LogOut, Plus, Trash2, Clock, Globe, Home, ShoppingBag, CheckCircle, Circle, Box, Shield, AlertTriangle, Eye, MessageCircle, Phone, Check, MapPin, Search, SlidersHorizontal, Heart, Grid, RefreshCw, Star, Zap, TrendingUp } from 'lucide-react';
import { supabase } from './lib/supabase';

const T = {
  en: { appName: "GetWorth", tagline: "AI Valuation", aiPowered: "AI-Powered", heroTitle1: "Know Your", heroTitle2: "Item's Value", heroSub: "Snap or upload any item for instant AI valuation.", drop: "Drop image here", orButtons: "or use buttons below", scan: "Scan", upload: "Upload", analyzing: "Analyzing...", marketValue: "Market Value", range: "Range", listItem: "List This Item", scanAnother: "Scan Another", welcome: "Welcome back", createAcc: "Create account", signInAccess: "Sign in to access", join: "Join GetWorth", google: "Continue with Google", or: "or", name: "Full Name", email: "Email", password: "Password", signIn: "Sign In", signUp: "Sign Up", noAcc: "No account?", haveAcc: "Have account?", back: "Back", myListings: "My Listings", noListings: "No listings yet", home: "Home", browse: "Browse", sell: "Sell", saved: "Saved", profile: "Profile", condition: "Select Condition", newSealed: "New", likeNew: "Like New", used: "Used", poor: "Poor", yourPrice: "Your Price", more: "Tell Us More", scratches: "Scratches?", battery: "Battery?", issues: "Issues?", yes: "Yes", no: "No", good: "Good", degraded: "Degraded", continue: "Continue", review: "Review Listing", title: "Title", desc: "Description", phone: "Phone", location: "Location", publish: "Publish", publishing: "Publishing...", published: "Listed!", live: "Your item is live", view: "View", share: "Share", seller: "Seller", contact: "Contact", call: "Call", whatsapp: "WhatsApp", today: "today", yesterday: "yesterday", daysAgo: "d ago", noSaved: "No saved items", signInReq: "Sign In Required", signInSave: "Sign in to save", signInContact: "Sign in to contact", signInList: "Sign in to list", cancel: "Cancel", all: "All", phones: "Phones", watches: "Watches", clothing: "Clothing", furniture: "Furniture", sports: "Sports", filters: "Filters", clear: "Clear", min: "Min", max: "Max", results: "results", newest: "Newest", lowHigh: "Low-High", highLow: "High-Low", noResults: "No items found", failed: "Analysis failed", cameraDenied: "Camera access denied", verified: "Verified", views: "views", sales: "Sales" },
  he: { appName: "GetWorth", tagline: "הערכת שווי", aiPowered: "AI", heroTitle1: "גלה את", heroTitle2: "שווי הפריט", heroSub: "צלם או העלה תמונה לקבלת הערכה.", drop: "גרור תמונה", orButtons: "או לחץ למטה", scan: "סרוק", upload: "העלה", analyzing: "מנתח...", marketValue: "שווי שוק", range: "טווח", listItem: "פרסם", scanAnother: "סרוק עוד", welcome: "שלום", createAcc: "צור חשבון", signInAccess: "התחבר", join: "הצטרף", google: "המשך עם Google", or: "או", name: "שם", email: "אימייל", password: "סיסמה", signIn: "התחבר", signUp: "הירשם", noAcc: "אין חשבון?", haveAcc: "יש חשבון?", back: "חזור", myListings: "המודעות שלי", noListings: "אין מודעות", home: "בית", browse: "חיפוש", sell: "מכירה", saved: "שמורים", profile: "פרופיל", condition: "בחר מצב", newSealed: "חדש", likeNew: "כמו חדש", used: "משומש", poor: "גרוע", yourPrice: "מחיר", more: "פרטים נוספים", scratches: "שריטות?", battery: "סוללה?", issues: "בעיות?", yes: "כן", no: "לא", good: "טוב", degraded: "בינוני", continue: "המשך", review: "סקירה", title: "כותרת", desc: "תיאור", phone: "טלפון", location: "מיקום", publish: "פרסם", publishing: "מפרסם...", published: "פורסם!", live: "המודעה באוויר", view: "צפה", share: "שתף", seller: "מוכר", contact: "צור קשר", call: "התקשר", whatsapp: "וואטסאפ", today: "היום", yesterday: "אתמול", daysAgo: "ימים", noSaved: "אין שמורים", signInReq: "נדרשת התחברות", signInSave: "התחבר לשמירה", signInContact: "התחבר ליצירת קשר", signInList: "התחבר לפרסום", cancel: "ביטול", all: "הכל", phones: "טלפונים", watches: "שעונים", clothing: "ביגוד", furniture: "ריהוט", sports: "ספורט", filters: "סינון", clear: "נקה", min: "מינ׳", max: "מקס׳", results: "תוצאות", newest: "חדש", lowHigh: "מחיר ↑", highLow: "מחיר ↓", noResults: "לא נמצאו פריטים", failed: "הניתוח נכשל", cameraDenied: "הגישה למצלמה נדחתה", verified: "מאומת", views: "צפיות", sales: "מכירות" }
};

// Animated components
const FadeIn = ({ children, delay = 0, className = '' }) => (
  <div className={`animate-fadeIn ${className}`} style={{ animationDelay: `${delay}ms` }}>{children}</div>
);

const SlideUp = ({ children, delay = 0, className = '' }) => (
  <div className={`animate-slideUp ${className}`} style={{ animationDelay: `${delay}ms` }}>{children}</div>
);

const ScaleIn = ({ children, delay = 0, className = '' }) => (
  <div className={`animate-scaleIn ${className}`} style={{ animationDelay: `${delay}ms` }}>{children}</div>
);

// Toast component with animation
const Toast = ({ message, onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 2500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-toastIn">
      <div className="px-5 py-3 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-500 text-white text-sm font-semibold shadow-xl shadow-green-500/30 flex items-center gap-2">
        <CheckCircle className="w-4 h-4" />
        {message}
      </div>
    </div>
  );
};

// Skeleton loader with shimmer
const Skeleton = ({ className }) => (
  <div className={`bg-white/5 rounded-2xl overflow-hidden relative ${className}`}>
    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/10 to-transparent" />
  </div>
);

// UI Components - defined outside to prevent re-renders
const Card = ({ children, className = '', onClick, glow, gradient }) => (
  <div 
    onClick={onClick} 
    className={`relative rounded-3xl backdrop-blur-xl transition-all duration-500 ${onClick ? 'cursor-pointer hover:scale-[1.02] hover:-translate-y-1 active:scale-[0.98]' : ''} ${className}`}
    style={{ 
      background: gradient || 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: glow ? '0 8px 32px rgba(59,130,246,0.15), inset 0 1px 0 rgba(255,255,255,0.1)' : '0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)'
    }}
  >
    {children}
  </div>
);

const Btn = ({ children, primary, secondary, disabled, className = '', ...p }) => (
  <button 
    disabled={disabled} 
    className={`relative px-6 py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all duration-300 active:scale-95 disabled:opacity-50 overflow-hidden group ${className}`}
    style={{
      background: primary ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 50%, #1d4ed8 100%)' : secondary ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'rgba(255,255,255,0.05)',
      border: primary || secondary ? 'none' : '1px solid rgba(255,255,255,0.1)',
      boxShadow: primary ? '0 8px 24px rgba(59,130,246,0.4), inset 0 1px 0 rgba(255,255,255,0.2)' : secondary ? '0 8px 24px rgba(16,185,129,0.4)' : 'none'
    }}
    {...p}
  >
    <span className="relative z-10 flex items-center gap-2">{children}</span>
    {(primary || secondary) && <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />}
  </button>
);

const Badge = ({ children, color = 'blue' }) => (
  <span className={`px-3 py-1 rounded-full text-xs font-semibold bg-${color}-500/20 text-${color}-400 border border-${color}-500/30`}>
    {children}
  </span>
);

// Sample items for home page showcase (demo purposes)
const SAMPLE_ITEMS = [
  { id: 's1', title: 'PlayStation 5', title_hebrew: 'פלייסטיישן 5', price: 1800, condition: 'likeNew', location: 'Tel Aviv', seller: { full_name: 'David Cohen' }, images: ['https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=400&q=80'] },
  { id: 's2', title: 'Rolex Submariner', title_hebrew: 'רולקס סאבמרינר', price: 45000, condition: 'used', location: 'Herzliya', seller: { full_name: 'Michael Levy' }, images: ['https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80'] },
  { id: 's3', title: 'Dior Sauvage Perfume', title_hebrew: 'בושם דיור סוואג׳', price: 350, condition: 'newSealed', location: 'Ramat Gan', seller: { full_name: 'Sarah Israeli' }, images: ['https://images.unsplash.com/photo-1541643600914-78b084683601?w=400&q=80'] },
  { id: 's4', title: 'Electric Bicycle', title_hebrew: 'אופניים חשמליים', price: 4500, condition: 'used', location: 'Haifa', seller: { full_name: 'Yossi Mizrahi' }, images: ['https://images.unsplash.com/photo-1571068316344-75bc76f77890?w=400&q=80'] },
  { id: 's5', title: 'MacBook Pro M3', title_hebrew: 'מקבוק פרו M3', price: 8500, condition: 'likeNew', location: 'Tel Aviv', seller: { full_name: 'Noa Shapira' }, images: ['https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400&q=80'] },
  { id: 's6', title: 'Dining Table Oak', title_hebrew: 'שולחן אוכל אלון', price: 2800, condition: 'used', location: 'Netanya', seller: { full_name: 'Amit Goldstein' }, images: ['https://images.unsplash.com/photo-1617806118233-18e1de247200?w=400&q=80'] },
  { id: 's7', title: 'iPhone 15 Pro Max', title_hebrew: 'אייפון 15 פרו מקס', price: 4200, condition: 'newSealed', location: 'Jerusalem', seller: { full_name: 'Oren Azulay' }, images: ['https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=400&q=80'] },
  { id: 's8', title: 'Nike Air Jordan 1', title_hebrew: 'נייק אייר ג׳ורדן 1', price: 890, condition: 'newSealed', location: 'Rishon', seller: { full_name: 'Maya Peretz' }, images: ['https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&q=80'] },
  { id: 's9', title: 'Sony 65" 4K TV', title_hebrew: 'טלוויזיה סוני 65 אינץ׳', price: 3200, condition: 'likeNew', location: 'Ashdod', seller: { full_name: 'Eli Biton' }, images: ['https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=400&q=80'] },
  { id: 's10', title: 'DJI Mavic 3 Drone', title_hebrew: 'רחפן DJI מאוויק 3', price: 5500, condition: 'used', location: 'Beer Sheva', seller: { full_name: 'Tal Amir' }, images: ['https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=400&q=80'] },
  { id: 's11', title: 'Leather Sofa', title_hebrew: 'ספה עור', price: 4800, condition: 'used', location: 'Petah Tikva', seller: { full_name: 'Dana Katz' }, images: ['https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=80'] },
  { id: 's12', title: 'Canon EOS R5', title_hebrew: 'מצלמת קנון R5', price: 12000, condition: 'likeNew', location: 'Tel Aviv', seller: { full_name: 'Ran Levi' }, images: ['https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=400&q=80'] },
];

export default function GetWorth() {
  const [lang, setLang] = useState('he');
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('home');
  const [view, setView] = useState('home');
  const [listings, setListings] = useState([]);
  const [myListings, setMyListings] = useState([]);
  const [savedIds, setSavedIds] = useState(new Set());
  const [savedItems, setSavedItems] = useState([]);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [images, setImages] = useState([]);
  const [result, setResult] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [listingStep, setListingStep] = useState(0);
  const [condition, setCondition] = useState(null);
  const [answers, setAnswers] = useState({});
  const [listingData, setListingData] = useState({ title: '', desc: '', price: 0, phone: '', location: '' });
  const [publishing, setPublishing] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [priceRange, setPriceRange] = useState({ min: '', max: '' });
  const [debouncedPriceRange, setDebouncedPriceRange] = useState({ min: '', max: '' });
  const [sort, setSort] = useState('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState(null);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [signInAction, setSignInAction] = useState(null);
  const [showContact, setShowContact] = useState(false);
  const [heartAnim, setHeartAnim] = useState(null);

  const t = T[lang];
  const rtl = lang === 'he';

  // Auth
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
      } catch (e) { console.error(e); }
      if (mounted) setLoading(false);
    };
    init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      if (session?.user) {
        setUser(session.user);
        const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        if (data) setProfile(data);
        if (event === 'SIGNED_IN' && view === 'auth') { setView('profile'); setTab('profile'); }
      } else { setUser(null); setProfile(null); }
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 500);
    return () => clearTimeout(timer);
  }, [search]);

  // Debounce price range
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPriceRange(priceRange), 500);
    return () => clearTimeout(timer);
  }, [priceRange]);

  useEffect(() => { loadListings(); }, [category, debouncedPriceRange.min, debouncedPriceRange.max, debouncedSearch]);
  useEffect(() => { if (user) loadUserData(); else { setMyListings([]); setSavedItems([]); setSavedIds(new Set()); } }, [user]);

  const loadListings = async () => {
    let query = supabase.from('listings').select('*, seller:profiles(id, full_name, avatar_url, badge, is_verified, rating)').eq('status', 'active').order('created_at', { ascending: false });
    if (category !== 'all') query = query.eq('category', category);
    if (debouncedPriceRange.min) query = query.gte('price', parseInt(debouncedPriceRange.min));
    if (debouncedPriceRange.max) query = query.lte('price', parseInt(debouncedPriceRange.max));
    if (debouncedSearch) query = query.or(`title.ilike.%${debouncedSearch}%,title_hebrew.ilike.%${debouncedSearch}%`);
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
    if (savedData) { setSavedItems(savedData.map(s => s.listing).filter(Boolean)); setSavedIds(new Set(savedData.map(s => s.listing_id))); }
  };

  const showToastMsg = (msg) => { setToast(msg); };
  const formatPrice = (p) => p ? `₪${p.toLocaleString()}` : '';
  const timeAgo = (d) => { const days = Math.floor((Date.now() - new Date(d)) / 86400000); return days === 0 ? t.today : days === 1 ? t.yesterday : `${days}${t.daysAgo}`; };
  const calcPrice = (base, cond, ans) => {
    if (!base) return 0;
    const disc = { newSealed: 0, likeNew: 0.15, used: 0.3, poor: 0.7 }[cond] || 0;
    let extra = 0;
    if (cond === 'used') { if (ans.scratches === 'yes') extra += 0.02; if (ans.battery === 'poor') extra += 0.02; if (ans.issues === 'yes') extra += 0.03; }
    return Math.round(base * (1 - disc - extra));
  };

  const signInGoogle = async () => { await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } }); };
  const signInEmail = async (e) => {
    e.preventDefault(); setAuthError(null);
    const { error } = authMode === 'login' ? await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password }) : await supabase.auth.signUp({ email: authForm.email, password: authForm.password, options: { data: { full_name: authForm.name } } });
    if (error) setAuthError(error.message); else if (authMode === 'signup') setAuthError('Check your email!');
  };
  const signOut = async () => { await supabase.auth.signOut(); setTab('home'); setView('home'); showToastMsg('Signed out'); };

  const toggleSave = async (item) => {
    if (!user) { setSignInAction('save'); setShowSignInModal(true); return; }
    setHeartAnim(item.id);
    setTimeout(() => setHeartAnim(null), 800);
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

  const deleteListing = async (id) => { await supabase.from('listings').update({ status: 'deleted' }).eq('id', id); loadUserData(); showToastMsg('Deleted'); };

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
      setImages([e.target.result]); setView('analyzing');
      try { const r = await analyzeImage(e.target.result); setResult(r); setView('results'); }
      catch { setError(t.failed); setView('home'); }
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
    setImages([img]); setView('analyzing');
    analyzeImage(img).then(r => { setResult(r); setView('results'); }).catch(() => { setError(t.failed); setView('home'); });
  };

  const stopCamera = () => { videoRef.current?.srcObject?.getTracks().forEach(t => t.stop()); setView('home'); };

  const startListing = () => {
    if (!user) { setSignInAction('list'); setShowSignInModal(true); return; }
    setListingData({ title: result?.name || '', desc: '', price: result?.marketValue?.mid || 0, phone: '', location: '' });
    setCondition(null); setAnswers({}); setListingStep(0); setView('listing');
  };

  const selectCondition = (c) => {
    setCondition(c);
    setListingData(prev => ({ ...prev, price: calcPrice(result?.marketValue?.mid, c, answers) }));
    setListingStep(c === 'used' ? 1 : 2);
  };

  const publishListing = async () => {
    setPublishing(true);
    try {
      await supabase.from('listings').insert({ seller_id: user.id, title: listingData.title, title_hebrew: result?.nameHebrew || '', description: listingData.desc, category: result?.category || 'Other', condition, price: listingData.price, images: images, location: listingData.location, contact_phone: listingData.phone });
      loadUserData(); loadListings(); setListingStep(3); showToastMsg(t.published);
    } catch (e) { setError(e.message); }
    setPublishing(false);
  };

  const reset = () => { setImages([]); setResult(null); setView('home'); setError(null); setCondition(null); setListingStep(0); setSelected(null); };
  const goTab = (newTab) => { setTab(newTab); setSelected(null); if (newTab === 'home') setView('home'); else if (newTab === 'browse') setView('browse'); else if (newTab === 'sell') setView('myListings'); else if (newTab === 'saved') setView('saved'); else if (newTab === 'profile') setView(user ? 'profile' : 'auth'); };
  const viewItem = (item) => { setSelected(item); setView('detail'); };
  const contactSeller = () => { if (!user) { setSignInAction('contact'); setShowSignInModal(true); return; } setShowContact(true); };

  // Input component - kept inside for rtl access but simplified
  const InputField = ({ label, icon: Icon, ...p }) => (
    <div className="space-y-2">
      {label && <label className="text-sm text-slate-400 font-medium">{label}</label>}
      <div className="relative">
        {Icon && <Icon className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'right-4' : 'left-4'} w-5 h-5 text-slate-500`} />}
        <input 
          className={`w-full px-4 py-4 ${Icon ? (rtl ? 'pr-12' : 'pl-12') : ''} rounded-2xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all`}
          dir={rtl ? 'rtl' : 'ltr'} 
          {...p} 
        />
      </div>
    </div>
  );

  const Back = ({ onClick }) => (
    <button onClick={onClick} className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 transition-all group">
      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-all">
        {rtl ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
      </div>
      <span className="text-sm font-medium">{t.back}</span>
    </button>
  );

  const ListingCard = ({ item, index = 0 }) => (
    <FadeIn delay={index * 50}>
      <Card className="overflow-hidden group" onClick={() => viewItem(item)}>
        <div className="relative aspect-square overflow-hidden">
          <img src={item.images?.[0]} alt="" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />
          
          {/* Save button */}
          <button 
            onClick={(e) => { e.stopPropagation(); toggleSave(item); }} 
            className={`absolute top-3 ${rtl ? 'left-3' : 'right-3'} w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-300 backdrop-blur-md ${savedIds.has(item.id) ? 'bg-red-500 shadow-lg shadow-red-500/50' : 'bg-black/30 hover:bg-black/50'} ${heartAnim === item.id ? 'animate-heartPop' : ''}`}
          >
            <Heart className={`w-5 h-5 transition-all ${savedIds.has(item.id) ? 'fill-current scale-110' : ''}`} />
          </button>

          {/* Condition badge */}
          {item.condition && (
            <div className={`absolute bottom-3 ${rtl ? 'right-3' : 'left-3'} px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider backdrop-blur-md ${
              item.condition === 'newSealed' ? 'bg-emerald-500/90' : 
              item.condition === 'likeNew' ? 'bg-blue-500/90' : 
              item.condition === 'used' ? 'bg-amber-500/90' : 'bg-red-500/90'
            }`}>
              {item.condition === 'newSealed' ? '✨ New' : item.condition === 'likeNew' ? 'Like New' : item.condition === 'used' ? 'Used' : 'Poor'}
            </div>
          )}
        </div>
        
        <div className="p-4 space-y-2">
          <h3 className="font-semibold text-sm truncate group-hover:text-blue-400 transition-colors">
            {lang === 'he' && item.title_hebrew ? item.title_hebrew : item.title}
          </h3>
          <p className="text-2xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">
            {formatPrice(item.price)}
          </p>
          <div className="flex justify-between items-center pt-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              {item.location || 'Israel'}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {timeAgo(item.created_at)}
            </span>
          </div>
        </div>
      </Card>
    </FadeIn>
  );

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
            {[0, 1, 2].map(i => (
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
              <h3 className="text-2xl font-bold text-center">{t.contact}</h3>
              
              <Card className="p-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-2xl font-bold shadow-lg shadow-blue-500/30">
                    {selected.seller?.full_name?.charAt(0) || 'S'}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg">{selected.seller?.full_name || 'Seller'}</span>
                      {selected.seller?.is_verified && <Shield className="w-5 h-5 text-blue-400" />}
                    </div>
                    {selected.seller?.rating && (
                      <div className="flex items-center gap-1 text-sm text-slate-400 mt-1">
                        <Star className="w-4 h-4 text-yellow-400 fill-current" />
                        <span>{selected.seller.rating}</span>
                      </div>
                    )}
                  </div>
                </div>
              </Card>

              <div className="grid grid-cols-2 gap-3">
                <a href={`tel:${selected.contact_phone}`} className="py-4 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-500 text-center font-semibold flex items-center justify-center gap-2 shadow-lg shadow-green-500/30 active:scale-95 transition-transform">
                  <Phone className="w-5 h-5" />{t.call}
                </a>
                <a href={`https://wa.me/972${(selected.contact_phone || '').replace(/^0/, '').replace(/-/g, '')}`} target="_blank" className="py-4 rounded-2xl bg-gradient-to-r from-[#25D366] to-[#128C7E] text-center font-semibold flex items-center justify-center gap-2 shadow-lg shadow-green-500/30 active:scale-95 transition-transform">
                  <MessageCircle className="w-5 h-5" />{t.whatsapp}
                </a>
              </div>
              
              <Btn className="w-full" onClick={() => setShowContact(false)}>{t.cancel}</Btn>
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
          <button 
            onClick={() => setLang(lang === 'en' ? 'he' : 'en')} 
            className="px-4 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium flex items-center gap-2 transition-all hover:scale-105 active:scale-95"
          >
            <Globe className="w-4 h-4 text-blue-400" />
            {lang === 'en' ? 'עב' : 'EN'}
          </button>
        </header>

        {/* Content */}
        <main className="flex-1 px-5 pb-4 overflow-y-auto">
          
          {/* HOME */}
          {view === 'home' && (
            <div className="space-y-6">
              {/* Hidden file input */}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
              
              {/* Hero Section */}
              <FadeIn className="text-center space-y-4 pt-2">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-semibold text-blue-300 tracking-wide">{t.aiPowered}</span>
                </div>
                <h2 className="text-3xl font-bold leading-tight">
                  {t.heroTitle1}<br/>
                  <span className="bg-gradient-to-r from-blue-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">{t.heroTitle2}</span>
                </h2>
                <p className="text-slate-400 text-sm max-w-xs mx-auto">{t.heroSub}</p>
              </FadeIn>

              {/* Action Buttons */}
              <FadeIn delay={100} className="grid grid-cols-2 gap-4">
                <Btn primary onClick={startCamera} className="py-4">
                  <Scan className="w-5 h-5" />{t.scan}
                </Btn>
                <Btn onClick={() => fileRef.current?.click()} className="py-4">
                  <Upload className="w-5 h-5" />{t.upload}
                </Btn>
              </FadeIn>

              {/* Marquee Listings Section - Always visible with sample + real items */}
              <FadeIn delay={200} className="space-y-4 -mx-5">
                {/* Section Header */}
                <div className="px-5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <h3 className="font-bold text-lg">{lang === 'he' ? 'פריטים חמים' : 'Hot Items'}</h3>
                    <span className="text-xs text-slate-500">•</span>
                    <span className="text-xs text-slate-400">{lang === 'he' ? 'בזמן אמת' : 'Live'}</span>
                  </div>
                  <button onClick={() => goTab('browse')} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    {lang === 'he' ? 'הכל' : 'See All'}
                    {rtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                </div>

                {/* Marquee Row 1 - Scrolls Left */}
                <div className="relative overflow-hidden">
                  <div className="flex gap-3 animate-marquee-left">
                    {[...SAMPLE_ITEMS.slice(0, 6), ...listings.slice(0, 4), ...SAMPLE_ITEMS.slice(0, 6), ...listings.slice(0, 4)].map((item, i) => (
                      <div 
                        key={`row1-${item.id}-${i}`} 
                        onClick={() => !item.id.startsWith('s') && viewItem(item)}
                        className="flex-shrink-0 w-40 cursor-pointer group"
                      >
                        <div className="relative rounded-2xl overflow-hidden bg-white/5 border border-white/10 transition-all duration-300 group-hover:scale-105 group-hover:border-blue-500/50 shadow-lg shadow-black/20">
                          <div className="aspect-square overflow-hidden">
                            <img src={item.images?.[0]} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 p-3">
                            <p className="text-xs font-semibold truncate text-white">{lang === 'he' && item.title_hebrew ? item.title_hebrew : item.title}</p>
                            <p className="text-base font-bold text-green-400 mt-0.5">{formatPrice(item.price)}</p>
                            <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                              <MapPin className="w-3 h-3" />{item.location}
                            </p>
                          </div>
                          {/* Condition badge */}
                          {item.condition && (
                            <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase ${
                              item.condition === 'newSealed' ? 'bg-emerald-500' : 
                              item.condition === 'likeNew' ? 'bg-blue-500' : 
                              item.condition === 'used' ? 'bg-amber-500' : 'bg-red-500'
                            }`}>
                              {item.condition === 'newSealed' ? (lang === 'he' ? 'חדש' : 'New') : 
                               item.condition === 'likeNew' ? (lang === 'he' ? 'כחדש' : 'Like New') : 
                               item.condition === 'used' ? (lang === 'he' ? 'משומש' : 'Used') : (lang === 'he' ? 'גרוע' : 'Poor')}
                            </div>
                          )}
                          {/* Seller avatar */}
                          <div className="absolute top-2 right-2 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-[11px] font-bold border-2 border-white/30 shadow-lg">
                            {item.seller?.full_name?.charAt(0) || 'S'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Marquee Row 2 - Scrolls Right (reverse order) */}
                <div className="relative overflow-hidden">
                  <div className="flex gap-3 animate-marquee-right">
                    {[...SAMPLE_ITEMS.slice(6, 12), ...listings.slice(4, 8), ...SAMPLE_ITEMS.slice(6, 12), ...listings.slice(4, 8)].map((item, i) => (
                      <div 
                        key={`row2-${item.id}-${i}`} 
                        onClick={() => !item.id.startsWith('s') && viewItem(item)}
                        className="flex-shrink-0 w-40 cursor-pointer group"
                      >
                        <div className="relative rounded-2xl overflow-hidden bg-white/5 border border-white/10 transition-all duration-300 group-hover:scale-105 group-hover:border-green-500/50 shadow-lg shadow-black/20">
                          <div className="aspect-square overflow-hidden">
                            <img src={item.images?.[0]} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 p-3">
                            <p className="text-xs font-semibold truncate text-white">{lang === 'he' && item.title_hebrew ? item.title_hebrew : item.title}</p>
                            <p className="text-base font-bold text-green-400 mt-0.5">{formatPrice(item.price)}</p>
                            <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                              <MapPin className="w-3 h-3" />{item.location}
                            </p>
                          </div>
                          {/* Condition badge */}
                          {item.condition && (
                            <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase ${
                              item.condition === 'newSealed' ? 'bg-emerald-500' : 
                              item.condition === 'likeNew' ? 'bg-blue-500' : 
                              item.condition === 'used' ? 'bg-amber-500' : 'bg-red-500'
                            }`}>
                              {item.condition === 'newSealed' ? (lang === 'he' ? 'חדש' : 'New') : 
                               item.condition === 'likeNew' ? (lang === 'he' ? 'כחדש' : 'Like New') : 
                               item.condition === 'used' ? (lang === 'he' ? 'משומש' : 'Used') : (lang === 'he' ? 'גרוע' : 'Poor')}
                            </div>
                          )}
                          {/* Seller avatar */}
                          <div className="absolute top-2 right-2 w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-[11px] font-bold border-2 border-white/30 shadow-lg">
                            {item.seller?.full_name?.charAt(0) || 'S'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Start Selling CTA */}
                <div className="px-5 pt-2">
                  <Card className="p-4 text-center" gradient="linear-gradient(135deg, rgba(59,130,246,0.1), rgba(139,92,246,0.1))">
                    <p className="text-sm font-medium text-slate-300">{lang === 'he' ? 'יש לך משהו למכור?' : 'Have something to sell?'}</p>
                    <p className="text-xs text-slate-500 mt-1">{lang === 'he' ? 'סרוק את הפריט וקבל הערכת מחיר מיידית' : 'Scan your item and get instant valuation'}</p>
                  </Card>
                </div>
              </FadeIn>


              {/* Quick Stats */}
              <FadeIn delay={300}>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { icon: Zap, label: lang === 'he' ? 'מהיר' : 'Fast', value: '< 3s' },
                    { icon: TrendingUp, label: lang === 'he' ? 'דיוק' : 'Accuracy', value: '95%' },
                    { icon: ShoppingBag, label: lang === 'he' ? 'פריטים' : 'Items', value: `${listings.length}+` }
                  ].map((stat, i) => (
                    <Card key={i} className="p-3 text-center">
                      <stat.icon className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                      <p className="text-base font-bold">{stat.value}</p>
                      <p className="text-[9px] text-slate-500 uppercase tracking-wider">{stat.label}</p>
                    </Card>
                  ))}
                </div>
              </FadeIn>
            </div>
          )}

          {/* CAMERA */}
          {view === 'camera' && (
            <div className="fixed inset-0 z-50 bg-black">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-8 rounded-3xl border-2 border-white/30" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }} />
                <div className="absolute top-10 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/50 backdrop-blur-sm text-sm">
                  Position item in frame
                </div>
              </div>
              <div className="absolute bottom-0 inset-x-0 p-8 flex justify-center gap-6 bg-gradient-to-t from-black via-black/80 to-transparent">
                <button onClick={stopCamera} className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center hover:bg-white/20 transition-all">
                  <X className="w-6 h-6" />
                </button>
                <button onClick={capture} className="w-20 h-20 rounded-full bg-gradient-to-r from-blue-500 to-blue-600 flex items-center justify-center shadow-xl shadow-blue-500/50 active:scale-95 transition-transform">
                  <div className="w-16 h-16 rounded-full border-4 border-white/30" />
                </button>
                <div className="w-14" />
              </div>
            </div>
          )}

          {/* ANALYZING */}
          {view === 'analyzing' && (
            <div className="flex-1 flex flex-col items-center justify-center py-20">
              <div className="relative">
                <div className="absolute -inset-8 bg-blue-500/20 rounded-full blur-3xl animate-pulse" />
                <div className="absolute -inset-4 bg-gradient-to-r from-blue-500 to-purple-500 rounded-3xl animate-spin-slow opacity-30" style={{ animationDuration: '4s' }} />
                <div className="relative w-48 h-48 rounded-3xl overflow-hidden border-2 border-blue-500/50 shadow-2xl shadow-blue-500/30">
                  {images[0] && <img src={images[0]} className="w-full h-full object-cover" />}
                </div>
              </div>
              <div className="mt-10 text-center space-y-4">
                <div className="flex items-center gap-3 justify-center">
                  <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                  <span className="text-lg font-medium">{t.analyzing}</span>
                </div>
                <div className="flex gap-1.5 justify-center">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* RESULTS */}
          {view === 'results' && result && (
            <div className="space-y-5 pb-4">
              <FadeIn>
                <div className="relative rounded-3xl overflow-hidden shadow-2xl">
                  <div className="aspect-[4/3]">
                    <img src={images[0]} className="w-full h-full object-cover" />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-5">
                    <Badge color="blue">{result.category}</Badge>
                    <h2 className="text-2xl font-bold mt-2">{lang === 'he' && result.nameHebrew ? result.nameHebrew : result.name}</h2>
                  </div>
                </div>
              </FadeIn>

              <FadeIn delay={100}>
                <Card className="p-6 text-center" gradient="linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1))" glow>
                  <p className="text-sm text-blue-300 font-medium mb-2">{t.marketValue}</p>
                  <p className="text-5xl font-bold bg-gradient-to-r from-blue-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">
                    {formatPrice(result.marketValue?.mid)}
                  </p>
                  {result.marketValue?.low > 0 && (
                    <p className="text-sm text-slate-400 mt-3">
                      {t.range}: {formatPrice(result.marketValue.low)} - {formatPrice(result.marketValue.high)}
                    </p>
                  )}
                </Card>
              </FadeIn>

              <FadeIn delay={200} className="flex gap-3">
                <Btn primary className="flex-1 py-4" onClick={startListing}>
                  <Plus className="w-5 h-5" />{t.listItem}
                </Btn>
                <Btn className="px-5">
                  <Share2 className="w-5 h-5" />
                </Btn>
              </FadeIn>

              <FadeIn delay={300}>
                <button onClick={reset} className="w-full py-3 text-slate-400 text-sm flex items-center justify-center gap-2 hover:text-white transition-colors">
                  <RefreshCw className="w-4 h-4" />{t.scanAnother}
                </button>
              </FadeIn>
            </div>
          )}

          {/* BROWSE */}
          {view === 'browse' && !selected && (
            <div className="space-y-5">
              <FadeIn>
                <div className="relative">
                  <Search className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'right-4' : 'left-4'} w-5 h-5 text-slate-500`} />
                  <input 
                    type="text" 
                    placeholder="Search..." 
                    value={search} 
                    onChange={(e) => setSearch(e.target.value)} 
                    className={`w-full py-4 ${rtl ? 'pr-12 pl-14' : 'pl-12 pr-14'} rounded-2xl bg-white/5 border border-white/10 focus:border-blue-500/50 focus:bg-white/10 transition-all`}
                  />
                  <button 
                    onClick={() => setShowFilters(!showFilters)} 
                    className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'left-3' : 'right-3'} p-2 rounded-xl transition-all ${showFilters ? 'bg-blue-600 shadow-lg shadow-blue-500/30' : 'bg-white/10 hover:bg-white/20'}`}
                  >
                    <SlidersHorizontal className="w-5 h-5" />
                  </button>
                </div>
              </FadeIn>

              <FadeIn delay={50}>
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide">
                  {categories.map(c => (
                    <button 
                      key={c.id} 
                      onClick={() => setCategory(c.id)} 
                      className={`flex-shrink-0 px-4 py-3 rounded-2xl flex items-center gap-2 text-xs font-semibold transition-all ${category === c.id ? 'bg-gradient-to-r from-blue-600 to-blue-500 shadow-lg shadow-blue-500/30' : 'bg-white/5 hover:bg-white/10 border border-white/10'}`}
                    >
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
                      {['newest', 'lowHigh', 'highLow'].map(s => (
                        <button key={s} onClick={() => setSort(s)} className={`py-3 rounded-xl text-xs font-semibold transition-all ${sort === s ? 'bg-blue-600 shadow-lg shadow-blue-500/20' : 'bg-white/5 hover:bg-white/10'}`}>{t[s]}</button>
                      ))}
                    </div>
                  </Card>
                </FadeIn>
              )}

              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-400">{sortedListings.length} {t.results}</p>
                <button onClick={loadListings} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
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
                <div className="grid grid-cols-2 gap-4">
                  {sortedListings.map((item, i) => <ListingCard key={item.id} item={item} index={i} />)}
                </div>
              )}
            </div>
          )}

          {/* DETAIL */}
          {view === 'detail' && selected && (
            <div className="space-y-5 -mx-5 -mt-4">
              <div className="relative">
                <div className="aspect-square">
                  <img src={selected.images?.[0]} className="w-full h-full object-cover" />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-[#060a14] via-transparent to-[#060a14]/50" />
                
                <button 
                  onClick={() => { setSelected(null); setView('browse'); }} 
                  className={`absolute top-4 ${rtl ? 'right-4' : 'left-4'} w-12 h-12 rounded-2xl bg-black/30 backdrop-blur-md flex items-center justify-center hover:bg-black/50 transition-all`}
                >
                  {rtl ? <ChevronRight className="w-6 h-6" /> : <ChevronLeft className="w-6 h-6" />}
                </button>
                
                <button 
                  onClick={() => toggleSave(selected)} 
                  className={`absolute top-4 ${rtl ? 'left-4' : 'right-4'} w-12 h-12 rounded-2xl flex items-center justify-center transition-all backdrop-blur-md ${savedIds.has(selected.id) ? 'bg-red-500 shadow-lg shadow-red-500/50' : 'bg-black/30 hover:bg-black/50'}`}
                >
                  <Heart className={`w-6 h-6 ${savedIds.has(selected.id) ? 'fill-current' : ''}`} />
                </button>
              </div>

              <div className="px-5 space-y-5">
                <FadeIn>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge>{selected.category}</Badge>
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Eye className="w-3.5 h-3.5" />{selected.views || 0} {t.views}
                        </span>
                      </div>
                      <h1 className="text-2xl font-bold">{lang === 'he' && selected.title_hebrew ? selected.title_hebrew : selected.title}</h1>
                    </div>
                  </div>
                  <p className="text-4xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent mt-3">
                    {formatPrice(selected.price)}
                  </p>
                </FadeIn>

                {selected.description && (
                  <FadeIn delay={100}>
                    <Card className="p-5">
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <Package className="w-5 h-5 text-blue-400" />{t.desc}
                      </h3>
                      <p className="text-sm text-slate-300 leading-relaxed">{selected.description}</p>
                    </Card>
                  </FadeIn>
                )}

                {selected.seller && (
                  <FadeIn delay={150}>
                    <Card className="p-5">
                      <h3 className="font-semibold mb-4 flex items-center gap-2">
                        <User className="w-5 h-5 text-blue-400" />{t.seller}
                      </h3>
                      <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-2xl font-bold shadow-lg shadow-blue-500/30">
                          {selected.seller.full_name?.charAt(0) || 'S'}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-lg">{selected.seller.full_name || 'Seller'}</span>
                            {selected.seller.is_verified && <Shield className="w-5 h-5 text-blue-400" />}
                          </div>
                          {selected.seller.rating && (
                            <div className="flex items-center gap-1 text-sm text-slate-400 mt-1">
                              <Star className="w-4 h-4 text-yellow-400 fill-current" />
                              <span>{selected.seller.rating}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  </FadeIn>
                )}

                <FadeIn delay={200} className="flex gap-3 pb-6">
                  <Btn primary className="flex-1 py-4" onClick={contactSeller}>
                    <MessageCircle className="w-5 h-5" />{t.contact}
                  </Btn>
                  <Btn onClick={() => toggleSave(selected)} className="px-5">
                    <Heart className={`w-5 h-5 ${savedIds.has(selected.id) ? 'fill-current text-red-400' : ''}`} />
                  </Btn>
                </FadeIn>
              </div>
            </div>
          )}

          {/* SAVED */}
          {view === 'saved' && (
            <div className="space-y-5">
              <FadeIn>
                <h2 className="text-2xl font-bold">{t.saved}</h2>
              </FadeIn>
              
              {!user ? (
                <FadeIn className="text-center py-16">
                  <div className="w-20 h-20 rounded-3xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                    <Heart className="w-10 h-10 text-red-400" />
                  </div>
                  <p className="text-slate-400 mb-5">{t.signInSave}</p>
                  <Btn primary onClick={() => goTab('profile')}>{t.signIn}</Btn>
                </FadeIn>
              ) : savedItems.length === 0 ? (
                <FadeIn className="text-center py-16">
                  <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                    <Heart className="w-10 h-10 text-slate-600" />
                  </div>
                  <p className="text-slate-400 mb-5">{t.noSaved}</p>
                  <Btn primary onClick={() => goTab('browse')}>{t.browse}</Btn>
                </FadeIn>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {savedItems.map((item, i) => <ListingCard key={item.id} item={item} index={i} />)}
                </div>
              )}
            </div>
          )}

          {/* AUTH */}
          {view === 'auth' && (
            <div className="space-y-6 pt-4">
              <FadeIn className="text-center space-y-2">
                <h2 className="text-3xl font-bold">{authMode === 'login' ? t.welcome : t.createAcc}</h2>
                <p className="text-slate-400">{authMode === 'login' ? t.signInAccess : t.join}</p>
              </FadeIn>

              {authError && (
                <FadeIn>
                  <Card className="p-4" gradient="linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))">
                    <p className="text-sm text-red-300">{authError}</p>
                  </Card>
                </FadeIn>
              )}

              <FadeIn delay={100}>
                <button 
                  onClick={signInGoogle} 
                  className="w-full py-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center gap-3 hover:bg-white/10 transition-all active:scale-[0.98]"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  <span className="font-medium">{t.google}</span>
                </button>
              </FadeIn>

              <FadeIn delay={150} className="flex items-center gap-4">
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <span className="text-xs text-slate-500 font-medium">{t.or}</span>
                <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              </FadeIn>

              <FadeIn delay={200}>
                <form onSubmit={signInEmail} className="space-y-4">
                  {authMode === 'signup' && <InputField label={t.name} icon={User} value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} />}
                  <InputField label={t.email} type="email" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} required />
                  <InputField label={t.password} type="password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} required />
                  <Btn primary className="w-full py-4">{authMode === 'login' ? t.signIn : t.signUp}</Btn>
                </form>
              </FadeIn>

              <FadeIn delay={250}>
                <p className="text-center text-sm text-slate-400">
                  {authMode === 'login' ? t.noAcc : t.haveAcc}{' '}
                  <button onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(null); }} className="text-blue-400 font-medium hover:text-blue-300">
                    {authMode === 'login' ? t.signUp : t.signIn}
                  </button>
                </p>
              </FadeIn>
            </div>
          )}

          {/* PROFILE */}
          {view === 'profile' && user && (
            <div className="space-y-5">
              <FadeIn>
                <Card className="p-6">
                  <div className="flex items-center gap-5">
                    <div className="relative">
                      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-3xl font-bold shadow-xl shadow-blue-500/30">
                        {profile?.full_name?.charAt(0) || user.email?.charAt(0) || 'U'}
                      </div>
                      <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-green-500 border-2 border-[#060a14]" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-bold">{profile?.full_name || user.email?.split('@')[0]}</h3>
                      <p className="text-sm text-slate-400">{user.email}</p>
                      {profile?.badge && (
                        <Badge color="blue" className="mt-2">{profile.badge}</Badge>
                      )}
                    </div>
                    <button onClick={signOut} className="p-3 rounded-2xl bg-white/5 hover:bg-white/10 transition-all">
                      <LogOut className="w-5 h-5 text-slate-400" />
                    </button>
                  </div>
                </Card>
              </FadeIn>

              <FadeIn delay={100} className="grid grid-cols-3 gap-3">
                {[
                  { value: myListings.length, label: t.myListings, color: 'blue', icon: ShoppingBag },
                  { value: profile?.total_sales || 0, label: t.sales, color: 'green', icon: TrendingUp },
                  { value: savedItems.length, label: t.saved, color: 'red', icon: Heart }
                ].map((stat, i) => (
                  <Card key={i} className="p-4 text-center">
                    <stat.icon className={`w-5 h-5 text-${stat.color}-400 mx-auto mb-2`} />
                    <p className={`text-2xl font-bold text-${stat.color}-400`}>{stat.value}</p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">{stat.label}</p>
                  </Card>
                ))}
              </FadeIn>
            </div>
          )}

          {/* MY LISTINGS */}
          {view === 'myListings' && (
            <div className="space-y-5">
              <FadeIn className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">{t.myListings}</h2>
                {myListings.length > 0 && <Badge>{myListings.length} active</Badge>}
              </FadeIn>

              {!user ? (
                <FadeIn className="text-center py-16">
                  <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                    <ShoppingBag className="w-10 h-10 text-slate-600" />
                  </div>
                  <p className="text-slate-400 mb-5">{t.signInList}</p>
                  <Btn primary onClick={() => goTab('profile')}>{t.signIn}</Btn>
                </FadeIn>
              ) : myListings.length === 0 ? (
                <FadeIn>
                  <Card className="p-10 text-center">
                    <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                      <ShoppingBag className="w-10 h-10 text-slate-600" />
                    </div>
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
                            <p className="text-xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent mt-1">
                              {formatPrice(item.price)}
                            </p>
                            <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                              <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{item.views || 0}</span>
                              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{timeAgo(item.created_at)}</span>
                            </div>
                          </div>
                        </div>
                      </Card>
                    </FadeIn>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* LISTING FLOW */}
          {view === 'listing' && result && (
            <div className="space-y-5">
              {listingStep === 0 && (
                <>
                  <Back onClick={() => setView('results')} />
                  <FadeIn className="text-center">
                    <h2 className="text-2xl font-bold">{t.condition}</h2>
                  </FadeIn>
                  <div className="space-y-3">
                    {[
                      { id: 'newSealed', icon: Box, color: 'emerald', gradient: 'from-emerald-500 to-green-500' },
                      { id: 'likeNew', icon: Sparkles, color: 'blue', gradient: 'from-blue-500 to-cyan-500' },
                      { id: 'used', icon: Package, color: 'amber', gradient: 'from-amber-500 to-orange-500' },
                      { id: 'poor', icon: AlertTriangle, color: 'red', gradient: 'from-red-500 to-pink-500' }
                    ].map((c, i) => (
                      <FadeIn key={c.id} delay={i * 50}>
                        <button 
                          onClick={() => selectCondition(c.id)} 
                          className={`w-full p-5 rounded-2xl border-2 flex items-center gap-4 transition-all ${condition === c.id ? 'border-blue-500 bg-blue-500/10 scale-[1.02]' : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/5'}`}
                        >
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

              {listingStep === 1 && (
                <>
                  <Back onClick={() => setListingStep(0)} />
                  <FadeIn className="text-center">
                    <h2 className="text-2xl font-bold">{t.more}</h2>
                  </FadeIn>
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
                            {q.opts.map(o => (
                              <button 
                                key={o} 
                                onClick={() => setAnswers({ ...answers, [q.key]: o })} 
                                className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all ${answers[q.key] === o ? 'bg-blue-600 shadow-lg shadow-blue-500/30' : 'bg-white/5 hover:bg-white/10'}`}
                              >
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
                    <Btn primary className="w-full py-4" onClick={() => { setListingData(prev => ({ ...prev, price: calcPrice(result?.marketValue?.mid, 'used', answers) })); setListingStep(2); }}>
                      {t.continue}
                    </Btn>
                  </FadeIn>
                </>
              )}

              {listingStep === 2 && (
                <>
                  <Back onClick={() => setListingStep(condition === 'used' ? 1 : 0)} />
                  <FadeIn className="text-center">
                    <h2 className="text-2xl font-bold">{t.review}</h2>
                  </FadeIn>
                  <FadeIn delay={50}>
                    <InputField label={t.title} value={listingData.title} onChange={(e) => setListingData({ ...listingData, title: e.target.value })} />
                  </FadeIn>
                  <FadeIn delay={100}>
                    <div className="space-y-2">
                      <label className="text-sm text-slate-400 font-medium">{t.desc}</label>
                      <textarea 
                        className="w-full px-4 py-4 rounded-2xl bg-white/5 border border-white/10 h-28 resize-none focus:border-blue-500/50 focus:bg-white/10 transition-all" 
                        value={listingData.desc} 
                        onChange={(e) => setListingData({ ...listingData, desc: e.target.value })} 
                      />
                    </div>
                  </FadeIn>
                  <FadeIn delay={150}>
                    <Card className="p-5" gradient="linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.02))">
                      <span className="text-sm text-slate-400">{t.yourPrice}</span>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-3xl font-bold text-green-400">₪</span>
                        <input 
                          type="number" 
                          className="flex-1 bg-transparent text-3xl font-bold text-green-400 focus:outline-none" 
                          value={listingData.price} 
                          onChange={(e) => setListingData({ ...listingData, price: parseInt(e.target.value) || 0 })} 
                        />
                      </div>
                    </Card>
                  </FadeIn>
                  <FadeIn delay={200}>
                    <InputField label={t.phone} icon={Phone} placeholder="050-000-0000" value={listingData.phone} onChange={(e) => setListingData({ ...listingData, phone: e.target.value })} />
                  </FadeIn>
                  <FadeIn delay={250}>
                    <InputField label={t.location} icon={MapPin} value={listingData.location} onChange={(e) => setListingData({ ...listingData, location: e.target.value })} />
                  </FadeIn>
                  <FadeIn delay={300}>
                    <Btn primary className="w-full py-4" onClick={publishListing} disabled={publishing}>
                      {publishing ? <><Loader2 className="w-5 h-5 animate-spin" />{t.publishing}</> : <><Check className="w-5 h-5" />{t.publish}</>}
                    </Btn>
                  </FadeIn>
                </>
              )}

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
          )}
        </main>

        {/* Bottom Nav */}
        <nav className="fixed bottom-0 left-0 right-0 z-40">
          <div className="absolute inset-0 bg-[#060a14]/90 backdrop-blur-xl border-t border-white/10" />
          <div className="relative max-w-md mx-auto flex">
            {[
              { id: 'home', icon: Home },
              { id: 'browse', icon: Search },
              { id: 'sell', icon: ShoppingBag },
              { id: 'saved', icon: Heart },
              { id: 'profile', icon: User }
            ].map(n => (
              <button 
                key={n.id} 
                onClick={() => goTab(n.id)} 
                className={`flex-1 py-4 flex flex-col items-center gap-1.5 relative transition-all ${tab === n.id ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {tab === n.id && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-gradient-to-r from-blue-500 to-blue-400 rounded-full" />
                )}
                <div className={`relative transition-transform ${tab === n.id ? 'scale-110' : ''}`}>
                  <n.icon className={`w-6 h-6 ${n.id === 'saved' && savedItems.length > 0 && tab !== 'saved' ? 'text-red-400' : ''}`} />
                  {n.id === 'sell' && myListings.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 text-[9px] flex items-center justify-center font-bold">{myListings.length}</span>
                  )}
                  {n.id === 'saved' && savedItems.length > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gradient-to-r from-red-500 to-pink-500 text-[9px] flex items-center justify-center font-bold">{savedItems.length}</span>
                  )}
                </div>
                <span className="text-[10px] font-medium">{t[n.id]}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>

      {/* Global Styles */}
      <style>{`
        @keyframes fadeIn { 
          from { opacity: 0; transform: translateY(12px); } 
          to { opacity: 1; transform: translateY(0); } 
        }
        @keyframes slideUp { 
          from { opacity: 0; transform: translateY(100%); } 
          to { opacity: 1; transform: translateY(0); } 
        }
        @keyframes slideDown { 
          from { opacity: 0; transform: translateY(-20px); } 
          to { opacity: 1; transform: translateY(0); } 
        }
        @keyframes scaleIn { 
          from { opacity: 0; transform: scale(0.9); } 
          to { opacity: 1; transform: scale(1); } 
        }
        @keyframes toastIn { 
          0% { opacity: 0; transform: translate(-50%, -20px) scale(0.9); }
          100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }
        @keyframes heartPop { 
          0%, 100% { transform: scale(1); } 
          25% { transform: scale(1.3); } 
          50% { transform: scale(0.95); } 
          75% { transform: scale(1.15); } 
        }
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes marquee-left {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes marquee-right {
          0% { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.5s ease-out forwards; opacity: 0; }
        .animate-slideUp { animation: slideUp 0.4s ease-out forwards; }
        .animate-slideDown { animation: slideDown 0.3s ease-out forwards; }
        .animate-scaleIn { animation: scaleIn 0.3s ease-out forwards; }
        .animate-toastIn { animation: toastIn 0.3s ease-out forwards; }
        .animate-heartPop { animation: heartPop 0.6s ease-in-out; }
        .animate-shimmer { animation: shimmer 2s infinite; }
        .animate-spin-slow { animation: spin-slow 4s linear infinite; }
        .animate-marquee-left { animation: marquee-left 25s linear infinite; }
        .animate-marquee-right { animation: marquee-right 30s linear infinite; }
        .animate-marquee-left:hover, .animate-marquee-right:hover { animation-play-state: paused; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
