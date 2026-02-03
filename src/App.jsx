import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, Upload, X, Sparkles, DollarSign, TrendingUp, TrendingDown, Package, Car, Smartphone, Watch, Laptop, ChevronRight, ChevronLeft, Loader2, ImagePlus, RotateCcw, Share2, AlertCircle, Utensils, Shirt, Dumbbell, Scan, User, History, LogOut, Plus, Trash2, Clock, Tag, Globe, Home, ShoppingBag, CheckCircle, Circle, Battery, Wrench, Box, Calendar, Shield, AlertTriangle, Star, Award, Eye, MessageCircle, Phone, HelpCircle, Image, Check, Minus, ChevronDown, MapPin, Edit3, Info } from 'lucide-react';

// ============ TRANSLATIONS ============
const translations = {
  en: {
    appName: "GetWorth", appTagline: "AI Valuation", aiPowered: "AI-Powered",
    heroTitle1: "Know Your", heroTitle2: "Item's Value",
    heroSubtitle: "Snap or upload any item. Get instant AI valuation for the Israeli market.",
    dropImageHere: "Drop image here", orUseButtons: "or use the buttons below",
    scan: "Scan", upload: "Upload", categories: "Categories",
    phones: "Phones", laptops: "Laptops", vehicles: "Vehicles", watches: "Watches", clothing: "Clothing", other: "Other",
    recentSearches: "Recent Searches", positionItem: "Position item in frame",
    analyzing: "Analyzing...", identifyingItem: "Identifying item",
    searchingMarkets: "Searching Israeli markets", calculatingValue: "Calculating value",
    match: "Match", notSellable: "Not Sellable", marketValue: "Market Value",
    estValue: "Est. Value", range: "Range", details: "Details", description: "Description",
    brand: "Brand", condition: "Condition", demand: "Demand", valueFactors: "Value Factors",
    sellingTip: "Selling Tip", whereToBuySell: "Where to Buy/Sell",
    israeliMarketNotes: "Israeli Market Notes", listThisItem: "List This Item",
    signInToList: "Sign in to List", scanAnother: "Scan Another",
    welcomeBack: "Welcome back", createAccount: "Create account",
    signInAccess: "Sign in to access your listings",
    joinGetWorth: "Join GetWorth to list your items",
    continueWithGoogle: "Continue with Google", continueWithApple: "Continue with Apple",
    or: "or", fullName: "Full Name", email: "Email", password: "Password",
    signIn: "Sign In", signUp: "Sign Up", noAccount: "Don't have an account?",
    haveAccount: "Already have an account?", back: "Back",
    myListings: "My Listings", searches: "Searches", noListingsYet: "No listings yet",
    scanItemsAdd: "Scan items and add them to your listings",
    searchHistory: "Search History", noSearchHistory: "No search history",
    scannedItemsAppear: "Your scanned items will appear here",
    failedToAnalyze: "Failed to analyze. Please try again.",
    cameraAccessDenied: "Camera access denied.",
    noCameraFound: "No camera found.", cameraInUse: "Camera in use.",
    couldNotAccessCamera: "Could not access camera.",
    // Tabs
    home: "Home", sell: "Sell", profile: "Profile",
    // Condition Selection
    selectCondition: "Select Condition", conditionAffectsPrice: "Condition affects your price",
    newSealed: "New (Sealed)", newSealedDesc: "Unopened, original packaging",
    likeNew: "Like New", likeNewDesc: "Opened but barely used, perfect",
    used: "Used", usedDesc: "Normal wear from regular use",
    poorCondition: "Poor", poorConditionDesc: "Significant wear or damage",
    basePrice: "Base Price", discount: "off", yourPrice: "Your Price",
    notSure: "I'm Not Sure", notSureDesc: "Help me decide",
    // Follow-up Questions
    tellUsMore: "Tell Us More", answersAdjustPrice: "Answers adjust your price",
    cosmeticDamage: "Scratches or cosmetic damage?",
    batteryHealth: "Battery health?",
    repairsOpened: "Repairs or opened?",
    missingAccessories: "Missing accessories?",
    itemAge: "How old?",
    hasWarranty: "Warranty available?",
    functionalIssues: "Functional issues?",
    yes: "Yes", no: "No", na: "N/A",
    good: "Good", degraded: "Degraded", poor: "Poor",
    under1Year: "< 1yr", years1to2: "1-2yr", years2to3: "2-3yr", over3Years: "3+yr",
    continueBtn: "Continue",
    // Listing
    reviewListing: "Review Listing", almostThere: "Almost there! Review and publish",
    listingTitle: "Title", editTitle: "Edit title...",
    listingDescription: "Description", editDescription: "Describe your item...",
    yourAskingPrice: "Your Asking Price", recommended: "Recommended",
    adjustPrice: "Adjust if needed", contactMethod: "Contact Method",
    phoneNumber: "Phone Number", whatsapp: "WhatsApp", inAppOnly: "In-App Only",
    location: "Pickup Location", addLocation: "Add location",
    publishListing: "Publish Listing", publishing: "Publishing...",
    // Success
    listingPublished: "Listed!", listingLive: "Your item is now live",
    viewListings: "View My Listings", shareNow: "Share",
    // Reputation
    reputation: "Reputation", points: "pts", sales: "Sales",
    newSeller: "New Seller", risingSeller: "Rising Seller",
    trustedSeller: "Trusted Seller", topSeller: "Top Seller", eliteSeller: "Elite Seller",
    // Listing Card
    daysAgo: "days ago", views: "views", priceHistory: "Price History",
    makeOffer: "Make Offer", buyNow: "Contact Seller",
    // Photo Requirements
    photosRequired: "photos required", addMorePhotos: "Add more photos",
    photoTip: "Good photos sell faster!",
    // Price Info
    marketPrice: "Market Price", similarSold: "Similar items sold for",
    priceTrend: "Price Trend", rising: "Rising", falling: "Falling", stable: "Stable",
    // Sign In Prompt
    signInRequired: "Sign In Required", signInToListItem: "Sign in to list items for sale",
    goToSignIn: "Sign In",
    // Misc
    verified: "Verified", quickResponder: "Quick Responder",
    listedOn: "Listed", expiresIn: "Expires in", days: "days",
    edit: "Edit", delete: "Delete", sold: "Mark as Sold",
    active: "Active", expired: "Expired",
  },
  he: {
    appName: "GetWorth", appTagline: "הערכת שווי חכמה", aiPowered: "מונע בינה מלאכותית",
    heroTitle1: "גלה את", heroTitle2: "שווי הפריט שלך",
    heroSubtitle: "צלם או העלה תמונה וקבל הערכת שווי מיידית לשוק הישראלי.",
    dropImageHere: "גרור תמונה לכאן", orUseButtons: "או השתמש בכפתורים",
    scan: "סרוק", upload: "העלה", categories: "קטגוריות",
    phones: "טלפונים", laptops: "מחשבים", vehicles: "רכבים", watches: "שעונים", clothing: "ביגוד", other: "אחר",
    recentSearches: "חיפושים אחרונים", positionItem: "מקם את הפריט במסגרת",
    analyzing: "מנתח...", identifyingItem: "מזהה את הפריט",
    searchingMarkets: "מחפש בשווקים", calculatingValue: "מחשב שווי",
    match: "התאמה", notSellable: "לא למכירה", marketValue: "שווי שוק",
    estValue: "שווי משוער", range: "טווח", details: "פרטים", description: "תיאור",
    brand: "מותג", condition: "מצב", demand: "ביקוש", valueFactors: "גורמי מחיר",
    sellingTip: "טיפ למכירה", whereToBuySell: "איפה לקנות/למכור",
    israeliMarketNotes: "הערות לשוק הישראלי", listThisItem: "פרסם פריט זה",
    signInToList: "התחבר לפרסום", scanAnother: "סרוק עוד",
    welcomeBack: "ברוך שובך", createAccount: "צור חשבון",
    signInAccess: "התחבר לגישה למודעות",
    joinGetWorth: "הצטרף ל-GetWorth לפרסום פריטים",
    continueWithGoogle: "המשך עם Google", continueWithApple: "המשך עם Apple",
    or: "או", fullName: "שם מלא", email: "אימייל", password: "סיסמה",
    signIn: "התחבר", signUp: "הירשם", noAccount: "אין לך חשבון?",
    haveAccount: "יש לך חשבון?", back: "חזור",
    myListings: "המודעות שלי", searches: "חיפושים", noListingsYet: "אין מודעות עדיין",
    scanItemsAdd: "סרוק פריטים והוסף למודעות",
    searchHistory: "היסטוריית חיפושים", noSearchHistory: "אין היסטוריה",
    scannedItemsAppear: "פריטים שסרקת יופיעו כאן",
    failedToAnalyze: "הניתוח נכשל. נסה שוב.",
    cameraAccessDenied: "הגישה למצלמה נדחתה.",
    noCameraFound: "לא נמצאה מצלמה.", cameraInUse: "המצלמה בשימוש.",
    couldNotAccessCamera: "לא ניתן לגשת למצלמה.",
    // Tabs
    home: "בית", sell: "מכירה", profile: "פרופיל",
    // Condition Selection
    selectCondition: "בחר מצב", conditionAffectsPrice: "המצב משפיע על המחיר",
    newSealed: "חדש (אטום)", newSealedDesc: "לא נפתח, אריזה מקורית",
    likeNew: "כמו חדש", likeNewDesc: "נפתח אך כמעט לא בשימוש",
    used: "משומש", usedDesc: "בלאי רגיל משימוש",
    poorCondition: "מצב גרוע", poorConditionDesc: "בלאי משמעותי או נזק",
    basePrice: "מחיר בסיס", discount: "הנחה", yourPrice: "המחיר שלך",
    notSure: "לא בטוח", notSureDesc: "עזור לי להחליט",
    // Follow-up Questions
    tellUsMore: "ספר לנו עוד", answersAdjustPrice: "התשובות מתאימות את המחיר",
    cosmeticDamage: "שריטות או נזק קוסמטי?",
    batteryHealth: "מצב סוללה?",
    repairsOpened: "תיקונים או נפתח?",
    missingAccessories: "אביזרים חסרים?",
    itemAge: "גיל הפריט?",
    hasWarranty: "יש אחריות?",
    functionalIssues: "בעיות תפקוד?",
    yes: "כן", no: "לא", na: "לא רלוונטי",
    good: "טוב", degraded: "ירוד", poor: "גרוע",
    under1Year: "פחות משנה", years1to2: "1-2 שנים", years2to3: "2-3 שנים", over3Years: "3+ שנים",
    continueBtn: "המשך",
    // Listing
    reviewListing: "סקירת מודעה", almostThere: "כמעט שם! בדוק ופרסם",
    listingTitle: "כותרת", editTitle: "ערוך כותרת...",
    listingDescription: "תיאור", editDescription: "תאר את הפריט...",
    yourAskingPrice: "המחיר המבוקש", recommended: "מומלץ",
    adjustPrice: "התאם לפי הצורך", contactMethod: "אמצעי קשר",
    phoneNumber: "טלפון", whatsapp: "וואטסאפ", inAppOnly: "באפליקציה בלבד",
    location: "מיקום לאיסוף", addLocation: "הוסף מיקום",
    publishListing: "פרסם מודעה", publishing: "מפרסם...",
    // Success
    listingPublished: "פורסם!", listingLive: "הפריט שלך באוויר",
    viewListings: "צפה במודעות שלי", shareNow: "שתף",
    // Reputation
    reputation: "מוניטין", points: "נק׳", sales: "מכירות",
    newSeller: "מוכר חדש", risingSeller: "מוכר עולה",
    trustedSeller: "מוכר מהימן", topSeller: "מוכר מוביל", eliteSeller: "מוכר עילית",
    // Listing Card
    daysAgo: "ימים", views: "צפיות", priceHistory: "היסטוריית מחיר",
    makeOffer: "הצע מחיר", buyNow: "צור קשר",
    // Photo Requirements
    photosRequired: "תמונות נדרשות", addMorePhotos: "הוסף תמונות",
    photoTip: "תמונות טובות מוכרות מהר!",
    // Price Info
    marketPrice: "מחיר שוק", similarSold: "פריטים דומים נמכרו ב",
    priceTrend: "מגמת מחיר", rising: "עולה", falling: "יורד", stable: "יציב",
    // Sign In Prompt
    signInRequired: "נדרשת התחברות", signInToListItem: "התחבר כדי לפרסם פריטים",
    goToSignIn: "התחבר",
    // Misc
    verified: "מאומת", quickResponder: "מגיב מהיר",
    listedOn: "פורסם", expiresIn: "פג תוקף בעוד", days: "ימים",
    edit: "ערוך", delete: "מחק", sold: "סמן כנמכר",
    active: "פעיל", expired: "פג תוקף",
  }
};

