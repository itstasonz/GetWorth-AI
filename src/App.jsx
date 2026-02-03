import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Camera, Upload, X, Sparkles, DollarSign, Package, Smartphone, Watch, ChevronRight, ChevronLeft, Loader2, ImagePlus, Share2, AlertCircle, Shirt, Dumbbell, Scan, User, History, LogOut, Plus, Trash2, Clock, Globe, Home, ShoppingBag, CheckCircle, Circle, Box, Shield, AlertTriangle, Eye, MessageCircle, Phone, Check, MapPin, Search, SlidersHorizontal, Heart, Grid, RefreshCw } from 'lucide-react';
import { supabase, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut, getProfile, getListings, getUserListings, createListing, deleteListing as deleteListingApi, getSavedItems, saveItem, unsaveItem, incrementViews } from './lib/supabase';

const translations = {
  en: { appName: "GetWorth", appTagline: "AI Valuation", aiPowered: "AI-Powered", heroTitle1: "Know Your", heroTitle2: "Item's Value", heroSubtitle: "Snap or upload any item. Get instant AI valuation.", dropImageHere: "Drop image here", orUseButtons: "or use buttons below", scan: "Scan", upload: "Upload", phones: "Phones", watches: "Watches", clothing: "Clothing", furniture: "Furniture", sports: "Sports", all: "All", analyzing: "Analyzing...", marketValue: "Market Value", range: "Range", description: "Description", listThisItem: "List This Item", scanAnother: "Scan Another", welcomeBack: "Welcome back", createAccount: "Create account", signInAccess: "Sign in to access", joinGetWorth: "Join GetWorth", continueWithGoogle: "Continue with Google", or: "or", fullName: "Full Name", email: "Email", password: "Password", signIn: "Sign In", signUp: "Sign Up", noAccount: "No account?", haveAccount: "Have account?", back: "Back", myListings: "My Listings", noListingsYet: "No listings yet", failedToAnalyze: "Failed to analyze.", cameraAccessDenied: "Camera denied.", home: "Home", browse: "Browse", sell: "Sell", favorites: "Saved", profile: "Profile", selectCondition: "Select Condition", newSealed: "New (Sealed)", newSealedDesc: "Unopened", likeNew: "Like New", likeNewDesc: "Barely used", used: "Used", usedDesc: "Normal wear", poorCondition: "Poor", poorConditionDesc: "Damaged", yourPrice: "Your Price", tellUsMore: "Tell Us More", cosmeticDamage: "Scratches?", batteryHealth: "Battery?", functionalIssues: "Issues?", yes: "Yes", no: "No", good: "Good", degraded: "Degraded", poor: "Poor", continueBtn: "Continue", reviewListing: "Review Listing", listingTitle: "Title", listingDescription: "Description", phoneNumber: "Phone", location: "Location", addLocation: "Add location", publishListing: "Publish", publishing: "Publishing...", listingPublished: "Listed!", listingLive: "Your item is live", viewListings: "View Listings", shareNow: "Share", points: "pts", sales: "Sales", newSeller: "New", trustedSeller: "Trusted", topSeller: "Top", eliteSeller: "Elite", searchPlaceholder: "Search...", filters: "Filters", clearAll: "Clear", priceRange: "Price", minPrice: "Min", maxPrice: "Max", results: "results", newest: "Newest", priceLowHigh: "Low-High", priceHighLow: "High-Low", noResults: "No items", contactSeller: "Contact", sellerInfo: "Seller", callSeller: "Call", whatsappSeller: "WhatsApp", today: "today", yesterday: "yesterday", daysAgo: "days ago", savedItems: "Saved Items", noSavedItems: "No saved items", signInRequired: "Sign In Required", signInToSave: "Sign in to save", signInToContact: "Sign in to contact", signInToListItem: "Sign in to list", goToSignIn: "Sign In", cancel: "Cancel", active: "Active", itemSaved: "Saved!", itemUnsaved: "Removed" },
  he: { appName: "GetWorth", appTagline: "הערכת שווי", aiPowered: "בינה מלאכותית", heroTitle1: "גלה את", heroTitle2: "שווי הפריט", heroSubtitle: "צלם או העלה תמונה וקבל הערכת שווי.", dropImageHere: "גרור תמונה", orUseButtons: "או השתמש בכפתורים", scan: "סרוק", upload: "העלה", phones: "טלפונים", watches: "שעונים", clothing: "ביגוד", furniture: "ריהוט", sports: "ספורט", all: "הכל", analyzing: "מנתח...", marketValue: "שווי שוק", range: "טווח", description: "תיאור", listThisItem: "פרסם פריט", scanAnother: "סרוק עוד", welcomeBack: "ברוך שובך", createAccount: "צור חשבון", signInAccess: "התחבר לגישה", joinGetWorth: "הצטרף", continueWithGoogle: "המשך עם Google", or: "או", fullName: "שם מלא", email: "אימייל", password: "סיסמה", signIn: "התחבר", signUp: "הירשם", noAccount: "אין חשבון?", haveAccount: "יש חשבון?", back: "חזור", myListings: "המודעות שלי", noListingsYet: "אין מודעות", failedToAnalyze: "נכשל.", cameraAccessDenied: "נדחתה.", home: "בית", browse: "חיפוש", sell: "מכירה", favorites: "שמורים", profile: "פרופיל", selectCondition: "בחר מצב", newSealed: "חדש", newSealedDesc: "לא נפתח", likeNew: "כמו חדש", likeNewDesc: "כמעט לא בשימוש", used: "משומש", usedDesc: "בלאי רגיל", poorCondition: "גרוע", poorConditionDesc: "נזק", yourPrice: "המחיר שלך", tellUsMore: "ספר עוד", cosmeticDamage: "שריטות?", batteryHealth: "סוללה?", functionalIssues: "בעיות?", yes: "כן", no: "לא", good: "טוב", degraded: "ירוד", poor: "גרוע", continueBtn: "המשך", reviewListing: "סקירה", listingTitle: "כותרת", listingDescription: "תיאור", phoneNumber: "טלפון", location: "מיקום", addLocation: "הוסף מיקום", publishListing: "פרסם", publishing: "מפרסם...", listingPublished: "פורסם!", listingLive: "באוויר", viewListings: "צפה", shareNow: "שתף", points: "נק׳", sales: "מכירות", newSeller: "חדש", trustedSeller: "מהימן", topSeller: "מוביל", eliteSeller: "עילית", searchPlaceholder: "חפש...", filters: "סינון", clearAll: "נקה", priceRange: "מחיר", minPrice: "מינ׳", maxPrice: "מקס׳", results: "תוצאות", newest: "חדש", priceLowHigh: "נמוך-גבוה", priceHighLow: "גבוה-נמוך", noResults: "אין פריטים", contactSeller: "צור קשר", sellerInfo: "מוכר", callSeller: "התקשר", whatsappSeller: "וואטסאפ", today: "היום", yesterday: "אתמול", daysAgo: "ימים", savedItems: "שמורים", noSavedItems: "אין שמורים", signInRequired: "נדרשת התחברות", signInToSave: "התחבר לשמירה", signInToContact: "התחבר לקשר", signInToListItem: "התחבר לפרסום", goToSignIn: "התחבר", cancel: "ביטול", active: "פעיל", itemSaved: "נשמר!", itemUnsaved: "הוסר" }
};

