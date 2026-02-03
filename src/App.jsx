import React, { useState, useRef, useCallback } from 'react';
import { Camera, Upload, X, Sparkles, DollarSign, TrendingUp, Package, Car, Smartphone, Watch, Laptop, ChevronRight, ChevronLeft, Loader2, ImagePlus, RotateCcw, Share2, AlertCircle, Utensils, Shirt, Dumbbell, Scan, User, History, LogOut, Plus, Trash2, Clock, Tag, Globe } from 'lucide-react';

const translations = {
  en: {
    appName: "GetWorth", appTagline: "AI Valuation", aiPowered: "AI-Powered", heroTitle1: "Know Your", heroTitle2: "Item's Value",
    heroSubtitle: "Snap or upload any item. Get instant AI valuation for the Israeli market.",
    dropImageHere: "Drop image here", orUseButtons: "or use the buttons below", scan: "Scan", upload: "Upload",
    categories: "Categories", phones: "Phones", laptops: "Laptops", vehicles: "Vehicles", watches: "Watches", clothing: "Clothing", other: "Other",
    recentSearches: "Recent Searches", positionItem: "Position item in frame", analyzing: "Analyzing...",
    identifyingItem: "Identifying item", searchingMarkets: "Searching Israeli markets", calculatingValue: "Calculating value",
    match: "Match", notSellable: "Not Sellable", marketValue: "Market Value", estValue: "Est. Value", range: "Range",
    details: "Details", description: "Description", brand: "Brand", condition: "Condition", demand: "Demand",
    valueFactors: "Value Factors", sellingTip: "Selling Tip", whereToBuySell: "Where to Buy/Sell",
    israeliMarketNotes: "Israeli Market Notes", addToListings: "Add to Listings", signInToList: "Sign in to List",
    scanAnother: "Scan Another", save: "Save", share: "Share", welcomeBack: "Welcome back", createAccount: "Create account",
    signInAccess: "Sign in to access your listings", joinGetWorth: "Join GetWorth to list your items",
    continueWithGoogle: "Continue with Google", continueWithApple: "Continue with Apple", or: "or",
    fullName: "Full Name", email: "Email", password: "Password", signIn: "Sign In", signUp: "Sign Up",
    noAccount: "Don't have an account?", haveAccount: "Already have an account?", back: "Back",
    myListings: "My Listings", searches: "Searches", noListingsYet: "No listings yet",
    scanItemsAdd: "Scan items and add them to your listings", searchHistory: "Search History",
    noSearchHistory: "No search history", scannedItemsAppear: "Your scanned items will appear here",
    reasonForSelling: "Reason for selling", addToListingsTitle: "Add to Listings", provideDetails: "Provide details about your item",
    descriptionLabel: "Description", describeItem: "Describe your item...", conditionLabel: "Condition", qualityLabel: "Quality",
    reasonLabel: "Reason for Selling", whySelling: "Why are you selling this item?", addToMyListings: "Add to My Listings",
    new: "New", likeNew: "Like New", excellent: "Excellent", good: "Good", fair: "Fair", poor: "Poor",
    qualityExcellent: "Excellent", qualityGood: "Good", qualityAverage: "Average", qualityBelowAverage: "Below Average",
    failedToAnalyze: "Failed to analyze. Please try again.",
    cameraAccessDenied: "Camera access denied. Please allow camera access in your browser settings.",
    noCameraFound: "No camera found on this device.", cameraInUse: "Camera is already in use.",
    couldNotAccessCamera: "Could not access camera. Try uploading an image instead.",
  },
  he: {
    appName: "GetWorth", appTagline: "הערכת שווי חכמה", aiPowered: "מונע בינה מלאכותית", heroTitle1: "גלה את", heroTitle2: "שווי הפריט שלך",
    heroSubtitle: "צלם או העלה תמונה של כל פריט וקבל הערכת שווי מיידית לשוק הישראלי.",
    dropImageHere: "גרור תמונה לכאן", orUseButtons: "או השתמש בכפתורים למטה", scan: "סרוק", upload: "העלה",
    categories: "קטגוריות", phones: "טלפונים", laptops: "מחשבים ניידים", vehicles: "רכבים", watches: "שעונים", clothing: "ביגוד", other: "אחר",
    recentSearches: "חיפושים אחרונים", positionItem: "מקם את הפריט במסגרת", analyzing: "מנתח...",
    identifyingItem: "מזהה את הפריט", searchingMarkets: "מחפש בשווקים בישראל", calculatingValue: "מחשב שווי",
    match: "התאמה", notSellable: "לא למכירה", marketValue: "שווי שוק", estValue: "שווי משוער", range: "טווח מחירים",
    details: "פרטים", description: "תיאור", brand: "מותג", condition: "מצב", demand: "ביקוש",
    valueFactors: "גורמים המשפיעים על המחיר", sellingTip: "טיפ למכירה", whereToBuySell: "איפה לקנות או למכור",
    israeliMarketNotes: "מידע על השוק הישראלי", addToListings: "הוסף למודעות שלי", signInToList: "התחבר כדי לפרסם",
    scanAnother: "סרוק פריט נוסף", save: "שמור", share: "שתף", welcomeBack: "ברוך שובך", createAccount: "יצירת חשבון",
    signInAccess: "התחבר כדי לגשת למודעות שלך", joinGetWorth: "הצטרף ל-GetWorth כדי לפרסם פריטים",
    continueWithGoogle: "המשך עם Google", continueWithApple: "המשך עם Apple", or: "או",
    fullName: "שם מלא", email: "דואר אלקטרוני", password: "סיסמה", signIn: "התחבר", signUp: "הירשם",
    noAccount: "אין לך חשבון?", haveAccount: "כבר יש לך חשבון?", back: "חזור",
    myListings: "המודעות שלי", searches: "חיפושים", noListingsYet: "אין מודעות עדיין",
    scanItemsAdd: "סרוק פריטים והוסף אותם למודעות שלך", searchHistory: "היסטוריית חיפושים",
    noSearchHistory: "אין היסטוריית חיפושים", scannedItemsAppear: "פריטים שסרקת יופיעו כאן",
    reasonForSelling: "סיבת המכירה", addToListingsTitle: "הוספה למודעות", provideDetails: "הזן פרטים על הפריט שלך",
    descriptionLabel: "תיאור", describeItem: "תאר את הפריט שלך...", conditionLabel: "מצב הפריט", qualityLabel: "איכות",
    reasonLabel: "סיבת המכירה", whySelling: "מדוע אתה מוכר את הפריט הזה?", addToMyListings: "הוסף למודעות שלי",
    new: "חדש", likeNew: "כמו חדש", excellent: "מצוין", good: "טוב", fair: "סביר", poor: "גרוע",
    qualityExcellent: "מצוינת", qualityGood: "טובה", qualityAverage: "ממוצעת", qualityBelowAverage: "מתחת לממוצע",
    failedToAnalyze: "הניתוח נכשל. אנא נסה שנית.",
    cameraAccessDenied: "הגישה למצלמה נדחתה. אנא אשר גישה למצלמה בהגדרות הדפדפן.",
    noCameraFound: "לא נמצאה מצלמה במכשיר זה.", cameraInUse: "המצלמה בשימוש כרגע.",
    couldNotAccessCamera: "לא ניתן לגשת למצלמה. נסה להעלות תמונה במקום.",
  }
};

