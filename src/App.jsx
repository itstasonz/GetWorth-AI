import React, { useState, useRef, useCallback } from 'react';
import { Camera, Upload, X, Sparkles, DollarSign, TrendingUp, Package, Car, Smartphone, Watch, Laptop, ChevronRight, ChevronLeft, Loader2, ImagePlus, RotateCcw, Share2, AlertCircle, Utensils, Shirt, Dumbbell, Scan, User, History, LogOut, Plus, Trash2, Clock, Tag, Globe, Home, ShoppingBag, CheckCircle, Circle, Battery, Wrench, Box, Calendar, Shield, AlertTriangle } from 'lucide-react';

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
    israeliMarketNotes: "Israeli Market Notes", addToListings: "List This Item", signInToList: "Sign in to List",
    scanAnother: "Scan Another", save: "Save", share: "Share", welcomeBack: "Welcome back", createAccount: "Create account",
    signInAccess: "Sign in to access your listings", joinGetWorth: "Join GetWorth to list your items",
    continueWithGoogle: "Continue with Google", continueWithApple: "Continue with Apple", or: "or",
    fullName: "Full Name", email: "Email", password: "Password", signIn: "Sign In", signUp: "Sign Up",
    noAccount: "Don't have an account?", haveAccount: "Already have an account?", back: "Back",
    myListings: "My Listings", searches: "Searches", noListingsYet: "No listings yet",
    scanItemsAdd: "Scan items and add them to your listings", searchHistory: "Search History",
    noSearchHistory: "No search history", scannedItemsAppear: "Your scanned items will appear here",
    reasonForSelling: "Reason for selling", addToListingsTitle: "List Your Item", provideDetails: "Set condition and list your item",
    descriptionLabel: "Description", describeItem: "Describe your item...",
    reasonLabel: "Reason for Selling", whySelling: "Why are you selling this item?", addToMyListings: "List Item for Sale",
    failedToAnalyze: "Failed to analyze. Please try again.",
    cameraAccessDenied: "Camera access denied. Please allow camera access in your browser settings.",
    noCameraFound: "No camera found on this device.", cameraInUse: "Camera is already in use.",
    couldNotAccessCamera: "Could not access camera. Try uploading an image instead.",
    // Tabs
    home: "Home", sell: "Sell", profile: "Profile",
    // Condition
    selectCondition: "Select Item Condition",
    conditionAffectsPrice: "Condition affects your selling price",
    newSealed: "New (Sealed)", newSealedDesc: "Unopened, original packaging",
    likeNew: "Like New", likeNewDesc: "Opened but barely used, perfect condition",
    used: "Used", usedDesc: "Normal wear from regular use",
    poorCondition: "Poor Condition", poorConditionDesc: "Significant wear, damage, or issues",
    basePrice: "Base Price", discount: "discount", yourPrice: "Your Price",
    // Follow-up questions
    tellUsMore: "Tell us more about your item",
    answersAdjustPrice: "Your answers help us set the right price",
    cosmeticDamage: "Scratches or cosmetic damage?",
    batteryHealth: "Battery health (if applicable)?",
    repairsOpened: "Any repairs or opened device?",
    missingAccessories: "Missing accessories?",
    itemAge: "How old is the item?",
    hasWarranty: "Warranty available?",
    functionalIssues: "Any functional issues?",
    yes: "Yes", no: "No", notApplicable: "N/A",
    good: "Good", degraded: "Degraded", poor: "Poor",
    under1Year: "< 1 year", years1to2: "1-2 years", years2to3: "2-3 years", over3Years: "3+ years",
    continueToList: "Continue to List",
    // Pricing
    calculatedPrice: "Calculated Price",
    basedOnCondition: "Based on condition assessment",
    finalPrice: "Final Price",
    listNow: "List Now",
    signInRequired: "Sign in Required",
    signInToListItem: "Please sign in to list your item for sale",
    goToSignIn: "Go to Sign In",
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
    israeliMarketNotes: "מידע על השוק הישראלי", addToListings: "פרסם פריט זה", signInToList: "התחבר כדי לפרסם",
    scanAnother: "סרוק פריט נוסף", save: "שמור", share: "שתף", welcomeBack: "ברוך שובך", createAccount: "יצירת חשבון",
    signInAccess: "התחבר כדי לגשת למודעות שלך", joinGetWorth: "הצטרף ל-GetWorth כדי לפרסם פריטים",
    continueWithGoogle: "המשך עם Google", continueWithApple: "המשך עם Apple", or: "או",
    fullName: "שם מלא", email: "דואר אלקטרוני", password: "סיסמה", signIn: "התחבר", signUp: "הירשם",
    noAccount: "אין לך חשבון?", haveAccount: "כבר יש לך חשבון?", back: "חזור",
    myListings: "המודעות שלי", searches: "חיפושים", noListingsYet: "אין מודעות עדיין",
    scanItemsAdd: "סרוק פריטים והוסף אותם למודעות שלך", searchHistory: "היסטוריית חיפושים",
    noSearchHistory: "אין היסטוריית חיפושים", scannedItemsAppear: "פריטים שסרקת יופיעו כאן",
    reasonForSelling: "סיבת המכירה", addToListingsTitle: "פרסם את הפריט שלך", provideDetails: "בחר מצב ופרסם את הפריט",
    descriptionLabel: "תיאור", describeItem: "תאר את הפריט שלך...",
    reasonLabel: "סיבת המכירה", whySelling: "מדוע אתה מוכר את הפריט הזה?", addToMyListings: "פרסם למכירה",
    failedToAnalyze: "הניתוח נכשל. אנא נסה שנית.",
    cameraAccessDenied: "הגישה למצלמה נדחתה. אנא אשר גישה למצלמה בהגדרות הדפדפן.",
    noCameraFound: "לא נמצאה מצלמה במכשיר זה.", cameraInUse: "המצלמה בשימוש כרגע.",
    couldNotAccessCamera: "לא ניתן לגשת למצלמה. נסה להעלות תמונה במקום.",
    // Tabs
    home: "בית", sell: "מכירה", profile: "פרופיל",
    // Condition
    selectCondition: "בחר מצב הפריט",
    conditionAffectsPrice: "המצב משפיע על מחיר המכירה",
    newSealed: "חדש (אטום)", newSealedDesc: "לא נפתח, באריזה מקורית",
    likeNew: "כמו חדש", likeNewDesc: "נפתח אך כמעט לא נעשה בו שימוש",
    used: "משומש", usedDesc: "בלאי רגיל משימוש יומיומי",
    poorCondition: "מצב גרוע", poorConditionDesc: "בלאי משמעותי, נזק או תקלות",
    basePrice: "מחיר בסיס", discount: "הנחה", yourPrice: "המחיר שלך",
    // Follow-up questions
    tellUsMore: "ספר לנו עוד על הפריט",
    answersAdjustPrice: "התשובות שלך עוזרות לנו לקבוע את המחיר הנכון",
    cosmeticDamage: "שריטות או נזק קוסמטי?",
    batteryHealth: "מצב הסוללה (אם רלוונטי)?",
    repairsOpened: "תיקונים או פתיחת המכשיר?",
    missingAccessories: "אביזרים חסרים?",
    itemAge: "מה גיל הפריט?",
    hasWarranty: "יש אחריות?",
    functionalIssues: "בעיות תפקוד?",
    yes: "כן", no: "לא", notApplicable: "לא רלוונטי",
    good: "טוב", degraded: "ירוד", poor: "גרוע",
    under1Year: "פחות משנה", years1to2: "1-2 שנים", years2to3: "2-3 שנים", over3Years: "3+ שנים",
    continueToList: "המשך לפרסום",
    // Pricing
    calculatedPrice: "מחיר מחושב",
    basedOnCondition: "מבוסס על הערכת המצב",
    finalPrice: "מחיר סופי",
    listNow: "פרסם עכשיו",
    signInRequired: "נדרשת התחברות",
    signInToListItem: "אנא התחבר כדי לפרסם את הפריט למכירה",
    goToSignIn: "עבור להתחברות",
  }
};