// ============ MAIN COMPONENT ============
export default function GetWorth() {
  // Language
  const [lang, setLang] = useState('he');
  const t = translations[lang];
  const isRTL = lang === 'he';
  
  // Navigation
  const [activeTab, setActiveTab] = useState('home');
  const [currentView, setCurrentView] = useState('home');
  
  // Scan state
  const [uploadedImages, setUploadedImages] = useState([]);
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
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '', phone: '' });
  
  // Listings & History
  const [userListings, setUserListings] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  
  // Seller Reputation (simulated)
  const [sellerStats, setSellerStats] = useState({
    points: 75,
    sales: 2,
    rating: 4.5,
    responseRate: 95,
    badge: 'newSeller'
  });
  
  // Listing Flow State
  const [listingStep, setListingStep] = useState(0); // 0: condition, 1: followup, 2: review, 3: success
  const [selectedCondition, setSelectedCondition] = useState(null);
  const [followUpAnswers, setFollowUpAnswers] = useState({
    cosmeticDamage: null, batteryHealth: null, repairsOpened: null,
    missingAccessories: null, itemAge: null, hasWarranty: null, functionalIssues: null
  });
  const [listingData, setListingData] = useState({
    title: '', description: '', price: 0, contactMethod: 'phone',
    phone: '', location: '', photos: []
  });
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  // ============ PRICING LOGIC ============
  const conditionDiscounts = { newSealed: 0, likeNew: 0.15, used: 0.30, poorCondition: 0.70 };

  const calculateUsedDiscount = (answers) => {
    let points = 0;
    if (answers.cosmeticDamage === 'yes') points += 2;
    if (answers.batteryHealth === 'degraded') points += 1;
    if (answers.batteryHealth === 'poor') points += 2;
    if (answers.repairsOpened === 'yes') points += 2;
    if (answers.missingAccessories === 'yes') points += 1;
    if (answers.itemAge === 'years2to3') points += 1;
    if (answers.itemAge === 'over3Years') points += 2;
    if (answers.hasWarranty === 'no') points += 1;
    if (answers.functionalIssues === 'yes') points += 3;
    return 0.25 + Math.min(points, 10) * 0.01;
  };

  const calculateFinalPrice = (basePrice, condition, answers) => {
    if (!basePrice) return 0;
    let discount = conditionDiscounts[condition] || 0;
    if (condition === 'used') discount = calculateUsedDiscount(answers);
    const price = Math.round(basePrice * (1 - discount));
    // Rounding rules
    if (price < 100) return Math.round(price / 5) * 5;
    if (price < 1000) return Math.round(price / 10) * 10;
    if (price < 10000) return Math.round(price / 50) * 50;
    return Math.round(price / 100) * 100;
  };

  const getRequiredPhotos = (price) => {
    if (price < 500) return 1;
    if (price < 2000) return 3;
    if (price < 10000) return 5;
    return 8;
  };

  const getListingQualityScore = (listing) => {
    let score = 0;
    score += Math.min(listing.photos?.length || 0, 5) * 5; // Photos: 25 max
    score += listing.description?.length > 50 ? 15 : listing.description?.length > 20 ? 10 : 5;
    const priceRatio = listing.price / (listing.basePrice || listing.price);
    if (priceRatio >= 0.8 && priceRatio <= 1.2) score += 20;
    if (listing.phone) score += 10;
    score += 15; // Quick responder bonus (simulated)
    return Math.min(score, 100);
  };

  const getBadgeInfo = (badge) => {
    const badges = {
      newSeller: { icon: '🌟', color: 'slate', label: t.newSeller, minPoints: 0 },
      risingSeller: { icon: '⭐', color: 'blue', label: t.risingSeller, minPoints: 100 },
      trustedSeller: { icon: '🏅', color: 'green', label: t.trustedSeller, minPoints: 500 },
      topSeller: { icon: '🏆', color: 'yellow', label: t.topSeller, minPoints: 1000 },
      eliteSeller: { icon: '💎', color: 'purple', label: t.eliteSeller, minPoints: 2500 }
    };
    return badges[badge] || badges.newSeller;
  };

  // ============ API & HANDLERS ============
  const analyzeImage = async (imageData) => {
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: imageData.split(',')[1], lang })
      });
      if (!response.ok) throw new Error('API error');
      const data = await response.json();
      if (data.content?.[0]?.text) {
        return JSON.parse(data.content[0].text.replace(/```json\n?|\n?```/g, '').trim());
      }
      throw new Error("Invalid response");
    } catch (err) { console.error(err); throw err; }
  };

  const handleFile = async (file) => {
    if (file?.type.startsWith('image/')) {
      setError(null);
      const reader = new FileReader();
      reader.onload = async (e) => {
        setUploadedImages([e.target.result]);
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

  const handleMultipleFiles = (files) => {
    const newImages = [...uploadedImages];
    Array.from(files).slice(0, 8 - uploadedImages.length).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          newImages.push(e.target.result);
          setUploadedImages([...newImages]);
        };
        reader.readAsDataURL(file);
      }
    });
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
      setUploadedImages([imageData]);
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
    setUploadedImages([]);
    setAnalysisResult(null);
    setCurrentView('home');
    setError(null);
    setSelectedCondition(null);
    setListingStep(0);
    setFollowUpAnswers({ cosmeticDamage: null, batteryHealth: null, repairsOpened: null, missingAccessories: null, itemAge: null, hasWarranty: null, functionalIssues: null });
    setListingData({ title: '', description: '', price: 0, contactMethod: 'phone', phone: '', location: '', photos: [] });
    setShowSignInPrompt(false);
  };

  const formatPrice = (p) => p === 0 ? "N/A" : `₪${p?.toLocaleString() || 0}`;
  const formatDate = (d) => new Date(d).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', { month: 'short', day: 'numeric' });

  // Auth handlers
  const handleLogin = (e) => {
    e.preventDefault();
    const newUser = { name: authForm.name || authForm.email.split('@')[0], email: authForm.email, phone: authForm.phone };
    setUser(newUser);
    setIsLoggedIn(true);
    setAuthForm({ name: '', email: '', password: '', phone: '' });
    if (showSignInPrompt) {
      setShowSignInPrompt(false);
      setCurrentView('listing');
      setListingStep(0);
    } else {
      setActiveTab('home');
      setCurrentView('home');
    }
  };

  const handleSocialLogin = (provider) => {
    setUser({ name: `${provider} User`, email: `user@${provider.toLowerCase()}.com` });
    setIsLoggedIn(true);
    if (showSignInPrompt) {
      setShowSignInPrompt(false);
      setCurrentView('listing');
      setListingStep(0);
    } else {
      setActiveTab('home');
      setCurrentView('home');
    }
  };

  const handleLogout = () => { setIsLoggedIn(false); setUser(null); setUserListings([]); setActiveTab('home'); setCurrentView('home'); };

  // Listing flow handlers
  const startListingFlow = () => {
    if (!isLoggedIn) {
      setShowSignInPrompt(true);
      return;
    }
    const basePrice = analysisResult?.marketValue?.mid || 0;
    setListingData({
      title: lang === 'he' && analysisResult?.nameHebrew ? analysisResult.nameHebrew : analysisResult?.name || '',
      description: analysisResult?.details?.description || '',
      price: basePrice,
      basePrice: basePrice,
      contactMethod: 'phone',
      phone: user?.phone || '',
      location: '',
      photos: uploadedImages
    });
    setSelectedCondition(null);
    setListingStep(0);
    setCurrentView('listing');
  };

  const handleConditionSelect = (condition) => {
    setSelectedCondition(condition);
    const basePrice = analysisResult?.marketValue?.mid || 0;
    const newPrice = calculateFinalPrice(basePrice, condition, followUpAnswers);
    setListingData(prev => ({ ...prev, price: newPrice }));
    
    if (condition === 'used') {
      setListingStep(1); // Go to follow-up questions
    } else if (condition === 'notSure') {
      // Show helper modal (simplified: default to 'used')
      setSelectedCondition('used');
      setListingStep(1);
    } else {
      setListingStep(2); // Go to review
    }
  };

  const handleFollowUpComplete = () => {
    const basePrice = analysisResult?.marketValue?.mid || 0;
    const newPrice = calculateFinalPrice(basePrice, 'used', followUpAnswers);
    setListingData(prev => ({ ...prev, price: newPrice }));
    setListingStep(2);
  };

  const publishListing = () => {
    setIsPublishing(true);
    setTimeout(() => {
      const newListing = {
        ...analysisResult,
        ...listingData,
        id: Date.now(),
        condition: selectedCondition,
        conditionAnswers: followUpAnswers,
        basePrice: analysisResult?.marketValue?.mid || 0,
        finalPrice: listingData.price,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        views: 0,
        status: 'active',
        qualityScore: getListingQualityScore(listingData),
        image: uploadedImages[0]
      };
      setUserListings(prev => [newListing, ...prev]);
      setSellerStats(prev => ({ ...prev, points: prev.points + 10 }));
      setIsPublishing(false);
      setListingStep(3); // Success
    }, 1500);
  };

  const deleteListing = (id) => setUserListings(prev => prev.filter(l => l.id !== id));

  // Tab handler
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'home') {
      if (!['results', 'analyzing', 'camera', 'listing'].includes(currentView)) setCurrentView('home');
    } else if (tab === 'sell') {
      setCurrentView('myListings');
    } else if (tab === 'profile') {
      setCurrentView(isLoggedIn ? 'profile' : 'auth');
    }
  };

  // ============ UI COMPONENTS ============
  const Card = ({ children, className = '', style = {}, onClick }) => (
    <div className={`rounded-2xl ${className}`} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', ...style }} onClick={onClick}>{children}</div>
  );

  const Button = ({ children, primary, danger, disabled, className = '', ...props }) => (
    <button 
      className={`px-5 py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed
        ${primary ? 'bg-blue-600 hover:bg-blue-500 text-white' : ''} 
        ${danger ? 'bg-red-600 hover:bg-red-500 text-white' : ''}
        ${!primary && !danger ? 'bg-white/5 hover:bg-white/10 text-white border border-white/10' : ''} 
        ${className}`} 
      disabled={disabled}
      {...props}
    >{children}</button>
  );

  const Input = ({ label, ...props }) => (
    <div className="space-y-1.5">
      {label && <label className="text-sm text-slate-400">{label}</label>}
      <input className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50" dir={isRTL ? 'rtl' : 'ltr'} {...props} />
    </div>
  );

  const BackButton = ({ onClick }) => (
    <button onClick={onClick} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors mb-4">
      {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      <span className="text-sm">{t.back}</span>
    </button>
  );

  const OptionButton = ({ selected, onClick, children, className = '' }) => (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${selected ? 'bg-blue-600 text-white' : 'bg-white/5 hover:bg-white/10 text-slate-300'} ${className}`}
    >{children}</button>
  );

  const CategoryIcon = ({ category, className }) => {
    const icons = { Electronics: Smartphone, Vehicles: Car, Watches: Watch, Food: Utensils, Clothing: Shirt, Sports: Dumbbell };
    const Icon = icons[category] || Package;
    return <Icon className={className || "w-5 h-5"} />;
  };

  const getConditionLabel = (cond) => {
    const labels = { newSealed: t.newSealed, likeNew: t.likeNew, used: t.used, poorCondition: t.poorCondition };
    return labels[cond] || cond;
  };

  const getConditionColor = (cond) => {
    const colors = { newSealed: 'emerald', likeNew: 'blue', used: 'amber', poorCondition: 'red' };
    return colors[cond] || 'slate';
  };

  // ============ RENDER ============
  return (
    <div className="min-h-screen text-white flex flex-col" style={{ fontFamily: isRTL ? "'Heebo', sans-serif" : "'Inter', sans-serif", background: '#0a0f1a' }} dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="fixed inset-0 pointer-events-none"><div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.15), transparent)' }} /></div>

      <div className="relative flex-1 max-w-md mx-auto w-full flex flex-col pb-20">
        {/* Header */}
        <header className="px-5 pt-12 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={resetApp}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold">{t.appName}</h1>
              <p className="text-[9px] text-slate-500 uppercase tracking-wider">{t.appTagline}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setLang(lang === 'en' ? 'he' : 'en')} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs">
              <Globe className="w-3.5 h-3.5 text-blue-400" />{lang === 'en' ? 'עב' : 'EN'}
            </button>
            {!['home', 'auth', 'profile', 'myListings'].includes(currentView) && (
              <button onClick={resetApp} className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            )}
          </div>
        </header>

        {/* Error */}
        {error && (
          <div className="mx-5 mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-300 flex-1">{error}</p>
            <button onClick={() => setError(null)}><X className="w-4 h-4 text-red-400" /></button>
          </div>
        )}

        {/* Sign In Prompt Modal */}
        {showSignInPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-5">
            <Card className="p-6 max-w-sm w-full text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto">
                <User className="w-7 h-7 text-blue-400" />
              </div>
              <h3 className="text-lg font-bold">{t.signInRequired}</h3>
              <p className="text-slate-400 text-sm">{t.signInToListItem}</p>
              <div className="flex gap-3">
                <Button className="flex-1" onClick={() => setShowSignInPrompt(false)}>{t.back}</Button>
                <Button primary className="flex-1" onClick={() => { setShowSignInPrompt(false); setActiveTab('profile'); setCurrentView('auth'); }}>{t.goToSignIn}</Button>
              </div>
            </Card>
          </div>
        )}

        <main className="flex-1 px-5 pb-4 overflow-y-auto">
          {/* ============ AUTH VIEW ============ */}
          {currentView === 'auth' && (
            <div className="space-y-5 animate-fadeIn pt-4">
              <div className="text-center space-y-1">
                <h2 className="text-xl font-bold">{authView === 'login' ? t.welcomeBack : t.createAccount}</h2>
                <p className="text-slate-400 text-sm">{authView === 'login' ? t.signInAccess : t.joinGetWorth}</p>
              </div>
              <div className="space-y-2.5">
                <button onClick={() => handleSocialLogin('Google')} className="w-full py-3 rounded-xl bg-white/5 border border-white/10 font-medium flex items-center justify-center gap-3 hover:bg-white/10 text-sm">
                  <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                  {t.continueWithGoogle}
                </button>
                <button onClick={() => handleSocialLogin('Apple')} className="w-full py-3 rounded-xl bg-white/5 border border-white/10 font-medium flex items-center justify-center gap-3 hover:bg-white/10 text-sm">
                  <svg className="w-5 h-5" fill="white" viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                  {t.continueWithApple}
                </button>
              </div>
              <div className="flex items-center gap-4"><div className="flex-1 h-px bg-white/10" /><span className="text-xs text-slate-500">{t.or}</span><div className="flex-1 h-px bg-white/10" /></div>
              <form onSubmit={handleLogin} className="space-y-3">
                {authView === 'signup' && <Input label={t.fullName} placeholder={isRTL ? "ישראל ישראלי" : "John Doe"} value={authForm.name} onChange={(e) => setAuthForm({...authForm, name: e.target.value})} />}
                <Input label={t.email} type="email" placeholder="email@example.com" value={authForm.email} onChange={(e) => setAuthForm({...authForm, email: e.target.value})} required />
                <Input label={t.password} type="password" placeholder="••••••••" value={authForm.password} onChange={(e) => setAuthForm({...authForm, password: e.target.value})} required />
                {authView === 'signup' && <Input label={t.phoneNumber} type="tel" placeholder="050-000-0000" value={authForm.phone} onChange={(e) => setAuthForm({...authForm, phone: e.target.value})} />}
                <Button primary className="w-full">{authView === 'login' ? t.signIn : t.signUp}</Button>
              </form>
              <p className="text-center text-sm text-slate-400">
                {authView === 'login' ? t.noAccount : t.haveAccount}{' '}
                <button onClick={() => setAuthView(authView === 'login' ? 'signup' : 'login')} className="text-blue-400">{authView === 'login' ? t.signUp : t.signIn}</button>
              </p>
            </div>
          )}

          {/* ============ PROFILE VIEW ============ */}
          {currentView === 'profile' && isLoggedIn && (
            <div className="space-y-5 animate-fadeIn">
              {/* User Card */}
              <Card className="p-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-xl font-bold">
                    {user?.name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{user?.name}</h3>
                      <span className="text-lg">{getBadgeInfo(sellerStats.badge).icon}</span>
                    </div>
                    <p className="text-xs text-slate-400">{user?.email}</p>
                    <p className="text-xs text-blue-400">{getBadgeInfo(sellerStats.badge).label} • {sellerStats.points} {t.points}</p>
                  </div>
                  <button onClick={handleLogout} className="p-2 rounded-lg hover:bg-white/5">
                    <LogOut className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
              </Card>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-2">
                <Card className="p-3 text-center">
                  <p className="text-xl font-bold text-blue-400">{userListings.length}</p>
                  <p className="text-[10px] text-slate-500">{t.myListings}</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-xl font-bold text-green-400">{sellerStats.sales}</p>
                  <p className="text-[10px] text-slate-500">{t.sales}</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-xl font-bold text-amber-400">{sellerStats.rating}</p>
                  <p className="text-[10px] text-slate-500">★ Rating</p>
                </Card>
              </div>

              {/* Search History */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-2"><History className="w-4 h-4 text-blue-400" />{t.searchHistory}</h3>
                {searchHistory.length === 0 ? (
                  <Card className="p-6 text-center">
                    <Clock className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm">{t.noSearchHistory}</p>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {searchHistory.slice(0, 5).map((item, i) => (
                      <Card key={i} className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-lg overflow-hidden bg-white/5">
                            <img src={item.image} alt="" className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{lang === 'he' && item.nameHebrew ? item.nameHebrew : item.name}</p>
                            <p className="text-xs text-slate-500">{formatDate(item.date)}</p>
                          </div>
                          <p className="font-semibold text-blue-400 text-sm">{formatPrice(item.marketValue?.mid)}</p>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============ MY LISTINGS VIEW ============ */}
          {currentView === 'myListings' && (
            <div className="space-y-4 animate-fadeIn">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">{t.myListings}</h2>
                {userListings.length > 0 && (
                  <span className="text-xs text-slate-400">{userListings.length} {t.active}</span>
                )}
              </div>

              {userListings.length === 0 ? (
                <Card className="p-8 text-center">
                  <ShoppingBag className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400 text-sm">{t.noListingsYet}</p>
                  <p className="text-slate-500 text-xs mt-1">{t.scanItemsAdd}</p>
                  <Button primary className="mt-4" onClick={() => { setActiveTab('home'); setCurrentView('home'); }}>
                    <Scan className="w-4 h-4" />{t.scan}
                  </Button>
                </Card>
              ) : (
                <div className="space-y-3">
                  {userListings.map((item) => {
                    const daysListed = Math.floor((Date.now() - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24));
                    const daysLeft = 30 - daysListed;
                    
                    return (
                      <Card key={item.id} className="overflow-hidden">
                        <div className="flex">
                          <div className="w-24 h-24 flex-shrink-0 relative">
                            <img src={item.image} alt="" className="w-full h-full object-cover" />
                            <div className={`absolute top-1 ${isRTL ? 'right-1' : 'left-1'} px-1.5 py-0.5 rounded text-[9px] font-medium bg-${getConditionColor(item.condition)}-500/80`}>
                              {getConditionLabel(item.condition)}
                            </div>
                          </div>
                          <div className="flex-1 p-3 min-w-0">
                            <div className="flex justify-between items-start gap-2">
                              <h3 className="font-medium text-sm truncate flex-1">{item.title || item.name}</h3>
                              <button onClick={() => deleteListing(item.id)} className="p-1 rounded hover:bg-red-500/10 flex-shrink-0">
                                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                              </button>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-lg font-bold text-green-400">{formatPrice(item.finalPrice)}</span>
                              {item.basePrice !== item.finalPrice && (
                                <span className="text-xs text-slate-500 line-through">{formatPrice(item.basePrice)}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500">
                              <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{item.views}</span>
                              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{daysLeft}d left</span>
                              <span className="flex items-center gap-1 text-blue-400"><Star className="w-3 h-3" />{item.qualityScore}</span>
                            </div>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ============ LISTING FLOW ============ */}
          {currentView === 'listing' && analysisResult && (
            <div className="space-y-4 animate-fadeIn">
              {/* Step 0: Condition Selection */}
              {listingStep === 0 && (
                <>
                  <BackButton onClick={() => setCurrentView('results')} />
                  
                  {/* Item Preview */}
                  <Card className="p-3">
                    <div className="flex gap-3">
                      <div className="w-16 h-16 rounded-lg overflow-hidden bg-white/5">
                        <img src={uploadedImages[0]} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm truncate">{lang === 'he' && analysisResult.nameHebrew ? analysisResult.nameHebrew : analysisResult.name}</h3>
                        <p className="text-xs text-slate-400">{analysisResult.category}</p>
                        <p className="text-sm font-bold text-blue-400 mt-1">{t.basePrice}: {formatPrice(analysisResult.marketValue?.mid)}</p>
                      </div>
                    </div>
                  </Card>

                  <div className="text-center">
                    <h2 className="text-lg font-bold">{t.selectCondition}</h2>
                    <p className="text-xs text-slate-400">{t.conditionAffectsPrice}</p>
                  </div>

                  {/* Condition Cards */}
                  <div className="space-y-2">
                    {[
                      { id: 'newSealed', label: t.newSealed, desc: t.newSealedDesc, discount: 0, icon: Box, color: 'emerald' },
                      { id: 'likeNew', label: t.likeNew, desc: t.likeNewDesc, discount: 15, icon: Sparkles, color: 'blue' },
                      { id: 'used', label: t.used, desc: t.usedDesc, discount: '25-35', icon: Package, color: 'amber' },
                      { id: 'poorCondition', label: t.poorCondition, desc: t.poorConditionDesc, discount: 70, icon: AlertTriangle, color: 'red' },
                    ].map((cond) => {
                      const isSelected = selectedCondition === cond.id;
                      const basePrice = analysisResult.marketValue?.mid || 0;
                      const previewPrice = cond.id === 'used' 
                        ? `${formatPrice(basePrice * 0.65)} - ${formatPrice(basePrice * 0.75)}`
                        : formatPrice(calculateFinalPrice(basePrice, cond.id, {}));

                      return (
                        <button
                          key={cond.id}
                          onClick={() => handleConditionSelect(cond.id)}
                          className={`w-full p-3 rounded-xl text-${isRTL ? 'right' : 'left'} transition-all border ${isSelected ? `border-${cond.color}-500 bg-${cond.color}-500/10` : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isSelected ? `bg-${cond.color}-500` : 'bg-white/10'}`}>
                              <cond.icon className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-sm">{cond.label}</span>
                                <span className={`text-xs ${cond.discount === 0 ? 'text-green-400' : 'text-orange-400'}`}>
                                  {cond.discount === 0 ? '100%' : `-${cond.discount}%`}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 truncate">{cond.desc}</p>
                              <p className="text-sm font-bold text-blue-400 mt-0.5">{previewPrice}</p>
                            </div>
                            {isSelected ? <CheckCircle className="w-5 h-5 text-blue-400" /> : <Circle className="w-5 h-5 text-slate-600" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Not Sure Option */}
                  <button onClick={() => handleConditionSelect('notSure')} className="w-full py-2 text-sm text-slate-400 hover:text-blue-400 flex items-center justify-center gap-2">
                    <HelpCircle className="w-4 h-4" />
                    {t.notSure}
                  </button>
                </>
              )}

              {/* Step 1: Follow-up Questions (for Used) */}
              {listingStep === 1 && (
                <>
                  <BackButton onClick={() => setListingStep(0)} />
                  
                  <div className="text-center">
                    <h2 className="text-lg font-bold">{t.tellUsMore}</h2>
                    <p className="text-xs text-slate-400">{t.answersAdjustPrice}</p>
                  </div>

                  <div className="space-y-3">
                    {/* Cosmetic Damage */}
                    <Card className="p-3">
                      <p className="text-sm font-medium mb-2">{t.cosmeticDamage}</p>
                      <div className="flex gap-2">
                        {['yes', 'no'].map(opt => (
                          <OptionButton key={opt} selected={followUpAnswers.cosmeticDamage === opt} onClick={() => setFollowUpAnswers({...followUpAnswers, cosmeticDamage: opt})} className="flex-1">{t[opt]}</OptionButton>
                        ))}
                      </div>
                    </Card>

                    {/* Battery */}
                    <Card className="p-3">
                      <p className="text-sm font-medium mb-2 flex items-center gap-2"><Battery className="w-4 h-4 text-blue-400" />{t.batteryHealth}</p>
                      <div className="flex gap-2">
                        {['good', 'degraded', 'poor', 'na'].map(opt => (
                          <OptionButton key={opt} selected={followUpAnswers.batteryHealth === opt} onClick={() => setFollowUpAnswers({...followUpAnswers, batteryHealth: opt})} className="flex-1 text-xs">{t[opt]}</OptionButton>
                        ))}
                      </div>
                    </Card>

                    {/* Repairs */}
                    <Card className="p-3">
                      <p className="text-sm font-medium mb-2 flex items-center gap-2"><Wrench className="w-4 h-4 text-blue-400" />{t.repairsOpened}</p>
                      <div className="flex gap-2">
                        {['yes', 'no'].map(opt => (
                          <OptionButton key={opt} selected={followUpAnswers.repairsOpened === opt} onClick={() => setFollowUpAnswers({...followUpAnswers, repairsOpened: opt})} className="flex-1">{t[opt]}</OptionButton>
                        ))}
                      </div>
                    </Card>

                    {/* Missing Accessories */}
                    <Card className="p-3">
                      <p className="text-sm font-medium mb-2 flex items-center gap-2"><Box className="w-4 h-4 text-blue-400" />{t.missingAccessories}</p>
                      <div className="flex gap-2">
                        {['yes', 'no'].map(opt => (
                          <OptionButton key={opt} selected={followUpAnswers.missingAccessories === opt} onClick={() => setFollowUpAnswers({...followUpAnswers, missingAccessories: opt})} className="flex-1">{t[opt]}</OptionButton>
                        ))}
                      </div>
                    </Card>

                    {/* Age */}
                    <Card className="p-3">
                      <p className="text-sm font-medium mb-2 flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-400" />{t.itemAge}</p>
                      <div className="grid grid-cols-4 gap-2">
                        {['under1Year', 'years1to2', 'years2to3', 'over3Years'].map(opt => (
                          <OptionButton key={opt} selected={followUpAnswers.itemAge === opt} onClick={() => setFollowUpAnswers({...followUpAnswers, itemAge: opt})} className="text-[10px]">{t[opt]}</OptionButton>
                        ))}
                      </div>
                    </Card>

                    {/* Warranty */}
                    <Card className="p-3">
                      <p className="text-sm font-medium mb-2 flex items-center gap-2"><Shield className="w-4 h-4 text-blue-400" />{t.hasWarranty}</p>
                      <div className="flex gap-2">
                        {['yes', 'no'].map(opt => (
                          <OptionButton key={opt} selected={followUpAnswers.hasWarranty === opt} onClick={() => setFollowUpAnswers({...followUpAnswers, hasWarranty: opt})} className="flex-1">{t[opt]}</OptionButton>
                        ))}
                      </div>
                    </Card>

                    {/* Functional Issues */}
                    <Card className="p-3">
                      <p className="text-sm font-medium mb-2 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-400" />{t.functionalIssues}</p>
                      <div className="flex gap-2">
                        {['yes', 'no'].map(opt => (
                          <OptionButton key={opt} selected={followUpAnswers.functionalIssues === opt} onClick={() => setFollowUpAnswers({...followUpAnswers, functionalIssues: opt})} className="flex-1">{t[opt]}</OptionButton>
                        ))}
                      </div>
                    </Card>
                  </div>

                  {/* Price Preview */}
                  <Card className="p-3 text-center" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.1), rgba(34,197,94,0.02))', border: '1px solid rgba(34,197,94,0.3)' }}>
                    <p className="text-xs text-slate-400">{t.yourPrice}</p>
                    <p className="text-2xl font-bold text-green-400">{formatPrice(calculateFinalPrice(analysisResult?.marketValue?.mid, 'used', followUpAnswers))}</p>
                  </Card>

                  <Button primary className="w-full" onClick={handleFollowUpComplete}>{t.continueBtn}</Button>
                </>
              )}

              {/* Step 2: Review Listing */}
              {listingStep === 2 && (
                <>
                  <BackButton onClick={() => setListingStep(selectedCondition === 'used' ? 1 : 0)} />

                  <div className="text-center">
                    <h2 className="text-lg font-bold">{t.reviewListing}</h2>
                    <p className="text-xs text-slate-400">{t.almostThere}</p>
                  </div>

                  {/* Photos */}
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {listingData.photos.map((photo, i) => (
                      <div key={i} className="w-20 h-20 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                        <img src={photo} alt="" className="w-full h-full object-cover" />
                      </div>
                    ))}
                    <button onClick={() => fileInputRef.current?.click()} className="w-20 h-20 rounded-lg border-2 border-dashed border-white/20 flex items-center justify-center flex-shrink-0 hover:border-blue-500/50">
                      <Plus className="w-6 h-6 text-slate-500" />
                    </button>
                  </div>

                  {/* Photo requirement notice */}
                  {listingData.photos.length < getRequiredPhotos(listingData.price) && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <Info className="w-4 h-4 text-amber-400" />
                      <p className="text-xs text-amber-300">{getRequiredPhotos(listingData.price)} {t.photosRequired}</p>
                    </div>
                  )}

                  {/* Title */}
                  <Input label={t.listingTitle} value={listingData.title} onChange={(e) => setListingData({...listingData, title: e.target.value})} placeholder={t.editTitle} />

                  {/* Description */}
                  <div className="space-y-1.5">
                    <label className="text-sm text-slate-400">{t.listingDescription}</label>
                    <textarea 
                      className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 resize-none h-20 text-sm"
                      value={listingData.description}
                      onChange={(e) => setListingData({...listingData, description: e.target.value})}
                      placeholder={t.editDescription}
                      dir={isRTL ? 'rtl' : 'ltr'}
                    />
                  </div>

                  {/* Price */}
                  <Card className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-slate-400">{t.yourAskingPrice}</span>
                      <span className="text-xs text-green-400">{t.recommended}: {formatPrice(listingData.price)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold">₪</span>
                      <input 
                        type="number" 
                        className="flex-1 bg-transparent text-2xl font-bold focus:outline-none"
                        value={listingData.price}
                        onChange={(e) => setListingData({...listingData, price: parseInt(e.target.value) || 0})}
                      />
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2">{t.similarSold}: {formatPrice(analysisResult?.marketValue?.low)} - {formatPrice(analysisResult?.marketValue?.high)}</p>
                  </Card>

                  {/* Contact Method */}
                  <div className="space-y-2">
                    <label className="text-sm text-slate-400">{t.contactMethod}</label>
                    <div className="flex gap-2">
                      {[
                        { id: 'phone', icon: Phone, label: t.phoneNumber },
                        { id: 'whatsapp', icon: MessageCircle, label: t.whatsapp },
                        { id: 'inapp', icon: ShoppingBag, label: t.inAppOnly },
                      ].map(method => (
                        <button 
                          key={method.id}
                          onClick={() => setListingData({...listingData, contactMethod: method.id})}
                          className={`flex-1 py-2 px-3 rounded-lg flex items-center justify-center gap-2 text-xs transition-all ${listingData.contactMethod === method.id ? 'bg-blue-600 text-white' : 'bg-white/5 hover:bg-white/10'}`}
                        >
                          <method.icon className="w-4 h-4" />
                          <span className="hidden sm:inline">{method.label}</span>
                        </button>
                      ))}
                    </div>
                    {listingData.contactMethod !== 'inapp' && (
                      <Input placeholder="050-000-0000" value={listingData.phone} onChange={(e) => setListingData({...listingData, phone: e.target.value})} />
                    )}
                  </div>

                  {/* Location */}
                  <Input label={t.location} placeholder={t.addLocation} value={listingData.location} onChange={(e) => setListingData({...listingData, location: e.target.value})} />

                  {/* Publish Button */}
                  <Button primary className="w-full py-4" onClick={publishListing} disabled={isPublishing}>
                    {isPublishing ? <><Loader2 className="w-4 h-4 animate-spin" />{t.publishing}</> : <><Check className="w-4 h-4" />{t.publishListing}</>}
                  </Button>
                </>
              )}

              {/* Step 3: Success */}
              {listingStep === 3 && (
                <div className="text-center py-8 space-y-6 animate-fadeIn">
                  <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
                    <CheckCircle className="w-10 h-10 text-green-400" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-green-400">{t.listingPublished}</h2>
                    <p className="text-slate-400 mt-1">{t.listingLive}</p>
                  </div>
                  <Card className="p-4">
                    <div className="flex gap-3">
                      <div className="w-16 h-16 rounded-lg overflow-hidden bg-white/5">
                        <img src={uploadedImages[0]} alt="" className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 text-left">
                        <h3 className="font-medium text-sm">{listingData.title}</h3>
                        <p className="text-xl font-bold text-green-400">{formatPrice(listingData.price)}</p>
                      </div>
                    </div>
                  </Card>
                  <div className="flex gap-3">
                    <Button className="flex-1" onClick={() => { setActiveTab('sell'); setCurrentView('myListings'); resetApp(); }}>
                      <Eye className="w-4 h-4" />{t.viewListings}
                    </Button>
                    <Button primary className="flex-1">
                      <Share2 className="w-4 h-4" />{t.shareNow}
                    </Button>
                  </div>
                  <button onClick={resetApp} className="text-sm text-slate-400 hover:text-white">{t.scanAnother}</button>
                </div>
              )}
            </div>
          )}

          {/* ============ HOME VIEW ============ */}
          {currentView === 'home' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="text-center space-y-3 pt-4">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20">
                  <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-medium text-blue-300">{t.aiPowered}</span>
                </div>
                <h2 className="text-3xl font-bold leading-tight">
                  {t.heroTitle1}<br/><span className="text-blue-400">{t.heroTitle2}</span>
                </h2>
                <p className="text-slate-400 text-sm max-w-[260px] mx-auto">{t.heroSubtitle}</p>
              </div>

              <div 
                className={`relative rounded-xl transition-all ${dragActive ? 'scale-[1.02] border-blue-500/50 bg-blue-500/5' : 'border-white/10 bg-white/[0.02]'}`} 
                style={{ border: '2px dashed' }} 
                onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
              >
                <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} className="hidden" />
                <div className="p-8 text-center space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-xl bg-white/5 flex items-center justify-center">
                    <ImagePlus className="w-6 h-6 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-slate-300 text-sm font-medium">{t.dropImageHere}</p>
                    <p className="text-slate-500 text-xs mt-1">{t.orUseButtons}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={startCamera} className="py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors flex items-center justify-center gap-2 font-semibold text-sm">
                  <Scan className="w-5 h-5" />{t.scan}
                </button>
                <button onClick={() => fileInputRef.current?.click()} className="py-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors flex items-center justify-center gap-2 font-semibold text-sm">
                  <Upload className="w-5 h-5" />{t.upload}
                </button>
              </div>

              <div className="space-y-2">
                <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{t.categories}</h3>
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-hide">
                  {[
                    { icon: Smartphone, label: t.phones },
                    { icon: Laptop, label: t.laptops },
                    { icon: Car, label: t.vehicles },
                    { icon: Watch, label: t.watches },
                    { icon: Shirt, label: t.clothing },
                    { icon: Package, label: t.other },
                  ].map((item, i) => (
                    <div key={i} className="flex-shrink-0 px-3 py-2 rounded-lg bg-white/5 border border-white/5 flex items-center gap-2 cursor-pointer hover:bg-white/10">
                      <item.icon className="w-4 h-4 text-slate-400" />
                      <span className="text-xs text-slate-300">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ============ CAMERA VIEW ============ */}
          {currentView === 'camera' && (
            <div className="fixed inset-0 z-50 bg-black">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-12 rounded-2xl border-2 border-white/20" />
                <div className="absolute top-12 left-12 w-8 h-8 border-l-2 border-t-2 border-blue-500 rounded-tl-lg" />
                <div className="absolute top-12 right-12 w-8 h-8 border-r-2 border-t-2 border-blue-500 rounded-tr-lg" />
                <div className="absolute bottom-12 left-12 w-8 h-8 border-l-2 border-b-2 border-blue-500 rounded-bl-lg" />
                <div className="absolute bottom-12 right-12 w-8 h-8 border-r-2 border-b-2 border-blue-500 rounded-br-lg" />
              </div>
              <div className="absolute bottom-0 inset-x-0 p-8 flex justify-center gap-6 bg-gradient-to-t from-black/90 to-transparent">
                <button onClick={stopCamera} className="w-14 h-14 rounded-full bg-white/10 backdrop-blur flex items-center justify-center"><X className="w-6 h-6" /></button>
                <button onClick={capturePhoto} className="rounded-full bg-blue-600 flex items-center justify-center active:scale-95 transition-transform" style={{width:'72px',height:'72px'}}><div className="w-14 h-14 rounded-full border-4 border-white/30" /></button>
                <div className="w-14" />
              </div>
              <p className="absolute top-16 inset-x-0 text-center text-sm text-white/60">{t.positionItem}</p>
            </div>
          )}

          {/* ============ ANALYZING VIEW ============ */}
          {currentView === 'analyzing' && (
            <div className="flex-1 flex flex-col items-center justify-center py-16 animate-fadeIn">
              <div className="relative">
                <div className="absolute -inset-4 rounded-2xl bg-blue-500/20 blur-2xl animate-pulse" />
                <div className="relative w-40 h-40 rounded-2xl overflow-hidden border-2 border-blue-500/30">
                  {uploadedImages[0] && <img src={uploadedImages[0]} alt="" className="w-full h-full object-cover" />}
                </div>
              </div>
              <div className="mt-6 text-center space-y-3">
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                  <span className="font-medium">{t.analyzing}</span>
                </div>
                <div className="space-y-1 text-xs text-slate-500">
                  <p>{t.identifyingItem}</p>
                  <p>{t.searchingMarkets}</p>
                  <p>{t.calculatingValue}</p>
                </div>
              </div>
            </div>
          )}

          {/* ============ RESULTS VIEW ============ */}
          {currentView === 'results' && analysisResult && (
            <div className="space-y-4 animate-fadeIn pb-4">
              {/* Image */}
              <div className="relative">
                <div className="aspect-[4/3] rounded-xl overflow-hidden">
                  <img src={uploadedImages[0]} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0a0f1a] via-transparent to-transparent" />
                </div>
                <div className={`absolute top-2 ${isRTL ? 'left-2' : 'right-2'} px-2 py-1 rounded-md bg-emerald-500/20 border border-emerald-500/30 backdrop-blur`}>
                  <span className="text-[10px] font-semibold text-emerald-400">{Math.round(analysisResult.confidence * 100)}% {t.match}</span>
                </div>
                <div className="absolute bottom-2 inset-x-2">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mb-0.5">
                    <CategoryIcon category={analysisResult.category} className="w-3 h-3" />
                    <span>{analysisResult.category}</span>
                  </div>
                  <h2 className="text-lg font-bold">{lang === 'he' && analysisResult.nameHebrew ? analysisResult.nameHebrew : analysisResult.name}</h2>
                </div>
              </div>

              {/* Price Card */}
              <Card className="p-4" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.1), rgba(59,130,246,0.02))', border: '1px solid rgba(59,130,246,0.2)' }}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-slate-400">{t.marketValue}</span>
                  <div className="flex items-center gap-1">
                    {analysisResult.marketTrend === 'up' && <TrendingUp className="w-4 h-4 text-emerald-400" />}
                    {analysisResult.marketTrend === 'down' && <TrendingDown className="w-4 h-4 text-red-400" />}
                    {analysisResult.marketTrend === 'stable' && <Minus className="w-4 h-4 text-slate-400" />}
                    <span className="text-xs text-slate-500">{t[analysisResult.marketTrend] || t.stable}</span>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-400">{formatPrice(analysisResult.marketValue?.mid)}</p>
                  {analysisResult.marketValue?.low > 0 && (
                    <p className="text-xs text-slate-500 mt-1">{t.range}: {formatPrice(analysisResult.marketValue.low)} – {formatPrice(analysisResult.marketValue.high)}</p>
                  )}
                </div>
              </Card>

              {/* Details */}
              <Card className="p-3 space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-2"><Package className="w-4 h-4 text-blue-400" />{t.details}</h3>
                {analysisResult.details?.description && <p className="text-xs text-slate-300">{analysisResult.details.description}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg bg-white/5">
                    <p className="text-[9px] text-slate-500 uppercase">{t.brand}</p>
                    <p className="text-xs font-medium">{analysisResult.details?.brand || 'N/A'}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-white/5">
                    <p className="text-[9px] text-slate-500 uppercase">{t.demand}</p>
                    <p className="text-xs font-medium capitalize">{analysisResult.demandLevel || 'N/A'}</p>
                  </div>
                </div>
              </Card>

              {/* Tips */}
              {analysisResult.sellingTips && (
                <Card className="p-3" style={{ background: 'rgba(59,130,246,0.05)' }}>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-1"><Sparkles className="w-4 h-4 text-blue-400" />{t.sellingTip}</h3>
                  <p className="text-xs text-slate-300">{analysisResult.sellingTips}</p>
                </Card>
              )}

              {/* Where to sell */}
              {analysisResult.whereToBuy && (
                <Card className="p-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-1"><Tag className="w-4 h-4 text-blue-400" />{t.whereToBuySell}</h3>
                  <p className="text-xs text-slate-300">{analysisResult.whereToBuy}</p>
                </Card>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button primary className="flex-1" onClick={startListingFlow}>
                  <Plus className="w-4 h-4" />{t.listThisItem}
                </Button>
                <Button><Share2 className="w-4 h-4" /></Button>
              </div>
              <button onClick={resetApp} className="w-full py-2 text-slate-400 text-sm hover:text-white flex items-center justify-center gap-2">
                <Camera className="w-4 h-4" />{t.scanAnother}
              </button>
            </div>
          )}
        </main>

        {/* Bottom Navigation */}
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
                className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition-colors relative ${activeTab === tab.id ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
              >
                <tab.icon className="w-5 h-5" />
                <span className="text-[10px] font-medium">{tab.label}</span>
                {tab.id === 'sell' && userListings.length > 0 && (
                  <span className="absolute top-1.5 right-1/4 w-4 h-4 rounded-full bg-blue-500 text-[9px] flex items-center justify-center font-bold">{userListings.length}</span>
                )}
              </button>
            ))}
          </div>
        </nav>
      </div>

      <style>{`
        @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .animate-fadeIn{animation:fadeIn .3s ease-out}
        .scrollbar-hide::-webkit-scrollbar{display:none}
        .scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}
      `}</style>
    </div>
  );
}