export default function GetWorth() {
  const [lang, setLang] = useState('he');
  const t = translations[lang];
  const isRTL = lang === 'he';
  
  const [currentView, setCurrentView] = useState('home');
  const [uploadedImage, setUploadedImage] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [authView, setAuthView] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [userListings, setUserListings] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  const [showListingForm, setShowListingForm] = useState(false);
  const [currentListing, setCurrentListing] = useState(null);
  const [listingForm, setListingForm] = useState({ description: '', condition: 'Good', quality: 'Good', reason: '' });

  const analyzeImage = async (imageData) => {
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: imageData.split(',')[1], lang })
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'API error');
      const data = await response.json();
      if (data.content?.[0]?.text) return JSON.parse(data.content[0].text.replace(/```json\n?|\n?```/g, '').trim());
      throw new Error("Invalid response");
    } catch (err) { console.error(err); throw err; }
  };

  const handleFile = async (file) => {
    if (file?.type.startsWith('image/')) {
      setError(null);
      const reader = new FileReader();
      reader.onload = async (e) => {
        setUploadedImage(e.target.result);
        setCurrentView('analyzing');
        try {
          const result = await analyzeImage(e.target.result);
          setAnalysisResult(result);
          if (isLoggedIn) setSearchHistory(prev => [{ ...result, image: e.target.result, date: new Date() }, ...prev.slice(0, 19)]);
          setCurrentView('results');
        } catch { setError(t.failedToAnalyze); setCurrentView('home'); }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDrag = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setDragActive(e.type === "dragenter" || e.type === "dragover"); }, []);
  const handleDrop = useCallback((e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]); }, []);

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) { setError(t.couldNotAccessCamera); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } });
      setCurrentView('camera');
      setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); } }, 100);
    } catch (err) {
      if (err.name === 'NotAllowedError') setError(t.cameraAccessDenied);
      else if (err.name === 'NotFoundError') setError(t.noCameraFound);
      else setError(t.couldNotAccessCamera);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      ctx.drawImage(videoRef.current, 0, 0);
      const imageData = canvasRef.current.toDataURL('image/jpeg');
      setUploadedImage(imageData);
      videoRef.current.srcObject?.getTracks().forEach(tr => tr.stop());
      setCurrentView('analyzing');
      analyzeImage(imageData).then(r => { setAnalysisResult(r); if (isLoggedIn) setSearchHistory(prev => [{ ...r, image: imageData, date: new Date() }, ...prev.slice(0, 19)]); setCurrentView('results'); }).catch(() => { setError(t.failedToAnalyze); setCurrentView('home'); });
    }
  };

  const stopCamera = () => { videoRef.current?.srcObject?.getTracks().forEach(tr => tr.stop()); setCurrentView('home'); };
  const resetApp = () => { setUploadedImage(null); setAnalysisResult(null); setCurrentView('home'); setError(null); };
  const formatPrice = (p) => p === 0 ? "N/A" : `₪${p.toLocaleString()}`;
  const formatDate = (d) => new Date(d).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', { month: 'short', day: 'numeric' });

  const handleLogin = (e) => { e.preventDefault(); setUser({ name: authForm.name || authForm.email.split('@')[0], email: authForm.email }); setIsLoggedIn(true); setCurrentView('home'); setAuthForm({ name: '', email: '', password: '' }); };
  const handleSocialLogin = (provider) => { setUser({ name: `${provider} User`, email: `user@${provider.toLowerCase()}.com` }); setIsLoggedIn(true); setCurrentView('home'); };
  const handleLogout = () => { setIsLoggedIn(false); setUser(null); setSearchHistory([]); setUserListings([]); setCurrentView('home'); };
  const addToListings = () => { if (analysisResult && uploadedImage) { setCurrentListing({ ...analysisResult, image: uploadedImage }); setListingForm({ description: analysisResult.details?.description || '', condition: analysisResult.condition || 'Good', quality: 'Good', reason: '' }); setShowListingForm(true); setCurrentView('listing'); } };
  const saveListing = () => { if (currentListing) { setUserListings(prev => [{ ...currentListing, ...listingForm, id: Date.now(), createdAt: new Date() }, ...prev]); setShowListingForm(false); setCurrentListing(null); setCurrentView('profile'); } };
  const deleteListing = (id) => setUserListings(prev => prev.filter(l => l.id !== id));

  const CategoryIcon = ({ category, className }) => { const icons = { Electronics: Smartphone, Vehicles: Car, Watches: Watch, Food: Utensils, Clothing: Shirt, Sports: Dumbbell }; const Icon = icons[category] || Package; return <Icon className={className || "w-5 h-5"} />; };
  const Card = ({ children, className = '', style = {} }) => <div className={`rounded-2xl ${className}`} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', ...style }}>{children}</div>;
  const Button = ({ children, primary, className = '', ...props }) => <button className={`px-6 py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${primary ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-white/5 hover:bg-white/10 text-white border border-white/10'} ${className}`} {...props}>{children}</button>;
  const Input = ({ label, ...props }) => <div className="space-y-2">{label && <label className="text-sm text-slate-400">{label}</label>}<input className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50" dir={isRTL ? 'rtl' : 'ltr'} {...props} /></div>;
  const BackButton = ({ onClick }) => <button onClick={onClick} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors mb-4">{isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}<span className="text-sm">{t.back}</span></button>;

  return (
    <div className="min-h-screen text-white" style={{ fontFamily: isRTL ? "'Heebo', 'Inter', sans-serif" : "'Inter', sans-serif", background: '#0a0f1a' }} dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="fixed inset-0 pointer-events-none"><div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.15), transparent)' }} /></div>

      <div className="relative max-w-md mx-auto min-h-screen flex flex-col">
        <header className="px-5 pt-12 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => { resetApp(); setShowListingForm(false); }}>
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25"><DollarSign className="w-6 h-6 text-white" /></div>
            <div><h1 className="text-xl font-bold">{t.appName}</h1><p className="text-[10px] text-slate-500 uppercase tracking-wider">{t.appTagline}</p></div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setLang(lang === 'en' ? 'he' : 'en')} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm"><Globe className="w-4 h-4 text-blue-400" />{lang === 'en' ? 'עב' : 'EN'}</button>
            {!['home','camera','auth','profile','listing'].includes(currentView) && <button onClick={resetApp} className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10"><RotateCcw className="w-4 h-4 text-slate-400" /></button>}
            <button onClick={() => setCurrentView(isLoggedIn ? 'profile' : 'auth')} className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10"><User className="w-4 h-4 text-slate-400" /></button>
          </div>
        </header>

        {error && <div className="mx-5 mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3"><AlertCircle className="w-5 h-5 text-red-400" /><p className="text-sm text-red-300 flex-1">{error}</p><button onClick={() => setError(null)}><X className="w-4 h-4 text-red-400" /></button></div>}

        <main className="flex-1 px-5 pb-8">
          {currentView === 'auth' && (
            <div className="space-y-6 animate-fadeIn pt-4">
              <BackButton onClick={() => setCurrentView('home')} />
              <div className="text-center space-y-2"><h2 className="text-2xl font-bold">{authView === 'login' ? t.welcomeBack : t.createAccount}</h2><p className="text-slate-400 text-sm">{authView === 'login' ? t.signInAccess : t.joinGetWorth}</p></div>
              <div className="space-y-3">
                <button onClick={() => handleSocialLogin('Google')} className="w-full py-3.5 rounded-xl bg-white/5 border border-white/10 font-medium flex items-center justify-center gap-3 hover:bg-white/10"><svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>{t.continueWithGoogle}</button>
                <button onClick={() => handleSocialLogin('Apple')} className="w-full py-3.5 rounded-xl bg-white/5 border border-white/10 font-medium flex items-center justify-center gap-3 hover:bg-white/10"><svg className="w-5 h-5" fill="white" viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>{t.continueWithApple}</button>
              </div>
              <div className="flex items-center gap-4"><div className="flex-1 h-px bg-white/10" /><span className="text-xs text-slate-500">{t.or}</span><div className="flex-1 h-px bg-white/10" /></div>
              <form onSubmit={handleLogin} className="space-y-4">
                {authView === 'signup' && <Input label={t.fullName} placeholder={isRTL ? "ישראל ישראלי" : "John Doe"} value={authForm.name} onChange={(e) => setAuthForm({...authForm, name: e.target.value})} />}
                <Input label={t.email} type="email" placeholder="email@example.com" value={authForm.email} onChange={(e) => setAuthForm({...authForm, email: e.target.value})} required />
                <Input label={t.password} type="password" placeholder="••••••••" value={authForm.password} onChange={(e) => setAuthForm({...authForm, password: e.target.value})} required />
                <Button primary className="w-full py-3.5">{authView === 'login' ? t.signIn : t.signUp}</Button>
              </form>
              <p className="text-center text-sm text-slate-400">{authView === 'login' ? t.noAccount : t.haveAccount}{' '}<button onClick={() => setAuthView(authView === 'login' ? 'signup' : 'login')} className="text-blue-400 hover:text-blue-300">{authView === 'login' ? t.signUp : t.signIn}</button></p>
            </div>
          )}

          {currentView === 'profile' && isLoggedIn && (
            <div className="space-y-6 animate-fadeIn">
              <BackButton onClick={() => setCurrentView('home')} />
              <Card className="p-5"><div className="flex items-center gap-4"><div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-2xl font-bold">{user?.name?.charAt(0).toUpperCase()}</div><div className="flex-1"><h3 className="text-lg font-semibold">{user?.name}</h3><p className="text-sm text-slate-400">{user?.email}</p></div><button onClick={handleLogout} className="p-2 rounded-lg hover:bg-white/5"><LogOut className="w-5 h-5 text-slate-400" /></button></div></Card>
              <div className="grid grid-cols-2 gap-3"><Card className="p-4 text-center"><p className="text-2xl font-bold text-blue-400">{userListings.length}</p><p className="text-xs text-slate-500 mt-1">{t.myListings}</p></Card><Card className="p-4 text-center"><p className="text-2xl font-bold text-blue-400">{searchHistory.length}</p><p className="text-xs text-slate-500 mt-1">{t.searches}</p></Card></div>
              <div className="space-y-3"><h3 className="font-semibold flex items-center gap-2"><Tag className="w-4 h-4 text-blue-400" />{t.myListings}</h3>
                {userListings.length === 0 ? <Card className="p-8 text-center"><Package className="w-10 h-10 text-slate-600 mx-auto mb-3" /><p className="text-slate-400 text-sm">{t.noListingsYet}</p><p className="text-slate-500 text-xs mt-1">{t.scanItemsAdd}</p></Card> : 
                <div className="space-y-3">{userListings.map((item) => <Card key={item.id} className="p-4"><div className="flex gap-3"><div className="w-20 h-20 rounded-xl overflow-hidden bg-white/5 flex-shrink-0"><img src={item.image} alt="" className="w-full h-full object-cover" /></div><div className="flex-1 min-w-0"><h4 className="font-medium truncate">{lang === 'he' && item.nameHebrew ? item.nameHebrew : item.name}</h4><p className="text-lg font-bold text-blue-400">{formatPrice(item.marketValue?.mid)}</p><div className="flex gap-2 mt-1 flex-wrap"><span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-slate-400">{item.condition}</span></div></div><button onClick={() => deleteListing(item.id)} className="p-2 rounded-lg hover:bg-red-500/10 self-start"><Trash2 className="w-4 h-4 text-red-400" /></button></div>{item.reason && <div className="mt-3 pt-3 border-t border-white/5"><p className="text-xs text-slate-500">{t.reasonForSelling}:</p><p className="text-sm text-slate-300 mt-1">{item.reason}</p></div>}</Card>)}</div>}
              </div>
              <div className="space-y-3"><h3 className="font-semibold flex items-center gap-2"><History className="w-4 h-4 text-blue-400" />{t.searchHistory}</h3>
                {searchHistory.length === 0 ? <Card className="p-8 text-center"><Clock className="w-10 h-10 text-slate-600 mx-auto mb-3" /><p className="text-slate-400 text-sm">{t.noSearchHistory}</p><p className="text-slate-500 text-xs mt-1">{t.scannedItemsAppear}</p></Card> :
                <div className="space-y-2">{searchHistory.map((item, i) => <Card key={i} className="p-3"><div className="flex items-center gap-3"><div className="w-12 h-12 rounded-lg overflow-hidden bg-white/5"><img src={item.image} alt="" className="w-full h-full object-cover" /></div><div className="flex-1 min-w-0"><p className="font-medium text-sm truncate">{lang === 'he' && item.nameHebrew ? item.nameHebrew : item.name}</p><p className="text-xs text-slate-500">{formatDate(item.date)}</p></div><p className="font-semibold text-blue-400">{formatPrice(item.marketValue?.mid)}</p></div></Card>)}</div>}
              </div>
            </div>
          )}

          {currentView === 'listing' && showListingForm && currentListing && (
            <div className="space-y-6 animate-fadeIn">
              <BackButton onClick={() => { setShowListingForm(false); setCurrentListing(null); setCurrentView('results'); }} />
              <div className="text-center space-y-2"><h2 className="text-xl font-bold">{t.addToListingsTitle}</h2><p className="text-slate-400 text-sm">{t.provideDetails}</p></div>
              <Card className="p-4"><div className="flex gap-4"><div className="w-24 h-24 rounded-xl overflow-hidden bg-white/5"><img src={currentListing.image} alt="" className="w-full h-full object-cover" /></div><div><h3 className="font-semibold">{lang === 'he' && currentListing.nameHebrew ? currentListing.nameHebrew : currentListing.name}</h3><p className="text-2xl font-bold text-blue-400 mt-1">{formatPrice(currentListing.marketValue?.mid)}</p><p className="text-xs text-slate-500 mt-1">{currentListing.category}</p></div></div></Card>
              <div className="space-y-4">
                <div className="space-y-2"><label className="text-sm text-slate-400">{t.descriptionLabel}</label><textarea className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 resize-none h-24" dir={isRTL ? 'rtl' : 'ltr'} placeholder={t.describeItem} value={listingForm.description} onChange={(e) => setListingForm({...listingForm, description: e.target.value})} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><label className="text-sm text-slate-400">{t.conditionLabel}</label><select className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none" value={listingForm.condition} onChange={(e) => setListingForm({...listingForm, condition: e.target.value})}><option value="New">{t.new}</option><option value="Like New">{t.likeNew}</option><option value="Excellent">{t.excellent}</option><option value="Good">{t.good}</option><option value="Fair">{t.fair}</option><option value="Poor">{t.poor}</option></select></div>
                  <div className="space-y-2"><label className="text-sm text-slate-400">{t.qualityLabel}</label><select className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none" value={listingForm.quality} onChange={(e) => setListingForm({...listingForm, quality: e.target.value})}><option value="Excellent">{t.qualityExcellent}</option><option value="Good">{t.qualityGood}</option><option value="Average">{t.qualityAverage}</option><option value="Below Average">{t.qualityBelowAverage}</option></select></div>
                </div>
                <div className="space-y-2"><label className="text-sm text-slate-400">{t.reasonLabel}</label><textarea className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 resize-none h-20" dir={isRTL ? 'rtl' : 'ltr'} placeholder={t.whySelling} value={listingForm.reason} onChange={(e) => setListingForm({...listingForm, reason: e.target.value})} /></div>
                <Button primary className="w-full py-4" onClick={saveListing}><Plus className="w-4 h-4" />{t.addToMyListings}</Button>
              </div>
            </div>
          )}

          {currentView === 'home' && (
            <div className="space-y-8 animate-fadeIn">
              <div className="text-center space-y-4 pt-6">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20"><Sparkles className="w-4 h-4 text-blue-400" /><span className="text-sm font-medium text-blue-300">{t.aiPowered}</span></div>
                <h2 className="text-4xl font-bold leading-tight">{t.heroTitle1}<br/><span className="text-blue-400">{t.heroTitle2}</span></h2>
                <p className="text-slate-400 text-sm max-w-[280px] mx-auto">{t.heroSubtitle}</p>
              </div>
              <div className={`relative rounded-2xl transition-all ${dragActive ? 'scale-[1.02] border-blue-500/50 bg-blue-500/5' : 'border-white/10 bg-white/[0.02]'}`} style={{ border: '2px dashed' }} onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} className="hidden" />
                <div className="p-10 text-center space-y-4"><div className="w-16 h-16 mx-auto rounded-2xl bg-white/5 flex items-center justify-center"><ImagePlus className="w-7 h-7 text-slate-500" /></div><div><p className="text-slate-300 font-medium">{t.dropImageHere}</p><p className="text-slate-500 text-sm mt-1">{t.orUseButtons}</p></div></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={startCamera} className="py-4 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors flex items-center justify-center gap-2 font-semibold"><Scan className="w-5 h-5" />{t.scan}</button>
                <button onClick={() => fileInputRef.current?.click()} className="py-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors flex items-center justify-center gap-2 font-semibold"><Upload className="w-5 h-5" />{t.upload}</button>
              </div>
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t.categories}</h3>
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide">
                  {[{ icon: Smartphone, label: t.phones },{ icon: Laptop, label: t.laptops },{ icon: Car, label: t.vehicles },{ icon: Watch, label: t.watches },{ icon: Shirt, label: t.clothing },{ icon: Package, label: t.other }].map((item, i) => <div key={i} className="flex-shrink-0 px-4 py-3 rounded-xl bg-white/5 border border-white/5 flex items-center gap-2 cursor-pointer hover:bg-white/10"><item.icon className="w-4 h-4 text-slate-400" /><span className="text-sm text-slate-300">{item.label}</span></div>)}
                </div>
              </div>
              {isLoggedIn && searchHistory.length > 0 && <div className="space-y-3"><h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t.recentSearches}</h3><div className="space-y-2">{searchHistory.slice(0, 3).map((item, i) => <Card key={i} className="p-3"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg overflow-hidden bg-white/5"><img src={item.image} alt="" className="w-full h-full object-cover" /></div><div className="flex-1 min-w-0"><p className="font-medium text-sm truncate">{lang === 'he' && item.nameHebrew ? item.nameHebrew : item.name}</p><p className="text-xs text-slate-500">{item.category}</p></div><p className="font-semibold text-blue-400 text-sm">{formatPrice(item.marketValue?.mid)}</p></div></Card>)}</div></div>}
            </div>
          )}

          {currentView === 'camera' && (
            <div className="fixed inset-0 z-50 bg-black">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-0 pointer-events-none"><div className="absolute inset-12 rounded-2xl border-2 border-white/20" /><div className="absolute top-12 left-12 w-8 h-8 border-l-2 border-t-2 border-blue-500 rounded-tl-lg" /><div className="absolute top-12 right-12 w-8 h-8 border-r-2 border-t-2 border-blue-500 rounded-tr-lg" /><div className="absolute bottom-12 left-12 w-8 h-8 border-l-2 border-b-2 border-blue-500 rounded-bl-lg" /><div className="absolute bottom-12 right-12 w-8 h-8 border-r-2 border-b-2 border-blue-500 rounded-br-lg" /></div>
              <div className="absolute bottom-0 inset-x-0 p-8 flex justify-center gap-6 bg-gradient-to-t from-black/90 to-transparent"><button onClick={stopCamera} className="w-14 h-14 rounded-full bg-white/10 backdrop-blur flex items-center justify-center"><X className="w-6 h-6" /></button><button onClick={capturePhoto} className="rounded-full bg-blue-600 flex items-center justify-center active:scale-95 transition-transform" style={{width:'72px',height:'72px'}}><div className="w-14 h-14 rounded-full border-4 border-white/30" /></button><div className="w-14" /></div>
              <p className="absolute top-16 inset-x-0 text-center text-sm text-white/60">{t.positionItem}</p>
            </div>
          )}

          {currentView === 'analyzing' && (
            <div className="flex-1 flex flex-col items-center justify-center py-20 animate-fadeIn">
              <div className="relative"><div className="absolute -inset-4 rounded-2xl bg-blue-500/20 blur-2xl animate-pulse" /><div className="relative w-48 h-48 rounded-2xl overflow-hidden border-2 border-blue-500/30">{uploadedImage && <img src={uploadedImage} alt="" className="w-full h-full object-cover" />}</div></div>
              <div className="mt-8 text-center space-y-4"><div className="flex items-center justify-center gap-3"><Loader2 className="w-5 h-5 text-blue-400 animate-spin" /><span className="text-lg font-medium">{t.analyzing}</span></div><div className="space-y-2 text-sm text-slate-500"><p>{t.identifyingItem}</p><p>{t.searchingMarkets}</p><p>{t.calculatingValue}</p></div></div>
            </div>
          )}

          {currentView === 'results' && analysisResult && (
            <div className="space-y-5 animate-fadeIn pb-4">
              <div className="relative">
                <div className="aspect-[4/3] rounded-2xl overflow-hidden"><img src={uploadedImage} alt="" className="w-full h-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-[#0a0f1a] via-transparent to-transparent" /></div>
                <div className={`absolute top-3 ${isRTL ? 'left-3' : 'right-3'} px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 backdrop-blur`}><span className="text-xs font-semibold text-emerald-400">{Math.round(analysisResult.confidence * 100)}% {t.match}</span></div>
                {!analysisResult.isSellable && <div className={`absolute top-3 ${isRTL ? 'right-3' : 'left-3'} px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/30 backdrop-blur`}><span className="text-xs font-semibold text-amber-400">{t.notSellable}</span></div>}
                <div className="absolute bottom-3 inset-x-3"><div className="flex items-center gap-2 text-xs text-slate-400 mb-1"><CategoryIcon category={analysisResult.category} className="w-4 h-4" /><span>{analysisResult.category}</span></div><h2 className="text-xl font-bold">{lang === 'he' && analysisResult.nameHebrew ? analysisResult.nameHebrew : analysisResult.name}</h2></div>
              </div>
              <Card className="p-5" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(59,130,246,0.02) 100%)', border: '1px solid rgba(59,130,246,0.2)' }}>
                <div className="flex justify-between items-start mb-4"><span className="text-sm text-slate-400">{analysisResult.isSellable ? t.marketValue : t.estValue}</span>{analysisResult.marketTrend === 'up' && <TrendingUp className="w-4 h-4 text-emerald-400" />}{analysisResult.marketTrend === 'down' && <TrendingUp className="w-4 h-4 text-red-400 rotate-180" />}</div>
                <div className="text-center"><p className="text-4xl font-bold text-blue-400">{formatPrice(analysisResult.marketValue?.mid)}</p>{analysisResult.marketValue?.low > 0 && <p className="text-sm text-slate-500 mt-1">{t.range}: {formatPrice(analysisResult.marketValue.low)} – {formatPrice(analysisResult.marketValue.high)}</p>}</div>
              </Card>
              <Card className="p-4 space-y-3"><h3 className="font-semibold text-sm flex items-center gap-2"><Package className="w-4 h-4 text-blue-400" />{t.details}</h3>{analysisResult.details?.description && <p className="text-sm text-slate-300">{analysisResult.details.description}</p>}<div className="grid grid-cols-2 gap-3 pt-2"><div className="p-3 rounded-lg bg-white/5"><p className="text-[10px] text-slate-500 uppercase">{t.brand}</p><p className="text-sm font-medium mt-0.5">{analysisResult.details?.brand || 'N/A'}</p></div><div className="p-3 rounded-lg bg-white/5"><p className="text-[10px] text-slate-500 uppercase">{t.condition}</p><p className="text-sm font-medium mt-0.5">{analysisResult.condition}</p></div></div></Card>
              {analysisResult.priceFactors?.length > 0 && <Card className="p-4 space-y-3"><h3 className="font-semibold text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-blue-400" />{t.valueFactors}</h3>{analysisResult.priceFactors.map((f, i) => <div key={i} className="flex justify-between py-2 border-b border-white/5 last:border-0"><span className="text-sm text-slate-400">{f.factor}</span><span className="text-sm font-medium text-blue-400">{f.impact}</span></div>)}</Card>}
              {analysisResult.sellingTips && <Card className="p-4" style={{ background: 'rgba(59,130,246,0.05)' }}><h3 className="font-semibold text-sm flex items-center gap-2 mb-2"><Sparkles className="w-4 h-4 text-blue-400" />{t.sellingTip}</h3><p className="text-sm text-slate-300">{analysisResult.sellingTips}</p></Card>}
              {analysisResult.whereToBuy && <Card className="p-4"><h3 className="font-semibold text-sm flex items-center gap-2 mb-2"><Tag className="w-4 h-4 text-blue-400" />{t.whereToBuySell}</h3><p className="text-sm text-slate-300">{analysisResult.whereToBuy}</p></Card>}
              {analysisResult.israeliMarketNotes && <Card className="p-4" style={{ background: 'rgba(16,185,129,0.05)' }}><h3 className="font-semibold text-sm flex items-center gap-2 mb-2"><Package className="w-4 h-4 text-emerald-400" />{t.israeliMarketNotes}</h3><p className="text-sm text-slate-300">{analysisResult.israeliMarketNotes}</p></Card>}
              <div className="flex gap-3 pt-2">{isLoggedIn ? <Button primary className="flex-1 py-3.5" onClick={addToListings}><Plus className="w-4 h-4" />{t.addToListings}</Button> : <Button primary className="flex-1 py-3.5" onClick={() => setCurrentView('auth')}><User className="w-4 h-4" />{t.signInToList}</Button>}<Button className="py-3.5"><Share2 className="w-4 h-4" /></Button></div>
              <button onClick={resetApp} className="w-full py-3 text-slate-400 text-sm hover:text-white transition-colors flex items-center justify-center gap-2"><Camera className="w-4 h-4" />{t.scanAnother}</button>
            </div>
          )}
        </main>
      </div>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}.animate-fadeIn{animation:fadeIn .3s ease-out}.scrollbar-hide::-webkit-scrollbar{display:none}.scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:${isRTL ? 'left 12px center' : 'right 12px center'}}select option{background:#0a0f1a}`}</style>
    </div>
  );
}