export default function GetWorth() {
  const [lang, setLang] = useState('he');
  const t = translations[lang];
  const isRTL = lang === 'he';
  
  // Navigation
  const [activeTab, setActiveTab] = useState('home');
  const [currentView, setCurrentView] = useState('home');
  
  // Scan state
  const [uploadedImage, setUploadedImage] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  // Auth state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [authView, setAuthView] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  
  // Listings & History
  const [userListings, setUserListings] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  
  // Listing flow state
  const [selectedCondition, setSelectedCondition] = useState(null);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpAnswers, setFollowUpAnswers] = useState({
    cosmeticDamage: null,
    batteryHealth: null,
    repairsOpened: null,
    missingAccessories: null,
    itemAge: null,
    hasWarranty: null,
    functionalIssues: null
  });
  const [listingDescription, setListingDescription] = useState('');
  const [listingReason, setListingReason] = useState('');
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);

  // Condition discounts
  const conditionDiscounts = {
    newSealed: 0,
    likeNew: 0.15,
    used: 0.30, // Base, will be adjusted by follow-up
    poorCondition: 0.70
  };

  // Calculate price based on condition and follow-up answers
  const calculateAdjustedPrice = (basePrice, condition, answers) => {
    let discount = conditionDiscounts[condition] || 0;
    
    if (condition === 'used') {
      // Start at 25%, adjust to 35% based on answers
      discount = 0.25;
      let negativePoints = 0;
      
      if (answers.cosmeticDamage === 'yes') negativePoints += 2;
      if (answers.batteryHealth === 'degraded') negativePoints += 1;
      if (answers.batteryHealth === 'poor') negativePoints += 2;
      if (answers.repairsOpened === 'yes') negativePoints += 2;
      if (answers.missingAccessories === 'yes') negativePoints += 1;
      if (answers.itemAge === 'years2to3') negativePoints += 1;
      if (answers.itemAge === 'over3Years') negativePoints += 2;
      if (answers.hasWarranty === 'no') negativePoints += 1;
      if (answers.functionalIssues === 'yes') negativePoints += 3;
      
      // Max 10 points = 10% additional discount (25% -> 35%)
      const additionalDiscount = Math.min(negativePoints, 10) * 0.01;
      discount = 0.25 + additionalDiscount;
    }
    
    return Math.round(basePrice * (1 - discount));
  };

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
          setSearchHistory(prev => [{ ...result, image: e.target.result, date: new Date() }, ...prev.slice(0, 19)]);
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
      analyzeImage(imageData).then(r => { 
        setAnalysisResult(r); 
        setSearchHistory(prev => [{ ...r, image: imageData, date: new Date() }, ...prev.slice(0, 19)]); 
        setCurrentView('results'); 
      }).catch(() => { setError(t.failedToAnalyze); setCurrentView('home'); });
    }
  };

  const stopCamera = () => { videoRef.current?.srcObject?.getTracks().forEach(tr => tr.stop()); setCurrentView('home'); };
  
  const resetApp = () => { 
    setUploadedImage(null); 
    setAnalysisResult(null); 
    setCurrentView('home'); 
    setError(null); 
    setSelectedCondition(null);
    setShowFollowUp(false);
    setFollowUpAnswers({ cosmeticDamage: null, batteryHealth: null, repairsOpened: null, missingAccessories: null, itemAge: null, hasWarranty: null, functionalIssues: null });
    setListingDescription('');
    setListingReason('');
    setShowSignInPrompt(false);
  };
  
  const formatPrice = (p) => p === 0 ? "N/A" : `₪${p.toLocaleString()}`;
  const formatDate = (d) => new Date(d).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', { month: 'short', day: 'numeric' });

  const handleLogin = (e) => { e.preventDefault(); setUser({ name: authForm.name || authForm.email.split('@')[0], email: authForm.email }); setIsLoggedIn(true); setActiveTab('home'); setCurrentView('home'); setAuthForm({ name: '', email: '', password: '' }); if (showSignInPrompt) { setShowSignInPrompt(false); setCurrentView('listing'); } };
  const handleSocialLogin = (provider) => { setUser({ name: `${provider} User`, email: `user@${provider.toLowerCase()}.com` }); setIsLoggedIn(true); setActiveTab('home'); setCurrentView('home'); if (showSignInPrompt) { setShowSignInPrompt(false); setCurrentView('listing'); } };
  const handleLogout = () => { setIsLoggedIn(false); setUser(null); setUserListings([]); setActiveTab('home'); setCurrentView('home'); };
  
  const startListingFlow = () => {
    if (!isLoggedIn) {
      setShowSignInPrompt(true);
      return;
    }
    setSelectedCondition(null);
    setShowFollowUp(false);
    setCurrentView('listing');
  };
  
  const handleConditionSelect = (condition) => {
    setSelectedCondition(condition);
    if (condition === 'used') {
      setShowFollowUp(true);
    } else {
      setShowFollowUp(false);
    }
  };
  
  const saveListing = () => {
    if (analysisResult && uploadedImage && selectedCondition) {
      const basePrice = analysisResult.marketValue?.mid || 0;
      const finalPrice = calculateAdjustedPrice(basePrice, selectedCondition, followUpAnswers);
      
      const listing = {
        ...analysisResult,
        image: uploadedImage,
        condition: selectedCondition,
        conditionAnswers: followUpAnswers,
        basePrice,
        finalPrice,
        description: listingDescription,
        reason: listingReason,
        id: Date.now(),
        createdAt: new Date()
      };
      
      setUserListings(prev => [listing, ...prev]);
      resetApp();
      setActiveTab('sell');
      setCurrentView('myListings');
    }
  };
  
  const deleteListing = (id) => setUserListings(prev => prev.filter(l => l.id !== id));

  const CategoryIcon = ({ category, className }) => { const icons = { Electronics: Smartphone, Vehicles: Car, Watches: Watch, Food: Utensils, Clothing: Shirt, Sports: Dumbbell }; const Icon = icons[category] || Package; return <Icon className={className || "w-5 h-5"} />; };
  const Card = ({ children, className = '', style = {} }) => <div className={`rounded-2xl ${className}`} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', ...style }}>{children}</div>;
  const Button = ({ children, primary, className = '', ...props }) => <button className={`px-6 py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 ${primary ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-white/5 hover:bg-white/10 text-white border border-white/10'} ${className}`} {...props}>{children}</button>;
  const Input = ({ label, ...props }) => <div className="space-y-2">{label && <label className="text-sm text-slate-400">{label}</label>}<input className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50" dir={isRTL ? 'rtl' : 'ltr'} {...props} /></div>;
  const BackButton = ({ onClick }) => <button onClick={onClick} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors mb-4">{isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}<span className="text-sm">{t.back}</span></button>;

  const getConditionLabel = (cond) => {
    const labels = { newSealed: t.newSealed, likeNew: t.likeNew, used: t.used, poorCondition: t.poorCondition };
    return labels[cond] || cond;
  };

  // Tab navigation handler
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'home') {
      if (currentView !== 'results' && currentView !== 'analyzing' && currentView !== 'camera' && currentView !== 'listing') {
        setCurrentView('home');
      }
    } else if (tab === 'sell') {
      setCurrentView('myListings');
    } else if (tab === 'profile') {
      if (!isLoggedIn) {
        setCurrentView('auth');
      } else {
        setCurrentView('profile');
      }
    }
  };

  return (
    <div className="min-h-screen text-white flex flex-col" style={{ fontFamily: isRTL ? "'Heebo', 'Inter', sans-serif" : "'Inter', sans-serif", background: '#0a0f1a' }} dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="fixed inset-0 pointer-events-none"><div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.15), transparent)' }} /></div>

      <div className="relative flex-1 max-w-md mx-auto w-full flex flex-col pb-20">
        {/* Header */}
        <header className="px-5 pt-12 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={resetApp}>
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25"><DollarSign className="w-6 h-6 text-white" /></div>
            <div><h1 className="text-xl font-bold">{t.appName}</h1><p className="text-[10px] text-slate-500 uppercase tracking-wider">{t.appTagline}</p></div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setLang(lang === 'en' ? 'he' : 'en')} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm"><Globe className="w-4 h-4 text-blue-400" />{lang === 'en' ? 'עב' : 'EN'}</button>
            {currentView !== 'home' && currentView !== 'auth' && currentView !== 'profile' && currentView !== 'myListings' && <button onClick={resetApp} className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10"><RotateCcw className="w-4 h-4 text-slate-400" /></button>}
          </div>
        </header>

        {error && <div className="mx-5 mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3"><AlertCircle className="w-5 h-5 text-red-400" /><p className="text-sm text-red-300 flex-1">{error}</p><button onClick={() => setError(null)}><X className="w-4 h-4 text-red-400" /></button></div>}

        <main className="flex-1 px-5 pb-4 overflow-y-auto">
          {/* Sign In Prompt Modal */}
          {showSignInPrompt && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-5">
              <Card className="p-6 max-w-sm w-full text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto"><User className="w-8 h-8 text-blue-400" /></div>
                <h3 className="text-xl font-bold">{t.signInRequired}</h3>
                <p className="text-slate-400 text-sm">{t.signInToListItem}</p>
                <div className="flex gap-3">
                  <Button className="flex-1" onClick={() => setShowSignInPrompt(false)}>{t.back}</Button>
                  <Button primary className="flex-1" onClick={() => { setShowSignInPrompt(false); setActiveTab('profile'); setCurrentView('auth'); }}>{t.goToSignIn}</Button>
                </div>
              </Card>
            </div>
          )}

          {/* AUTH VIEW */}
          {currentView === 'auth' && (
            <div className="space-y-6 animate-fadeIn pt-4">
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

          {/* PROFILE VIEW */}
          {currentView === 'profile' && isLoggedIn && (
            <div className="space-y-6 animate-fadeIn">
              <Card className="p-5"><div className="flex items-center gap-4"><div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-2xl font-bold">{user?.name?.charAt(0).toUpperCase()}</div><div className="flex-1"><h3 className="text-lg font-semibold">{user?.name}</h3><p className="text-sm text-slate-400">{user?.email}</p></div><button onClick={handleLogout} className="p-2 rounded-lg hover:bg-white/5"><LogOut className="w-5 h-5 text-slate-400" /></button></div></Card>
              <div className="grid grid-cols-2 gap-3"><Card className="p-4 text-center"><p className="text-2xl font-bold text-blue-400">{userListings.length}</p><p className="text-xs text-slate-500 mt-1">{t.myListings}</p></Card><Card className="p-4 text-center"><p className="text-2xl font-bold text-blue-400">{searchHistory.length}</p><p className="text-xs text-slate-500 mt-1">{t.searches}</p></Card></div>
              <div className="space-y-3"><h3 className="font-semibold flex items-center gap-2"><History className="w-4 h-4 text-blue-400" />{t.searchHistory}</h3>
                {searchHistory.length === 0 ? <Card className="p-8 text-center"><Clock className="w-10 h-10 text-slate-600 mx-auto mb-3" /><p className="text-slate-400 text-sm">{t.noSearchHistory}</p><p className="text-slate-500 text-xs mt-1">{t.scannedItemsAppear}</p></Card> :
                <div className="space-y-2">{searchHistory.map((item, i) => <Card key={i} className="p-3"><div className="flex items-center gap-3"><div className="w-12 h-12 rounded-lg overflow-hidden bg-white/5"><img src={item.image} alt="" className="w-full h-full object-cover" /></div><div className="flex-1 min-w-0"><p className="font-medium text-sm truncate">{lang === 'he' && item.nameHebrew ? item.nameHebrew : item.name}</p><p className="text-xs text-slate-500">{formatDate(item.date)}</p></div><p className="font-semibold text-blue-400">{formatPrice(item.marketValue?.mid)}</p></div></Card>)}</div>}
              </div>
            </div>
          )}

          {/* MY LISTINGS VIEW */}
          {currentView === 'myListings' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">{t.myListings}</h2>
              </div>
              {userListings.length === 0 ? (
                <Card className="p-8 text-center">
                  <ShoppingBag className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400">{t.noListingsYet}</p>
                  <p className="text-slate-500 text-sm mt-1">{t.scanItemsAdd}</p>
                  <Button primary className="mt-4" onClick={() => { setActiveTab('home'); setCurrentView('home'); }}><Scan className="w-4 h-4" />{t.scan}</Button>
                </Card>
              ) : (
                <div className="space-y-4">
                  {userListings.map((item) => (
                    <Card key={item.id} className="overflow-hidden">
                      <div className="flex">
                        <div className="w-28 h-28 flex-shrink-0"><img src={item.image} alt="" className="w-full h-full object-cover" /></div>
                        <div className="flex-1 p-4 min-w-0">
                          <div className="flex justify-between items-start">
                            <div className="min-w-0">
                              <h3 className="font-semibold truncate">{lang === 'he' && item.nameHebrew ? item.nameHebrew : item.name}</h3>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">{getConditionLabel(item.condition)}</span>
                            </div>
                            <button onClick={() => deleteListing(item.id)} className="p-1 rounded hover:bg-red-500/10"><Trash2 className="w-4 h-4 text-red-400" /></button>
                          </div>
                          <div className="mt-2">
                            <span className="text-xs text-slate-500 line-through">{formatPrice(item.basePrice)}</span>
                            <p className="text-xl font-bold text-green-400">{formatPrice(item.finalPrice)}</p>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* LISTING FLOW - CONDITION SELECTION */}
          {currentView === 'listing' && analysisResult && !showFollowUp && (
            <div className="space-y-6 animate-fadeIn">
              <BackButton onClick={() => setCurrentView('results')} />
              
              {/* Item Preview */}
              <Card className="p-4">
                <div className="flex gap-4">
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-white/5"><img src={uploadedImage} alt="" className="w-full h-full object-cover" /></div>
                  <div className="flex-1">
                    <h3 className="font-semibold">{lang === 'he' && analysisResult.nameHebrew ? analysisResult.nameHebrew : analysisResult.name}</h3>
                    <p className="text-sm text-slate-400">{t.basePrice}: <span className="text-blue-400 font-bold">{formatPrice(analysisResult.marketValue?.mid)}</span></p>
                  </div>
                </div>
              </Card>

              <div className="text-center space-y-1">
                <h2 className="text-xl font-bold">{t.selectCondition}</h2>
                <p className="text-slate-400 text-sm">{t.conditionAffectsPrice}</p>
              </div>

              {/* Condition Options */}
              <div className="space-y-3">
                {[
                  { id: 'newSealed', label: t.newSealed, desc: t.newSealedDesc, discount: 0, icon: Box },
                  { id: 'likeNew', label: t.likeNew, desc: t.likeNewDesc, discount: 15, icon: Sparkles },
                  { id: 'used', label: t.used, desc: t.usedDesc, discount: '25-35', icon: Package },
                  { id: 'poorCondition', label: t.poorCondition, desc: t.poorConditionDesc, discount: 70, icon: AlertTriangle },
                ].map((cond) => {
                  const isSelected = selectedCondition === cond.id;
                  const basePrice = analysisResult.marketValue?.mid || 0;
                  const price = cond.id === 'used' ? `${formatPrice(basePrice * 0.65)} - ${formatPrice(basePrice * 0.75)}` : formatPrice(calculateAdjustedPrice(basePrice, cond.id, {}));
                  
                  return (
                    <button
                      key={cond.id}
                      onClick={() => handleConditionSelect(cond.id)}
                      className={`w-full p-4 rounded-xl text-${isRTL ? 'right' : 'left'} transition-all ${isSelected ? 'bg-blue-600/20 border-blue-500' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                      style={{ border: '1px solid' }}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isSelected ? 'bg-blue-500' : 'bg-white/10'}`}>
                          <cond.icon className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{cond.label}</span>
                            <span className={`text-sm ${cond.discount === 0 ? 'text-green-400' : 'text-orange-400'}`}>
                              {cond.discount === 0 ? t.basePrice : `-${cond.discount}% ${t.discount}`}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{cond.desc}</p>
                          <p className="text-sm font-bold text-blue-400 mt-1">{t.yourPrice}: {price}</p>
                        </div>
                        {isSelected ? <CheckCircle className="w-5 h-5 text-blue-400" /> : <Circle className="w-5 h-5 text-slate-600" />}
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedCondition && selectedCondition !== 'used' && (
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <label className="text-sm text-slate-400">{t.descriptionLabel}</label>
                    <textarea className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none resize-none h-20" dir={isRTL ? 'rtl' : 'ltr'} placeholder={t.describeItem} value={listingDescription} onChange={(e) => setListingDescription(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-slate-400">{t.reasonLabel}</label>
                    <textarea className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none resize-none h-16" dir={isRTL ? 'rtl' : 'ltr'} placeholder={t.whySelling} value={listingReason} onChange={(e) => setListingReason(e.target.value)} />
                  </div>
                  <Card className="p-4 text-center" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.1) 0%, rgba(34,197,94,0.02) 100%)', border: '1px solid rgba(34,197,94,0.3)' }}>
                    <p className="text-sm text-slate-400">{t.finalPrice}</p>
                    <p className="text-3xl font-bold text-green-400">{formatPrice(calculateAdjustedPrice(analysisResult.marketValue?.mid || 0, selectedCondition, followUpAnswers))}</p>
                  </Card>
                  <Button primary className="w-full py-4" onClick={saveListing}><Plus className="w-4 h-4" />{t.listNow}</Button>
                </div>
              )}
            </div>
          )}

          {/* LISTING FLOW - FOLLOW-UP QUESTIONS FOR USED */}
          {currentView === 'listing' && showFollowUp && (
            <div className="space-y-6 animate-fadeIn">
              <BackButton onClick={() => setShowFollowUp(false)} />
              
              <div className="text-center space-y-1">
                <h2 className="text-xl font-bold">{t.tellUsMore}</h2>
                <p className="text-slate-400 text-sm">{t.answersAdjustPrice}</p>
              </div>

              {/* Questions */}
              <div className="space-y-4">
                {/* Cosmetic Damage */}
                <Card className="p-4">
                  <p className="font-medium mb-3">{t.cosmeticDamage}</p>
                  <div className="flex gap-2">
                    {['yes', 'no'].map(opt => (
                      <button key={opt} onClick={() => setFollowUpAnswers({...followUpAnswers, cosmeticDamage: opt})} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${followUpAnswers.cosmeticDamage === opt ? 'bg-blue-600 text-white' : 'bg-white/5 hover:bg-white/10'}`}>{t[opt]}</button>
                    ))}
                  </div>
                </Card>

                {/* Battery Health */}
                <Card className="p-4">
                  <p className="font-medium mb-3 flex items-center gap-2"><Battery className="w-4 h-4 text-blue-400" />{t.batteryHealth}</p>
                  <div className="flex gap-2">
                    {['good', 'degraded', 'poor', 'notApplicable'].map(opt => (
                      <button key={opt} onClick={() => setFollowUpAnswers({...followUpAnswers, batteryHealth: opt})} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${followUpAnswers.batteryHealth === opt ? 'bg-blue-600 text-white' : 'bg-white/5 hover:bg-white/10'}`}>{t[opt]}</button>
                    ))}
                  </div>
                </Card>

                {/* Repairs */}
                <Card className="p-4">
                  <p className="font-medium mb-3 flex items-center gap-2"><Wrench className="w-4 h-4 text-blue-400" />{t.repairsOpened}</p>
                  <div className="flex gap-2">
                    {['yes', 'no'].map(opt => (
                      <button key={opt} onClick={() => setFollowUpAnswers({...followUpAnswers, repairsOpened: opt})} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${followUpAnswers.repairsOpened === opt ? 'bg-blue-600 text-white' : 'bg-white/5 hover:bg-white/10'}`}>{t[opt]}</button>
                    ))}
                  </div>
                </Card>

                {/* Missing Accessories */}
                <Card className="p-4">
                  <p className="font-medium mb-3 flex items-center gap-2"><Box className="w-4 h-4 text-blue-400" />{t.missingAccessories}</p>
                  <div className="flex gap-2">
                    {['yes', 'no'].map(opt => (
                      <button key={opt} onClick={() => setFollowUpAnswers({...followUpAnswers, missingAccessories: opt})} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${followUpAnswers.missingAccessories === opt ? 'bg-blue-600 text-white' : 'bg-white/5 hover:bg-white/10'}`}>{t[opt]}</button>
                    ))}
                  </div>
                </Card>

                {/* Item Age */}
                <Card className="p-4">
                  <p className="font-medium mb-3 flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-400" />{t.itemAge}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {['under1Year', 'years1to2', 'years2to3', 'over3Years'].map(opt => (
                      <button key={opt} onClick={() => setFollowUpAnswers({...followUpAnswers, itemAge: opt})} className={`py-2 rounded-lg text-xs font-medium transition-all ${followUpAnswers.itemAge === opt ? 'bg-blue-600 text-white' : 'bg-white/5 hover:bg-white/10'}`}>{t[opt]}</button>
                    ))}
                  </div>
                </Card>

                {/* Warranty */}
                <Card className="p-4">
                  <p className="font-medium mb-3 flex items-center gap-2"><Shield className="w-4 h-4 text-blue-400" />{t.hasWarranty}</p>
                  <div className="flex gap-2">
                    {['yes', 'no'].map(opt => (
                      <button key={opt} onClick={() => setFollowUpAnswers({...followUpAnswers, hasWarranty: opt})} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${followUpAnswers.hasWarranty === opt ? 'bg-blue-600 text-white' : 'bg-white/5 hover:bg-white/10'}`}>{t[opt]}</button>
                    ))}
                  </div>
                </Card>

                {/* Functional Issues */}
                <Card className="p-4">
                  <p className="font-medium mb-3 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-400" />{t.functionalIssues}</p>
                  <div className="flex gap-2">
                    {['yes', 'no'].map(opt => (
                      <button key={opt} onClick={() => setFollowUpAnswers({...followUpAnswers, functionalIssues: opt})} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${followUpAnswers.functionalIssues === opt ? 'bg-blue-600 text-white' : 'bg-white/5 hover:bg-white/10'}`}>{t[opt]}</button>
                    ))}
                  </div>
                </Card>
              </div>

              {/* Description & Reason */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm text-slate-400">{t.descriptionLabel}</label>
                  <textarea className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none resize-none h-20" dir={isRTL ? 'rtl' : 'ltr'} placeholder={t.describeItem} value={listingDescription} onChange={(e) => setListingDescription(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-slate-400">{t.reasonLabel}</label>
                  <textarea className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none resize-none h-16" dir={isRTL ? 'rtl' : 'ltr'} placeholder={t.whySelling} value={listingReason} onChange={(e) => setListingReason(e.target.value)} />
                </div>
              </div>

              {/* Calculated Price */}
              <Card className="p-4 text-center" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.1) 0%, rgba(34,197,94,0.02) 100%)', border: '1px solid rgba(34,197,94,0.3)' }}>
                <p className="text-sm text-slate-400">{t.calculatedPrice}</p>
                <p className="text-3xl font-bold text-green-400">{formatPrice(calculateAdjustedPrice(analysisResult?.marketValue?.mid || 0, 'used', followUpAnswers))}</p>
                <p className="text-xs text-slate-500 mt-1">{t.basedOnCondition}</p>
              </Card>

              <Button primary className="w-full py-4" onClick={saveListing}><Plus className="w-4 h-4" />{t.listNow}</Button>
            </div>
          )}

          {/* HOME VIEW */}
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
            </div>
          )}

          {/* CAMERA VIEW */}
          {currentView === 'camera' && (
            <div className="fixed inset-0 z-50 bg-black">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-0 pointer-events-none"><div className="absolute inset-12 rounded-2xl border-2 border-white/20" /><div className="absolute top-12 left-12 w-8 h-8 border-l-2 border-t-2 border-blue-500 rounded-tl-lg" /><div className="absolute top-12 right-12 w-8 h-8 border-r-2 border-t-2 border-blue-500 rounded-tr-lg" /><div className="absolute bottom-12 left-12 w-8 h-8 border-l-2 border-b-2 border-blue-500 rounded-bl-lg" /><div className="absolute bottom-12 right-12 w-8 h-8 border-r-2 border-b-2 border-blue-500 rounded-br-lg" /></div>
              <div className="absolute bottom-0 inset-x-0 p-8 flex justify-center gap-6 bg-gradient-to-t from-black/90 to-transparent"><button onClick={stopCamera} className="w-14 h-14 rounded-full bg-white/10 backdrop-blur flex items-center justify-center"><X className="w-6 h-6" /></button><button onClick={capturePhoto} className="rounded-full bg-blue-600 flex items-center justify-center active:scale-95 transition-transform" style={{width:'72px',height:'72px'}}><div className="w-14 h-14 rounded-full border-4 border-white/30" /></button><div className="w-14" /></div>
              <p className="absolute top-16 inset-x-0 text-center text-sm text-white/60">{t.positionItem}</p>
            </div>
          )}

          {/* ANALYZING VIEW */}
          {currentView === 'analyzing' && (
            <div className="flex-1 flex flex-col items-center justify-center py-20 animate-fadeIn">
              <div className="relative"><div className="absolute -inset-4 rounded-2xl bg-blue-500/20 blur-2xl animate-pulse" /><div className="relative w-48 h-48 rounded-2xl overflow-hidden border-2 border-blue-500/30">{uploadedImage && <img src={uploadedImage} alt="" className="w-full h-full object-cover" />}</div></div>
              <div className="mt-8 text-center space-y-4"><div className="flex items-center justify-center gap-3"><Loader2 className="w-5 h-5 text-blue-400 animate-spin" /><span className="text-lg font-medium">{t.analyzing}</span></div><div className="space-y-2 text-sm text-slate-500"><p>{t.identifyingItem}</p><p>{t.searchingMarkets}</p><p>{t.calculatingValue}</p></div></div>
            </div>
          )}

          {/* RESULTS VIEW */}
          {currentView === 'results' && analysisResult && (
            <div className="space-y-5 animate-fadeIn pb-4">
              <div className="relative">
                <div className="aspect-[4/3] rounded-2xl overflow-hidden"><img src={uploadedImage} alt="" className="w-full h-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-[#0a0f1a] via-transparent to-transparent" /></div>
                <div className={`absolute top-3 ${isRTL ? 'left-3' : 'right-3'} px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/30 backdrop-blur`}><span className="text-xs font-semibold text-emerald-400">{Math.round(analysisResult.confidence * 100)}% {t.match}</span></div>
                <div className="absolute bottom-3 inset-x-3"><div className="flex items-center gap-2 text-xs text-slate-400 mb-1"><CategoryIcon category={analysisResult.category} className="w-4 h-4" /><span>{analysisResult.category}</span></div><h2 className="text-xl font-bold">{lang === 'he' && analysisResult.nameHebrew ? analysisResult.nameHebrew : analysisResult.name}</h2></div>
              </div>
              <Card className="p-5" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(59,130,246,0.02) 100%)', border: '1px solid rgba(59,130,246,0.2)' }}>
                <div className="flex justify-between items-start mb-2"><span className="text-sm text-slate-400">{t.marketValue}</span>{analysisResult.marketTrend === 'up' && <TrendingUp className="w-4 h-4 text-emerald-400" />}</div>
                <div className="text-center"><p className="text-4xl font-bold text-blue-400">{formatPrice(analysisResult.marketValue?.mid)}</p>{analysisResult.marketValue?.low > 0 && <p className="text-sm text-slate-500 mt-1">{t.range}: {formatPrice(analysisResult.marketValue.low)} – {formatPrice(analysisResult.marketValue.high)}</p>}</div>
              </Card>
              <Card className="p-4 space-y-3"><h3 className="font-semibold text-sm flex items-center gap-2"><Package className="w-4 h-4 text-blue-400" />{t.details}</h3>{analysisResult.details?.description && <p className="text-sm text-slate-300">{analysisResult.details.description}</p>}<div className="grid grid-cols-2 gap-3 pt-2"><div className="p-3 rounded-lg bg-white/5"><p className="text-[10px] text-slate-500 uppercase">{t.brand}</p><p className="text-sm font-medium mt-0.5">{analysisResult.details?.brand || 'N/A'}</p></div><div className="p-3 rounded-lg bg-white/5"><p className="text-[10px] text-slate-500 uppercase">{t.demand}</p><p className="text-sm font-medium mt-0.5 capitalize">{analysisResult.demandLevel}</p></div></div></Card>
              {analysisResult.sellingTips && <Card className="p-4" style={{ background: 'rgba(59,130,246,0.05)' }}><h3 className="font-semibold text-sm flex items-center gap-2 mb-2"><Sparkles className="w-4 h-4 text-blue-400" />{t.sellingTip}</h3><p className="text-sm text-slate-300">{analysisResult.sellingTips}</p></Card>}
              {analysisResult.whereToBuy && <Card className="p-4"><h3 className="font-semibold text-sm flex items-center gap-2 mb-2"><Tag className="w-4 h-4 text-blue-400" />{t.whereToBuySell}</h3><p className="text-sm text-slate-300">{analysisResult.whereToBuy}</p></Card>}
              <div className="flex gap-3 pt-2">
                <Button primary className="flex-1 py-3.5" onClick={startListingFlow}><Plus className="w-4 h-4" />{t.addToListings}</Button>
                <Button className="py-3.5"><Share2 className="w-4 h-4" /></Button>
              </div>
              <button onClick={resetApp} className="w-full py-3 text-slate-400 text-sm hover:text-white transition-colors flex items-center justify-center gap-2"><Camera className="w-4 h-4" />{t.scanAnother}</button>
            </div>
          )}
        </main>

        {/* Bottom Tab Navigation */}
        <nav className="fixed bottom-0 left-0 right-0 bg-[#0a0f1a]/95 backdrop-blur-lg border-t border-white/10 z-40">
          <div className="max-w-md mx-auto flex">
            {[
              { id: 'home', icon: Home, label: t.home },
              { id: 'sell', icon: ShoppingBag, label: t.sell },
              { id: 'profile', icon: User, label: t.profile },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex-1 py-4 flex flex-col items-center gap-1 transition-colors ${activeTab === tab.id ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
              >
                <tab.icon className="w-5 h-5" />
                <span className="text-xs font-medium">{tab.label}</span>
                {tab.id === 'sell' && userListings.length > 0 && (
                  <span className="absolute top-2 right-1/2 translate-x-6 w-4 h-4 rounded-full bg-blue-500 text-[10px] flex items-center justify-center">{userListings.length}</span>
                )}
              </button>
            ))}
          </div>
        </nav>
      </div>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}.animate-fadeIn{animation:fadeIn .3s ease-out}.scrollbar-hide::-webkit-scrollbar{display:none}.scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}`}</style>
    </div>
  );
}