const Toast = ({ message, type, onClose }) => {
  useEffect(() => { const t = setTimeout(onClose, 2500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 animate-slideDown ${type === 'success' ? 'bg-gradient-to-r from-green-500 to-emerald-500' : 'bg-gradient-to-r from-red-500 to-pink-500'}`}>
      {type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
      <span className="text-sm font-semibold">{message}</span>
    </div>
  );
};

const SkeletonCard = () => (
  <div className="rounded-2xl overflow-hidden animate-pulse" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
    <div className="aspect-square bg-white/5" />
    <div className="p-3 space-y-2"><div className="h-4 bg-white/10 rounded w-3/4" /><div className="h-6 bg-white/10 rounded w-1/2" /></div>
  </div>
);

export default function GetWorth() {
  const [lang, setLang] = useState('he');
  const t = translations[lang];
  const isRTL = lang === 'he';
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [currentView, setCurrentView] = useState('home');
  const [uploadedImages, setUploadedImages] = useState([]);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [authView, setAuthView] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState(null);
  const [allListings, setAllListings] = useState([]);
  const [userListings, setUserListings] = useState([]);
  const [savedItems, setSavedItems] = useState([]);
  const [savedItemIds, setSavedItemIds] = useState(new Set());
  const [dataLoading, setDataLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [priceRange, setPriceRange] = useState({ min: '', max: '' });
  const [sortBy, setSortBy] = useState('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedListing, setSelectedListing] = useState(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [listingStep, setListingStep] = useState(0);
  const [selectedCondition, setSelectedCondition] = useState(null);
  const [followUpAnswers, setFollowUpAnswers] = useState({ cosmeticDamage: null, batteryHealth: null, functionalIssues: null });
  const [listingData, setListingData] = useState({ title: '', description: '', price: 0, phone: '', location: '', photos: [] });
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);
  const [signInPromptAction, setSignInPromptAction] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [toast, setToast] = useState(null);
  const [heartAnim, setHeartAnim] = useState(null);

  const showToast = (message, type = 'success') => setToast({ message, type });

  useEffect(() => {
    // Check current session immediately
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) { 
        setUser(session.user); 
        getProfile(session.user.id).then(({ data }) => setProfile(data)); 
        // If on auth screen, redirect to profile
        if (currentView === 'auth') {
          setCurrentView('profile');
        }
      }
      setAuthLoading(false); // Done checking
    });
    
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth event:', event, session?.user?.email);
      if (session?.user) { 
        setUser(session.user); 
        const { data } = await getProfile(session.user.id); 
        setProfile(data);
        // Redirect to profile on sign in
        if (event === 'SIGNED_IN') {
          setCurrentView('profile');
          setActiveTab('profile');
        }
      } else { 
        setUser(null); 
        setProfile(null); 
      }
      setAuthLoading(false);
    });
    
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (user) loadUserData(); else { setUserListings([]); setSavedItems([]); setSavedItemIds(new Set()); } }, [user]);
  useEffect(() => { loadListings(); }, [selectedCategory, priceRange, searchQuery]);

  const loadUserData = async () => {
    if (!user) return;
    setDataLoading(true);
    const [listingsRes, savedRes] = await Promise.all([getUserListings(user.id), getSavedItems(user.id)]);
    if (listingsRes.data) setUserListings(listingsRes.data);
    if (savedRes.data) { setSavedItems(savedRes.data.map(s => s.listing).filter(Boolean)); setSavedItemIds(new Set(savedRes.data.map(s => s.listing_id))); }
    setDataLoading(false);
  };

  const loadListings = async () => {
    setDataLoading(true);
    const { data } = await getListings({ category: selectedCategory !== 'all' ? selectedCategory : null, minPrice: priceRange.min || null, maxPrice: priceRange.max || null, search: searchQuery || null });
    if (data) setAllListings(data);
    setDataLoading(false);
  };

  const conditionDiscounts = { newSealed: 0, likeNew: 0.15, used: 0.30, poorCondition: 0.70 };
  const calculateFinalPrice = (basePrice, condition, answers) => {
    if (!basePrice) return 0;
    let discount = conditionDiscounts[condition] || 0;
    if (condition === 'used') { let pts = 0; if (answers.cosmeticDamage === 'yes') pts += 2; if (answers.batteryHealth === 'poor') pts += 2; if (answers.functionalIssues === 'yes') pts += 3; discount = 0.25 + Math.min(pts, 10) * 0.01; }
    return Math.round(basePrice * (1 - discount));
  };

  const filteredListings = useMemo(() => {
    let results = [...allListings];
    if (sortBy === 'priceLowHigh') results.sort((a, b) => a.price - b.price);
    else if (sortBy === 'priceHighLow') results.sort((a, b) => b.price - a.price);
    return results;
  }, [allListings, sortBy]);

  const categories = [{ id: 'all', label: t.all, icon: Grid }, { id: 'Electronics', label: t.phones, icon: Smartphone }, { id: 'Furniture', label: t.furniture, icon: Box }, { id: 'Watches', label: t.watches, icon: Watch }, { id: 'Clothing', label: t.clothing, icon: Shirt }, { id: 'Sports', label: t.sports, icon: Dumbbell }];

  const analyzeImage = async (imageData) => {
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageData: imageData.split(',')[1], lang }) });
    const data = await response.json();
    if (data.content?.[0]?.text) return JSON.parse(data.content[0].text.replace(/```json\n?|\n?```/g, '').trim());
    throw new Error("Invalid");
  };

  const handleFile = async (file) => {
    if (file?.type.startsWith('image/')) {
      setError(null);
      const reader = new FileReader();
      reader.onload = async (e) => {
        setUploadedImages([e.target.result]);
        setCurrentView('analyzing');
        try { const result = await analyzeImage(e.target.result); setAnalysisResult(result); setCurrentView('results'); }
        catch { setError(t.failedToAnalyze); setCurrentView('home'); }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDrag = useCallback((e) => { e.preventDefault(); setDragActive(e.type === "dragenter" || e.type === "dragover"); }, []);
  const handleDrop = useCallback((e) => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]); }, []);
  const startCamera = async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); setCurrentView('camera'); setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); } }, 100); } catch { setError(t.cameraAccessDenied); } };
  const capturePhoto = () => { if (videoRef.current && canvasRef.current) { const ctx = canvasRef.current.getContext('2d'); canvasRef.current.width = videoRef.current.videoWidth; canvasRef.current.height = videoRef.current.videoHeight; ctx.drawImage(videoRef.current, 0, 0); const imageData = canvasRef.current.toDataURL('image/jpeg'); setUploadedImages([imageData]); videoRef.current.srcObject?.getTracks().forEach(tr => tr.stop()); setCurrentView('analyzing'); analyzeImage(imageData).then(r => { setAnalysisResult(r); setCurrentView('results'); }).catch(() => { setError(t.failedToAnalyze); setCurrentView('home'); }); } };
  const stopCamera = () => { videoRef.current?.srcObject?.getTracks().forEach(tr => tr.stop()); setCurrentView('home'); };
  const resetApp = () => { setUploadedImages([]); setAnalysisResult(null); setCurrentView('home'); setError(null); setSelectedCondition(null); setListingStep(0); setSelectedListing(null); };
  const formatPrice = (p) => p ? `₪${p.toLocaleString()}` : "N/A";
  const getTimeAgo = (date) => { const days = Math.floor((Date.now() - new Date(date).getTime()) / (1000*60*60*24)); if (days === 0) return t.today; if (days === 1) return t.yesterday; return `${days} ${t.daysAgo}`; };

  const handleGoogleSignIn = async () => { setAuthError(null); const { error } = await signInWithGoogle(); if (error) setAuthError(error.message); };
  const handleEmailAuth = async (e) => { e.preventDefault(); setAuthError(null); if (authView === 'login') { const { error } = await signInWithEmail(authForm.email, authForm.password); if (error) setAuthError(error.message); } else { const { error } = await signUpWithEmail(authForm.email, authForm.password, authForm.name); if (error) setAuthError(error.message); else setAuthError('Check email!'); } };
  const handleLogout = async () => { await signOut(); setActiveTab('home'); setCurrentView('home'); showToast('Signed out'); };

  const toggleSaveItem = async (item, e) => {
    if (e) e.stopPropagation();
    if (!user) { setSignInPromptAction('save'); setShowSignInPrompt(true); return; }
    setHeartAnim(item.id); setTimeout(() => setHeartAnim(null), 600);
    if (savedItemIds.has(item.id)) { await unsaveItem(user.id, item.id); setSavedItemIds(prev => { const n = new Set(prev); n.delete(item.id); return n; }); setSavedItems(prev => prev.filter(s => s.id !== item.id)); showToast(t.itemUnsaved); }
    else { await saveItem(user.id, item.id); setSavedItemIds(prev => new Set(prev).add(item.id)); setSavedItems(prev => [...prev, item]); showToast(t.itemSaved); }
  };

  const isItemSaved = (id) => savedItemIds.has(id);
  const startListingFlow = () => { if (!user) { setSignInPromptAction('list'); setShowSignInPrompt(true); return; } setListingData({ title: analysisResult?.name || '', title_hebrew: analysisResult?.nameHebrew || '', description: '', price: analysisResult?.marketValue?.mid || 0, phone: profile?.phone || '', location: profile?.location || '', photos: uploadedImages }); setCurrentView('listing'); };
  const handleConditionSelect = (c) => { setSelectedCondition(c); setListingData(prev => ({ ...prev, price: calculateFinalPrice(analysisResult?.marketValue?.mid, c, followUpAnswers) })); setListingStep(c === 'used' ? 1 : 2); };

  const publishListing = async () => {
    setIsPublishing(true);
    try {
      await createListing({ seller_id: user.id, title: listingData.title, title_hebrew: listingData.title_hebrew, description: listingData.description, category: analysisResult?.category || 'Other', condition: selectedCondition, price: listingData.price, original_price: analysisResult?.marketValue?.mid, images: listingData.photos, location: listingData.location, contact_phone: listingData.phone, condition_details: followUpAnswers });
      await loadUserData(); await loadListings(); setListingStep(3); showToast(t.listingPublished);
    } catch (err) { setError(err.message); }
    setIsPublishing(false);
  };

  const handleDeleteListing = async (id) => { await deleteListingApi(id); await loadUserData(); await loadListings(); showToast('Deleted'); };
  const handleContactSeller = (listing) => { if (!user) { setSignInPromptAction('contact'); setShowSignInPrompt(true); return; } setSelectedListing(listing); setShowContactModal(true); };
  const handleViewListing = async (item) => { setSelectedListing(item); setCurrentView('itemDetail'); if (item.id) await incrementViews(item.id); };
  const handleTabChange = (tab) => { setActiveTab(tab); setSelectedListing(null); if (tab === 'home') setCurrentView('home'); else if (tab === 'browse') setCurrentView('browse'); else if (tab === 'sell') setCurrentView('myListings'); else if (tab === 'favorites') setCurrentView('favorites'); else if (tab === 'profile') setCurrentView(user ? 'profile' : 'auth'); };

  const Card = ({ children, className = '', style = {}, onClick }) => <div className={`rounded-2xl transition-all duration-300 ${onClick ? 'hover:scale-[1.02] hover:shadow-xl hover:shadow-blue-500/10 cursor-pointer active:scale-[0.98]' : ''} ${className}`} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)', ...style }} onClick={onClick}>{children}</div>;
  const Button = ({ children, primary, disabled, className = '', ...props }) => <button className={`px-5 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-50 active:scale-95 ${primary ? 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white shadow-lg shadow-blue-500/25' : 'bg-white/5 hover:bg-white/10 text-white border border-white/10'} ${className}`} disabled={disabled} {...props}>{children}</button>;
  const Input = ({ label, ...props }) => <div className="space-y-1.5">{label && <label className="text-sm text-slate-400 font-medium">{label}</label>}<input className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 transition-all" dir={isRTL ? 'rtl' : 'ltr'} {...props} /></div>;
  const BackButton = ({ onClick }) => <button onClick={onClick} className="flex items-center gap-2 text-slate-400 hover:text-white mb-4 transition-colors">{isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}<span className="text-sm">{t.back}</span></button>;
  const OptionButton = ({ selected, onClick, children, className = '' }) => <button onClick={onClick} className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${selected ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/20' : 'bg-white/5 hover:bg-white/10 border border-white/10'} ${className}`}>{children}</button>;
  const getBadgeIcon = (b) => ({ newSeller: '🌟', trustedSeller: '🏅', topSeller: '🏆', eliteSeller: '💎' }[b] || '🌟');
  const getBadgeLabel = (b) => ({ newSeller: t.newSeller, trustedSeller: t.trustedSeller, topSeller: t.topSeller, eliteSeller: t.eliteSeller }[b] || b);

  const ListingCard = ({ item }) => (
    <Card className="overflow-hidden group" onClick={() => handleViewListing(item)}>
      <div className="relative aspect-square overflow-hidden">
        <img src={item.images?.[0] || item.image} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <button onClick={(e) => toggleSaveItem(item, e)} className={`absolute top-2 ${isRTL ? 'left-2' : 'right-2'} w-9 h-9 rounded-full flex items-center justify-center transition-all ${isItemSaved(item.id) ? 'bg-red-500' : 'bg-black/40 backdrop-blur-sm hover:bg-black/60'} ${heartAnim === item.id ? 'animate-heartBeat' : ''}`}>
          <Heart className={`w-4 h-4 transition-transform ${isItemSaved(item.id) ? 'fill-current scale-110' : ''}`} />
        </button>
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-sm truncate group-hover:text-blue-400 transition-colors">{lang === 'he' && item.title_hebrew ? item.title_hebrew : item.title}</h3>
        <p className="text-xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">{formatPrice(item.price)}</p>
        <div className="flex items-center justify-between mt-1.5 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{item.location || 'Israel'}</span>
          <span>{getTimeAgo(item.created_at)}</span>
        </div>
      </div>
    </Card>
  );

  if (authLoading) return <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0f1a' }}><Loader2 className="w-8 h-8 text-blue-400 animate-spin" /></div>;

  return (
    <div className="min-h-screen text-white flex flex-col" style={{ fontFamily: isRTL ? "'Heebo', sans-serif" : "'Inter', sans-serif", background: 'linear-gradient(180deg, #0a0f1a 0%, #0f1629 50%, #0a0f1a 100%)' }} dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="fixed inset-0 pointer-events-none"><div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.12), transparent)' }} /><div className="absolute top-1/3 -left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" /><div className="absolute bottom-1/3 -right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" /></div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className="relative flex-1 max-w-md mx-auto w-full flex flex-col pb-20">
        <header className="px-5 pt-12 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => { resetApp(); setActiveTab('home'); }}>
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/30"><DollarSign className="w-5 h-5" /></div>
            <div><h1 className="text-lg font-bold">{t.appName}</h1><p className="text-[9px] text-slate-500 uppercase tracking-wider">{t.appTagline}</p></div>
          </div>
          <button onClick={() => setLang(lang === 'en' ? 'he' : 'en')} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs transition-all"><Globe className="w-3.5 h-3.5 text-blue-400" />{lang === 'en' ? 'עב' : 'EN'}</button>
        </header>

        {error && <div className="mx-5 mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 animate-slideDown"><AlertCircle className="w-4 h-4 text-red-400" /><p className="text-sm text-red-300 flex-1">{error}</p><button onClick={() => setError(null)}><X className="w-4 h-4 text-red-400" /></button></div>}

        {showSignInPrompt && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-5 animate-fadeIn"><Card className="p-6 max-w-sm w-full text-center space-y-4"><div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto"><User className="w-8 h-8 text-blue-400" /></div><h3 className="text-xl font-bold">{t.signInRequired}</h3><p className="text-slate-400 text-sm">{signInPromptAction === 'save' ? t.signInToSave : signInPromptAction === 'contact' ? t.signInToContact : t.signInToListItem}</p><div className="flex gap-3"><Button className="flex-1" onClick={() => { setShowSignInPrompt(false); setSignInPromptAction(null); }}>{t.cancel}</Button><Button primary className="flex-1" onClick={() => { setShowSignInPrompt(false); setActiveTab('profile'); setCurrentView('auth'); }}>{t.goToSignIn}</Button></div></Card></div>}

        {showContactModal && selectedListing && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm animate-fadeIn"><div className="w-full max-w-md bg-gradient-to-b from-[#1a1f3a] to-[#0f1629] rounded-t-3xl p-5 space-y-4 animate-slideUp"><div className="w-12 h-1 bg-white/20 rounded-full mx-auto" /><h3 className="text-xl font-bold text-center">{t.contactSeller}</h3><div className="flex items-center gap-4 p-4 rounded-2xl bg-white/5"><div className="w-14 h-14 rounded-full bg-blue-500/20 flex items-center justify-center text-xl font-bold">{selectedListing.seller?.full_name?.charAt(0) || 'S'}</div><div className="flex-1"><span className="font-semibold">{selectedListing.seller?.full_name || 'Seller'}</span><div className="text-sm text-slate-400">{getBadgeIcon(selectedListing.seller?.badge)} {getBadgeLabel(selectedListing.seller?.badge)}</div></div></div><div className="grid grid-cols-2 gap-3"><a href={`tel:${selectedListing.contact_phone}`} className="flex items-center justify-center gap-2 py-4 rounded-xl bg-gradient-to-r from-green-600 to-green-500 font-semibold shadow-lg shadow-green-500/25 active:scale-95 transition-transform"><Phone className="w-5 h-5" />{t.callSeller}</a><a href={`https://wa.me/972${(selectedListing.contact_phone || '').replace(/^0/, '').replace(/-/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 py-4 rounded-xl bg-gradient-to-r from-[#25D366] to-[#128C7E] font-semibold shadow-lg active:scale-95 transition-transform"><MessageCircle className="w-5 h-5" />{t.whatsappSeller}</a></div><Button className="w-full" onClick={() => setShowContactModal(false)}>{t.cancel}</Button></div></div>}

        <main className="flex-1 px-5 pb-4 overflow-y-auto">
          {currentView === 'home' && <div className="space-y-6 animate-fadeIn"><div className="text-center space-y-4 pt-6"><div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20"><Sparkles className="w-4 h-4 text-blue-400" /><span className="text-xs font-semibold text-blue-300">{t.aiPowered}</span></div><h2 className="text-4xl font-bold leading-tight">{t.heroTitle1}<br/><span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">{t.heroTitle2}</span></h2><p className="text-slate-400 text-sm">{t.heroSubtitle}</p></div><div className={`rounded-2xl transition-all ${dragActive ? 'scale-[1.02] border-blue-500/50 bg-blue-500/10' : 'border-white/10'}`} style={{ border: '2px dashed' }} onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}><input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} className="hidden" /><div className="p-10 text-center space-y-4"><div className="w-16 h-16 mx-auto rounded-2xl bg-white/5 flex items-center justify-center border border-white/10"><ImagePlus className="w-7 h-7 text-slate-400" /></div><div><p className="text-slate-200 font-medium">{t.dropImageHere}</p><p className="text-slate-500 text-xs mt-1">{t.orUseButtons}</p></div></div></div><div className="grid grid-cols-2 gap-3"><button onClick={startCamera} className="py-4 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 flex items-center justify-center gap-2 font-semibold shadow-lg shadow-blue-500/25 active:scale-95 transition-all"><Scan className="w-5 h-5" />{t.scan}</button><button onClick={() => fileInputRef.current?.click()} className="py-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center gap-2 font-semibold active:scale-95 transition-all"><Upload className="w-5 h-5" />{t.upload}</button></div></div>}

          {currentView === 'camera' && <div className="fixed inset-0 z-50 bg-black"><video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" /><canvas ref={canvasRef} className="hidden" /><div className="absolute inset-0 pointer-events-none"><div className="absolute inset-12 rounded-3xl border-2 border-white/30" /></div><div className="absolute bottom-0 inset-x-0 p-8 flex justify-center gap-6 bg-gradient-to-t from-black"><button onClick={stopCamera} className="w-14 h-14 rounded-full bg-white/10 backdrop-blur flex items-center justify-center"><X className="w-6 h-6" /></button><button onClick={capturePhoto} className="w-20 h-20 rounded-full bg-gradient-to-r from-blue-600 to-blue-500 flex items-center justify-center shadow-xl shadow-blue-500/50 active:scale-95"><div className="w-16 h-16 rounded-full border-4 border-white/30" /></button><div className="w-14" /></div></div>}

          {currentView === 'analyzing' && <div className="flex-1 flex flex-col items-center justify-center py-16 animate-fadeIn"><div className="relative"><div className="absolute -inset-6 rounded-3xl bg-blue-500/20 blur-2xl animate-pulse" /><div className="relative w-44 h-44 rounded-2xl overflow-hidden border-2 border-blue-500/50 shadow-2xl shadow-blue-500/20">{uploadedImages[0] && <img src={uploadedImages[0]} alt="" className="w-full h-full object-cover" />}</div></div><div className="mt-8 text-center space-y-3"><div className="flex items-center justify-center gap-3"><Loader2 className="w-6 h-6 text-blue-400 animate-spin" /><span className="font-semibold text-lg">{t.analyzing}</span></div><div className="flex justify-center gap-1">{[0,1,2].map(i => <div key={i} className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />)}</div></div></div>}

          {currentView === 'results' && analysisResult && <div className="space-y-4 animate-fadeIn pb-4"><div className="relative"><div className="aspect-[4/3] rounded-2xl overflow-hidden shadow-2xl"><img src={uploadedImages[0]} alt="" className="w-full h-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-[#0a0f1a] via-transparent" /></div><div className="absolute bottom-3 inset-x-3"><span className="inline-block px-2 py-1 rounded-lg bg-white/10 backdrop-blur-sm text-xs mb-2">{analysisResult.category}</span><h2 className="text-xl font-bold">{lang === 'he' && analysisResult.nameHebrew ? analysisResult.nameHebrew : analysisResult.name}</h2></div></div><Card className="p-5" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.1))', border: '1px solid rgba(59,130,246,0.3)' }}><div className="text-center"><p className="text-sm text-blue-300 mb-1">{t.marketValue}</p><p className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">{formatPrice(analysisResult.marketValue?.mid)}</p>{analysisResult.marketValue?.low > 0 && <p className="text-xs text-slate-400 mt-2">{t.range}: {formatPrice(analysisResult.marketValue.low)} – {formatPrice(analysisResult.marketValue.high)}</p>}</div></Card><div className="flex gap-3"><Button primary className="flex-1 py-4" onClick={startListingFlow}><Plus className="w-5 h-5" />{t.listThisItem}</Button><Button className="px-4"><Share2 className="w-5 h-5" /></Button></div><button onClick={resetApp} className="w-full py-3 text-slate-400 text-sm flex items-center justify-center gap-2 hover:text-white transition-colors"><RefreshCw className="w-4 h-4" />{t.scanAnother}</button></div>}

          {currentView === 'browse' && !selectedListing && <div className="space-y-4 animate-fadeIn"><div className="relative"><Search className={`absolute top-1/2 -translate-y-1/2 ${isRTL ? 'right-4' : 'left-4'} w-5 h-5 text-slate-500`} /><input type="text" placeholder={t.searchPlaceholder} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className={`w-full py-3.5 ${isRTL ? 'pr-12 pl-12' : 'pl-12 pr-12'} rounded-xl bg-white/5 border border-white/10 text-white focus:border-blue-500/50 transition-all`} dir={isRTL ? 'rtl' : 'ltr'} /><button onClick={() => setShowFilters(!showFilters)} className={`absolute top-1/2 -translate-y-1/2 ${isRTL ? 'left-3' : 'right-3'} p-2 rounded-lg transition-all ${showFilters ? 'bg-blue-600' : 'bg-white/10 hover:bg-white/20'}`}><SlidersHorizontal className="w-4 h-4" /></button></div><div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide">{categories.map((cat) => <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} className={`flex-shrink-0 px-4 py-2.5 rounded-xl flex items-center gap-2 text-xs font-semibold transition-all ${selectedCategory === cat.id ? 'bg-gradient-to-r from-blue-600 to-blue-500 shadow-lg shadow-blue-500/20' : 'bg-white/5 hover:bg-white/10 border border-white/10'}`}><cat.icon className="w-4 h-4" />{cat.label}</button>)}</div>{showFilters && <Card className="p-4 space-y-4 animate-slideDown"><div className="flex items-center justify-between"><h3 className="font-semibold">{t.filters}</h3><button onClick={() => { setPriceRange({ min: '', max: '' }); setSortBy('newest'); }} className="text-xs text-blue-400">{t.clearAll}</button></div><div className="flex gap-3 items-center"><input type="number" placeholder={t.minPrice} value={priceRange.min} onChange={(e) => setPriceRange({ ...priceRange, min: e.target.value })} className="flex-1 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm" /><span className="text-slate-500">—</span><input type="number" placeholder={t.maxPrice} value={priceRange.max} onChange={(e) => setPriceRange({ ...priceRange, max: e.target.value })} className="flex-1 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm" /></div><div className="grid grid-cols-3 gap-2">{[{ id: 'newest', label: t.newest }, { id: 'priceLowHigh', label: t.priceLowHigh }, { id: 'priceHighLow', label: t.priceHighLow }].map((opt) => <button key={opt.id} onClick={() => setSortBy(opt.id)} className={`py-2.5 px-3 rounded-xl text-xs font-semibold transition-all ${sortBy === opt.id ? 'bg-gradient-to-r from-blue-600 to-blue-500' : 'bg-white/5 hover:bg-white/10'}`}>{opt.label}</button>)}</div></Card>}<p className="text-sm text-slate-400">{filteredListings.length} {t.results}</p>{dataLoading ? <div className="grid grid-cols-2 gap-3">{[1,2,3,4].map(i => <SkeletonCard key={i} />)}</div> : filteredListings.length === 0 ? <div className="text-center py-16"><div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4"><Search className="w-8 h-8 text-slate-600" /></div><p className="text-slate-400">{t.noResults}</p></div> : <div className="grid grid-cols-2 gap-3">{filteredListings.map((item) => <ListingCard key={item.id} item={item} />)}</div>}</div>}

          {currentView === 'itemDetail' && selectedListing && <div className="space-y-4 animate-fadeIn -mx-5 -mt-4"><div className="relative aspect-square"><img src={selectedListing.images?.[0]} alt="" className="w-full h-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-[#0a0f1a] via-transparent" /><button onClick={() => { setSelectedListing(null); setCurrentView('browse'); }} className={`absolute top-4 ${isRTL ? 'right-4' : 'left-4'} w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center`}>{isRTL ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}</button><button onClick={(e) => toggleSaveItem(selectedListing, e)} className={`absolute top-4 ${isRTL ? 'left-4' : 'right-4'} w-10 h-10 rounded-full flex items-center justify-center ${isItemSaved(selectedListing.id) ? 'bg-red-500' : 'bg-black/40 backdrop-blur-sm'}`}><Heart className={`w-5 h-5 ${isItemSaved(selectedListing.id) ? 'fill-current' : ''}`} /></button></div><div className="px-5 space-y-4"><div><div className="flex items-center gap-2 mb-2"><span className="px-2 py-1 rounded-lg bg-white/10 text-xs">{selectedListing.category}</span><span className="text-xs text-slate-500 flex items-center gap-1"><Eye className="w-3 h-3" />{selectedListing.views || 0}</span></div><h1 className="text-2xl font-bold">{lang === 'he' && selectedListing.title_hebrew ? selectedListing.title_hebrew : selectedListing.title}</h1><p className="text-4xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent mt-2">{formatPrice(selectedListing.price)}</p></div>{selectedListing.description && <Card className="p-4"><h3 className="font-semibold mb-2 flex items-center gap-2"><Package className="w-4 h-4 text-blue-400" />{t.description}</h3><p className="text-sm text-slate-300">{selectedListing.description}</p></Card>}{selectedListing.seller && <Card className="p-4"><h3 className="font-semibold mb-3 flex items-center gap-2"><User className="w-4 h-4 text-blue-400" />{t.sellerInfo}</h3><div className="flex items-center gap-4"><div className="w-14 h-14 rounded-full bg-blue-500/20 flex items-center justify-center text-xl font-bold">{selectedListing.seller.full_name?.charAt(0) || 'S'}</div><div className="flex-1"><div className="flex items-center gap-2"><span className="font-semibold">{selectedListing.seller.full_name || 'Seller'}</span>{selectedListing.seller.is_verified && <Shield className="w-4 h-4 text-blue-400" />}</div><div className="text-sm text-slate-400">{getBadgeIcon(selectedListing.seller.badge)} {getBadgeLabel(selectedListing.seller.badge)}</div></div></div></Card>}<div className="flex gap-3 pt-2 pb-6"><Button primary className="flex-1 py-4" onClick={() => handleContactSeller(selectedListing)}><MessageCircle className="w-5 h-5" />{t.contactSeller}</Button><Button onClick={(e) => toggleSaveItem(selectedListing, e)} className="px-4"><Heart className={`w-5 h-5 ${isItemSaved(selectedListing.id) ? 'fill-current text-red-400' : ''}`} /></Button></div></div></div>}

          {currentView === 'favorites' && <div className="space-y-4 animate-fadeIn"><h2 className="text-xl font-bold">{t.savedItems}</h2>{!user ? <div className="text-center py-16"><div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4"><Heart className="w-8 h-8 text-red-400" /></div><p className="text-slate-400 mb-4">{t.signInToSave}</p><Button primary onClick={() => { setActiveTab('profile'); setCurrentView('auth'); }}>{t.goToSignIn}</Button></div> : savedItems.length === 0 ? <div className="text-center py-16"><div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4"><Heart className="w-8 h-8 text-slate-600" /></div><p className="text-slate-400 mb-4">{t.noSavedItems}</p><Button primary onClick={() => handleTabChange('browse')}><Search className="w-4 h-4" />{t.browse}</Button></div> : <div className="grid grid-cols-2 gap-3">{savedItems.map((item) => <ListingCard key={item.id} item={item} />)}</div>}</div>}

          {currentView === 'auth' && <div className="space-y-6 animate-fadeIn pt-6"><div className="text-center space-y-2"><h2 className="text-2xl font-bold">{authView === 'login' ? t.welcomeBack : t.createAccount}</h2><p className="text-slate-400 text-sm">{authView === 'login' ? t.signInAccess : t.joinGetWorth}</p></div>{authError && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-300">{authError}</div>}<button onClick={handleGoogleSignIn} className="w-full py-4 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center gap-3 hover:bg-white/10 transition-all active:scale-[0.98]"><svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg><span className="font-medium">{t.continueWithGoogle}</span></button><div className="flex items-center gap-4"><div className="flex-1 h-px bg-white/10" /><span className="text-xs text-slate-500">{t.or}</span><div className="flex-1 h-px bg-white/10" /></div><form onSubmit={handleEmailAuth} className="space-y-4">{authView === 'signup' && <Input label={t.fullName} value={authForm.name} onChange={(e) => setAuthForm({...authForm, name: e.target.value})} required />}<Input label={t.email} type="email" placeholder="email@example.com" value={authForm.email} onChange={(e) => setAuthForm({...authForm, email: e.target.value})} required /><Input label={t.password} type="password" placeholder="••••••••" value={authForm.password} onChange={(e) => setAuthForm({...authForm, password: e.target.value})} required /><Button primary className="w-full py-4">{authView === 'login' ? t.signIn : t.signUp}</Button></form><p className="text-center text-sm text-slate-400">{authView === 'login' ? t.noAccount : t.haveAccount}{' '}<button onClick={() => { setAuthView(authView === 'login' ? 'signup' : 'login'); setAuthError(null); }} className="text-blue-400 font-medium">{authView === 'login' ? t.signUp : t.signIn}</button></p></div>}

          {currentView === 'profile' && user && <div className="space-y-5 animate-fadeIn"><Card className="p-5"><div className="flex items-center gap-4"><div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-2xl font-bold shadow-lg shadow-blue-500/30">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="w-full h-full rounded-2xl object-cover" /> : (profile?.full_name?.charAt(0) || user.email?.charAt(0) || 'U').toUpperCase()}</div><div className="flex-1"><h3 className="font-bold text-lg">{profile?.full_name || user.email?.split('@')[0]}</h3><p className="text-xs text-slate-400">{user.email}</p><div className="flex items-center gap-1 mt-1"><span>{getBadgeIcon(profile?.badge)}</span><span className="text-xs text-blue-400 font-medium">{getBadgeLabel(profile?.badge)}</span></div></div><button onClick={handleLogout} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all"><LogOut className="w-5 h-5 text-slate-400" /></button></div></Card><div className="grid grid-cols-3 gap-3">{[{ value: userListings.length, label: t.myListings, color: 'blue' }, { value: profile?.total_sales || 0, label: t.sales, color: 'green' }, { value: savedItems.length, label: t.favorites, color: 'red' }].map((stat, i) => <Card key={i} className="p-4 text-center"><p className={`text-2xl font-bold bg-gradient-to-r from-${stat.color}-400 to-${stat.color}-500 bg-clip-text text-transparent`}>{stat.value}</p><p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">{stat.label}</p></Card>)}</div></div>}

          {currentView === 'myListings' && <div className="space-y-4 animate-fadeIn"><div className="flex items-center justify-between"><h2 className="text-xl font-bold">{t.myListings}</h2>{userListings.length > 0 && <span className="text-xs text-slate-400 px-2 py-1 rounded-lg bg-white/5">{userListings.length} {t.active}</span>}</div>{!user ? <div className="text-center py-16"><div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4"><ShoppingBag className="w-8 h-8 text-slate-600" /></div><p className="text-slate-400 mb-4">{t.signInToListItem}</p><Button primary onClick={() => { setActiveTab('profile'); setCurrentView('auth'); }}>{t.goToSignIn}</Button></div> : userListings.length === 0 ? <Card className="p-10 text-center"><div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4"><ShoppingBag className="w-8 h-8 text-slate-600" /></div><p className="text-slate-400 mb-4">{t.noListingsYet}</p><Button primary onClick={() => { setActiveTab('home'); setCurrentView('home'); }}><Scan className="w-4 h-4" />{t.scan}</Button></Card> : <div className="space-y-3">{userListings.map((item) => <Card key={item.id} className="p-3 group"><div className="flex gap-4"><div className="w-24 h-24 rounded-xl overflow-hidden flex-shrink-0"><img src={item.images?.[0]} alt="" className="w-full h-full object-cover" /></div><div className="flex-1 min-w-0"><div className="flex justify-between"><h3 className="font-semibold truncate">{item.title}</h3><button onClick={() => handleDeleteListing(item.id)} className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all"><Trash2 className="w-4 h-4 text-red-400" /></button></div><p className="text-xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">{formatPrice(item.price)}</p><div className="flex items-center gap-4 mt-2 text-xs text-slate-500"><span className="flex items-center gap-1"><Eye className="w-3 h-3" />{item.views || 0}</span><span>{getTimeAgo(item.created_at)}</span></div></div></div></Card>)}</div>}</div>}

          {currentView === 'listing' && analysisResult && <div className="space-y-4 animate-fadeIn">{listingStep === 0 && <><BackButton onClick={() => setCurrentView('results')} /><div className="text-center mb-6"><h2 className="text-xl font-bold">{t.selectCondition}</h2></div><div className="space-y-3">{[{ id: 'newSealed', label: t.newSealed, desc: t.newSealedDesc, discount: 0, icon: Box, gradient: 'from-emerald-500 to-green-500' }, { id: 'likeNew', label: t.likeNew, desc: t.likeNewDesc, discount: 15, icon: Sparkles, gradient: 'from-blue-500 to-cyan-500' }, { id: 'used', label: t.used, desc: t.usedDesc, discount: '25-35', icon: Package, gradient: 'from-amber-500 to-orange-500' }, { id: 'poorCondition', label: t.poorCondition, desc: t.poorConditionDesc, discount: 70, icon: AlertTriangle, gradient: 'from-red-500 to-pink-500' }].map((c) => <button key={c.id} onClick={() => handleConditionSelect(c.id)} className={`w-full p-4 rounded-2xl border-2 transition-all ${selectedCondition === c.id ? 'border-blue-500 bg-blue-500/10 scale-[1.02]' : 'border-white/10 bg-white/5 hover:border-white/20'}`}><div className="flex items-center gap-4"><div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br ${c.gradient} shadow-lg`}><c.icon className="w-6 h-6" /></div><div className="flex-1 text-left"><div className="flex items-center justify-between"><span className="font-semibold">{c.label}</span><span className={`text-xs font-bold ${c.discount === 0 ? 'text-green-400' : 'text-orange-400'}`}>{c.discount === 0 ? '100%' : `-${c.discount}%`}</span></div><p className="text-xs text-slate-400 mt-0.5">{c.desc}</p></div>{selectedCondition === c.id ? <CheckCircle className="w-6 h-6 text-blue-400" /> : <Circle className="w-6 h-6 text-slate-600" />}</div></button>)}</div></>}{listingStep === 1 && <><BackButton onClick={() => setListingStep(0)} /><div className="text-center mb-6"><h2 className="text-xl font-bold">{t.tellUsMore}</h2></div><div className="space-y-3">{[{ key: 'cosmeticDamage', label: t.cosmeticDamage, options: ['yes', 'no'] }, { key: 'batteryHealth', label: t.batteryHealth, options: ['good', 'degraded', 'poor'] }, { key: 'functionalIssues', label: t.functionalIssues, options: ['yes', 'no'] }].map((q) => <Card key={q.key} className="p-4"><p className="text-sm font-medium mb-3">{q.label}</p><div className="flex gap-2">{q.options.map(o => <OptionButton key={o} selected={followUpAnswers[q.key] === o} onClick={() => setFollowUpAnswers({ ...followUpAnswers, [q.key]: o })} className="flex-1">{t[o]}</OptionButton>)}</div></Card>)}</div><Card className="p-4 text-center" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(16,185,129,0.1))', border: '1px solid rgba(34,197,94,0.3)' }}><p className="text-xs text-green-300 mb-1">{t.yourPrice}</p><p className="text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">{formatPrice(calculateFinalPrice(analysisResult?.marketValue?.mid, 'used', followUpAnswers))}</p></Card><Button primary className="w-full py-4" onClick={() => { setListingData(prev => ({ ...prev, price: calculateFinalPrice(analysisResult?.marketValue?.mid, 'used', followUpAnswers) })); setListingStep(2); }}>{t.continueBtn}</Button></>}{listingStep === 2 && <><BackButton onClick={() => setListingStep(selectedCondition === 'used' ? 1 : 0)} /><div className="text-center mb-6"><h2 className="text-xl font-bold">{t.reviewListing}</h2></div><Input label={t.listingTitle} value={listingData.title} onChange={(e) => setListingData({ ...listingData, title: e.target.value })} /><div className="space-y-1.5"><label className="text-sm text-slate-400 font-medium">{t.listingDescription}</label><textarea className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white h-24 resize-none focus:border-blue-500/50 transition-all" value={listingData.description} onChange={(e) => setListingData({ ...listingData, description: e.target.value })} /></div><Card className="p-4" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.1), rgba(16,185,129,0.05))', border: '1px solid rgba(34,197,94,0.2)' }}><span className="text-sm text-slate-400">{t.yourPrice}</span><div className="flex items-center gap-3 mt-1"><span className="text-2xl font-bold text-green-400">₪</span><input type="number" className="flex-1 bg-transparent text-3xl font-bold focus:outline-none text-green-400" value={listingData.price} onChange={(e) => setListingData({ ...listingData, price: parseInt(e.target.value) || 0 })} /></div></Card><Input label={t.phoneNumber} placeholder="050-000-0000" value={listingData.phone} onChange={(e) => setListingData({ ...listingData, phone: e.target.value })} /><Input label={t.location} placeholder={t.addLocation} value={listingData.location} onChange={(e) => setListingData({ ...listingData, location: e.target.value })} /><Button primary className="w-full py-4" onClick={publishListing} disabled={isPublishing}>{isPublishing ? <><Loader2 className="w-5 h-5 animate-spin" />{t.publishing}</> : <><Check className="w-5 h-5" />{t.publishListing}</>}</Button></>}{listingStep === 3 && <div className="text-center py-10 space-y-6"><div className="relative w-24 h-24 mx-auto"><div className="absolute inset-0 bg-green-500/20 rounded-full animate-ping" /><div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center shadow-xl shadow-green-500/30"><CheckCircle className="w-12 h-12" /></div></div><div><h2 className="text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">{t.listingPublished}</h2><p className="text-slate-400 mt-2">{t.listingLive}</p></div><div className="flex gap-3 pt-4"><Button className="flex-1" onClick={() => { setActiveTab('sell'); setCurrentView('myListings'); resetApp(); }}><Eye className="w-4 h-4" />{t.viewListings}</Button><Button primary className="flex-1"><Share2 className="w-4 h-4" />{t.shareNow}</Button></div></div>}</div>}
        </main>

        <nav className="fixed bottom-0 left-0 right-0 bg-[#0a0f1a]/90 backdrop-blur-xl border-t border-white/10 z-40"><div className="max-w-md mx-auto flex">{[{ id: 'home', icon: Home, label: t.home }, { id: 'browse', icon: Search, label: t.browse }, { id: 'sell', icon: ShoppingBag, label: t.sell }, { id: 'favorites', icon: Heart, label: t.favorites }, { id: 'profile', icon: User, label: t.profile }].map((tab) => <button key={tab.id} onClick={() => handleTabChange(tab.id)} className={`flex-1 py-3 flex flex-col items-center gap-1 relative transition-all ${activeTab === tab.id ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}>{activeTab === tab.id && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-1 bg-gradient-to-r from-blue-500 to-blue-400 rounded-full" />}<tab.icon className={`w-5 h-5 transition-transform ${activeTab === tab.id ? 'scale-110' : ''} ${tab.id === 'favorites' && savedItems.length > 0 && activeTab !== 'favorites' ? 'text-red-400' : ''}`} /><span className="text-[10px] font-medium">{tab.label}</span>{tab.id === 'sell' && userListings.length > 0 && <span className="absolute top-1 right-1/4 w-4 h-4 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 text-[9px] flex items-center justify-center font-bold">{userListings.length}</span>}{tab.id === 'favorites' && savedItems.length > 0 && <span className="absolute top-1 right-1/4 w-4 h-4 rounded-full bg-gradient-to-r from-red-500 to-pink-500 text-[9px] flex items-center justify-center font-bold">{savedItems.length}</span>}</button>)}</div></nav>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideDown { from { opacity: 0; transform: translate(-50%, -20px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(100%); } to { opacity: 1; transform: translateY(0); } }
        @keyframes heartBeat { 0%, 100% { transform: scale(1); } 25% { transform: scale(1.3); } 50% { transform: scale(0.9); } 75% { transform: scale(1.2); } }
        .animate-fadeIn { animation: fadeIn 0.4s ease-out; }
        .animate-slideDown { animation: slideDown 0.3s ease-out; }
        .animate-slideUp { animation: slideUp 0.3s ease-out; }
        .animate-heartBeat { animation: heartBeat 0.6s ease-in-out; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
