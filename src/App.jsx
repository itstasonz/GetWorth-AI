import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Camera, Upload, X, Sparkles, DollarSign, TrendingUp, TrendingDown, Package, Smartphone, Watch, Laptop, ChevronRight, ChevronLeft, Loader2, ImagePlus, Share2, AlertCircle, Shirt, Dumbbell, Scan, User, History, LogOut, Plus, Trash2, Clock, Tag, Globe, Home, ShoppingBag, CheckCircle, Circle, Battery, Wrench, Box, Calendar, Shield, AlertTriangle, Eye, MessageCircle, Phone, HelpCircle, Check, MapPin, Search, SlidersHorizontal, Heart, Grid, ArrowUpDown } from 'lucide-react';

const translations = {
  en: {
    appName: "GetWorth", appTagline: "AI Valuation", aiPowered: "AI-Powered", heroTitle1: "Know Your", heroTitle2: "Item's Value", heroSubtitle: "Snap or upload any item. Get instant AI valuation.", dropImageHere: "Drop image here", orUseButtons: "or use buttons below", scan: "Scan", upload: "Upload", phones: "Phones", laptops: "Laptops", watches: "Watches", clothing: "Clothing", furniture: "Furniture", appliances: "Appliances", sports: "Sports", other: "Other", all: "All", analyzing: "Analyzing...", identifyingItem: "Identifying item", searchingMarkets: "Searching markets", calculatingValue: "Calculating value", match: "Match", marketValue: "Market Value", range: "Range", details: "Details", description: "Description", brand: "Brand", demand: "Demand", sellingTip: "Selling Tip", listThisItem: "List This Item", scanAnother: "Scan Another", welcomeBack: "Welcome back", createAccount: "Create account", signInAccess: "Sign in to access listings", joinGetWorth: "Join GetWorth", continueWithGoogle: "Continue with Google", continueWithApple: "Continue with Apple", or: "or", fullName: "Full Name", email: "Email", password: "Password", signIn: "Sign In", signUp: "Sign Up", noAccount: "No account?", haveAccount: "Have account?", back: "Back", myListings: "My Listings", noListingsYet: "No listings yet", scanItemsAdd: "Scan items to add listings", searchHistory: "Search History", noSearchHistory: "No search history", failedToAnalyze: "Failed to analyze.", cameraAccessDenied: "Camera access denied.", home: "Home", browse: "Browse", sell: "Sell", favorites: "Saved", profile: "Profile", selectCondition: "Select Condition", conditionAffectsPrice: "Condition affects price", newSealed: "New (Sealed)", newSealedDesc: "Unopened, original packaging", likeNew: "Like New", likeNewDesc: "Barely used, perfect", used: "Used", usedDesc: "Normal wear", poorCondition: "Poor", poorConditionDesc: "Significant damage", basePrice: "Base Price", yourPrice: "Your Price", notSure: "Not Sure", tellUsMore: "Tell Us More", answersAdjustPrice: "Answers adjust price", cosmeticDamage: "Scratches?", batteryHealth: "Battery health?", repairsOpened: "Repairs?", missingAccessories: "Missing accessories?", itemAge: "How old?", hasWarranty: "Warranty?", functionalIssues: "Issues?", yes: "Yes", no: "No", na: "N/A", good: "Good", degraded: "Degraded", poor: "Poor", under1Year: "<1yr", years1to2: "1-2yr", years2to3: "2-3yr", over3Years: "3+yr", continueBtn: "Continue", reviewListing: "Review Listing", almostThere: "Almost there!", listingTitle: "Title", listingDescription: "Description", yourAskingPrice: "Your Price", recommended: "Recommended", contactMethod: "Contact", phoneNumber: "Phone", whatsapp: "WhatsApp", inAppOnly: "In-App", location: "Location", addLocation: "Add location", publishListing: "Publish", publishing: "Publishing...", listingPublished: "Listed!", listingLive: "Your item is live", viewListings: "View Listings", shareNow: "Share", points: "pts", sales: "Sales", newSeller: "New Seller", risingSeller: "Rising", trustedSeller: "Trusted", topSeller: "Top Seller", eliteSeller: "Elite", searchPlaceholder: "Search items...", filters: "Filters", sortBy: "Sort", clearAll: "Clear", priceRange: "Price Range", minPrice: "Min", maxPrice: "Max", results: "results", newest: "Newest", priceLowHigh: "Low-High", priceHighLow: "High-Low", mostPopular: "Popular", noResults: "No items", tryDifferent: "Try different filters", contactSeller: "Contact Seller", saved: "Saved", sellerInfo: "Seller Info", callSeller: "Call", whatsappSeller: "WhatsApp", verified: "Verified", today: "today", yesterday: "yesterday", daysAgo: "days ago", savedItems: "Saved Items", noSavedItems: "No saved items", browseAndSave: "Browse and tap ♡ to save", signInRequired: "Sign In Required", signInToSave: "Sign in to save", signInToContact: "Sign in to contact", signInToListItem: "Sign in to list", goToSignIn: "Sign In", cancel: "Cancel", active: "Active"
  },
  he: {
    appName: "GetWorth", appTagline: "הערכת שווי", aiPowered: "בינה מלאכותית", heroTitle1: "גלה את", heroTitle2: "שווי הפריט", heroSubtitle: "צלם או העלה תמונה וקבל הערכת שווי.", dropImageHere: "גרור תמונה", orUseButtons: "או השתמש בכפתורים", scan: "סרוק", upload: "העלה", phones: "טלפונים", laptops: "מחשבים", watches: "שעונים", clothing: "ביגוד", furniture: "ריהוט", appliances: "מכשירי חשמל", sports: "ספורט", other: "אחר", all: "הכל", analyzing: "מנתח...", identifyingItem: "מזהה פריט", searchingMarkets: "מחפש בשווקים", calculatingValue: "מחשב שווי", match: "התאמה", marketValue: "שווי שוק", range: "טווח", details: "פרטים", description: "תיאור", brand: "מותג", demand: "ביקוש", sellingTip: "טיפ למכירה", listThisItem: "פרסם פריט", scanAnother: "סרוק עוד", welcomeBack: "ברוך שובך", createAccount: "צור חשבון", signInAccess: "התחבר לגישה", joinGetWorth: "הצטרף", continueWithGoogle: "המשך עם Google", continueWithApple: "המשך עם Apple", or: "או", fullName: "שם מלא", email: "אימייל", password: "סיסמה", signIn: "התחבר", signUp: "הירשם", noAccount: "אין חשבון?", haveAccount: "יש חשבון?", back: "חזור", myListings: "המודעות שלי", noListingsYet: "אין מודעות", scanItemsAdd: "סרוק פריטים", searchHistory: "היסטוריה", noSearchHistory: "אין היסטוריה", failedToAnalyze: "נכשל.", cameraAccessDenied: "גישה נדחתה.", home: "בית", browse: "חיפוש", sell: "מכירה", favorites: "שמורים", profile: "פרופיל", selectCondition: "בחר מצב", conditionAffectsPrice: "המצב משפיע", newSealed: "חדש (אטום)", newSealedDesc: "לא נפתח", likeNew: "כמו חדש", likeNewDesc: "כמעט לא בשימוש", used: "משומש", usedDesc: "בלאי רגיל", poorCondition: "מצב גרוע", poorConditionDesc: "נזק משמעותי", basePrice: "מחיר בסיס", yourPrice: "המחיר שלך", notSure: "לא בטוח", tellUsMore: "ספר עוד", answersAdjustPrice: "התשובות מתאימות", cosmeticDamage: "שריטות?", batteryHealth: "סוללה?", repairsOpened: "תיקונים?", missingAccessories: "חסרים אביזרים?", itemAge: "גיל?", hasWarranty: "אחריות?", functionalIssues: "בעיות?", yes: "כן", no: "לא", na: "לא רלוונטי", good: "טוב", degraded: "ירוד", poor: "גרוע", under1Year: "<שנה", years1to2: "1-2", years2to3: "2-3", over3Years: "3+", continueBtn: "המשך", reviewListing: "סקירה", almostThere: "כמעט!", listingTitle: "כותרת", listingDescription: "תיאור", yourAskingPrice: "מחיר", recommended: "מומלץ", contactMethod: "קשר", phoneNumber: "טלפון", whatsapp: "וואטסאפ", inAppOnly: "באפליקציה", location: "מיקום", addLocation: "הוסף מיקום", publishListing: "פרסם", publishing: "מפרסם...", listingPublished: "פורסם!", listingLive: "באוויר", viewListings: "צפה", shareNow: "שתף", points: "נק׳", sales: "מכירות", newSeller: "חדש", risingSeller: "עולה", trustedSeller: "מהימן", topSeller: "מוביל", eliteSeller: "עילית", searchPlaceholder: "חפש...", filters: "סינון", sortBy: "מיון", clearAll: "נקה", priceRange: "טווח מחירים", minPrice: "מינ׳", maxPrice: "מקס׳", results: "תוצאות", newest: "חדש", priceLowHigh: "נמוך-גבוה", priceHighLow: "גבוה-נמוך", mostPopular: "פופולרי", noResults: "אין פריטים", tryDifferent: "נסה אחר", contactSeller: "צור קשר", saved: "נשמר", sellerInfo: "מוכר", callSeller: "התקשר", whatsappSeller: "וואטסאפ", verified: "מאומת", today: "היום", yesterday: "אתמול", daysAgo: "ימים", savedItems: "שמורים", noSavedItems: "אין שמורים", browseAndSave: "חפש ושמור", signInRequired: "נדרשת התחברות", signInToSave: "התחבר לשמירה", signInToContact: "התחבר לקשר", signInToListItem: "התחבר לפרסום", goToSignIn: "התחבר", cancel: "ביטול", active: "פעיל"
  }
};

const sampleListings = [
  { id: 1, name: "iPhone 14 Pro Max", nameHebrew: "אייפון 14 פרו מקס", category: "Electronics", condition: "likeNew", price: 3200, image: "https://images.unsplash.com/photo-1678685888221-cda773a3dcdb?w=400", seller: { name: "David K.", rating: 4.8, sales: 12, badge: "trustedSeller", phone: "050-1234567", verified: true }, location: "Tel Aviv", views: 145, createdAt: new Date(Date.now() - 2*24*60*60*1000), description: "Perfect condition, battery 98%." },
  { id: 2, name: "MacBook Pro M2", nameHebrew: "מקבוק פרו M2", category: "Electronics", condition: "used", price: 5500, image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400", seller: { name: "Sarah L.", rating: 5.0, sales: 28, badge: "topSeller", phone: "052-9876543", verified: true }, location: "Herzliya", views: 89, createdAt: new Date(Date.now() - 5*24*60*60*1000), description: "Light scratches, works perfectly." },
  { id: 3, name: "Samsung Galaxy S24", nameHebrew: "סמסונג גלקסי S24", category: "Electronics", condition: "newSealed", price: 4200, image: "https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=400", seller: { name: "Tech Store", rating: 4.9, sales: 156, badge: "eliteSeller", phone: "03-5551234", verified: true }, location: "Ramat Gan", views: 312, createdAt: new Date(Date.now() - 1*24*60*60*1000), description: "Sealed, full warranty." },
  { id: 4, name: "PlayStation 5", nameHebrew: "פלייסטיישן 5", category: "Electronics", condition: "likeNew", price: 1800, image: "https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=400", seller: { name: "Gamer Plus", rating: 4.7, sales: 45, badge: "trustedSeller", phone: "054-7771234", verified: true }, location: "Netanya", views: 203, createdAt: new Date(Date.now() - 3*24*60*60*1000), description: "Used twice, 2 controllers." },
  { id: 5, name: "IKEA MALM Bed", nameHebrew: "מיטת MALM", category: "Furniture", condition: "used", price: 650, image: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=400", seller: { name: "Moving Sale", rating: 4.5, sales: 8, badge: "risingSeller", phone: "050-5556789", verified: false }, location: "Jerusalem", views: 67, createdAt: new Date(Date.now() - 7*24*60*60*1000), description: "Queen size, white." },
  { id: 6, name: "Apple Watch 9", nameHebrew: "אפל ווטש 9", category: "Watches", condition: "likeNew", price: 1450, image: "https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=400", seller: { name: "Yossi M.", rating: 4.6, sales: 5, badge: "newSeller", phone: "052-1112233", verified: true }, location: "Haifa", views: 98, createdAt: new Date(Date.now() - 4*24*60*60*1000), description: "45mm GPS." },
  { id: 7, name: "Nike Air Jordan 1", nameHebrew: "נייקי ג'ורדן 1", category: "Clothing", condition: "newSealed", price: 850, image: "https://images.unsplash.com/photo-1552346154-21d32810aba3?w=400", seller: { name: "Sneaker Head", rating: 4.9, sales: 67, badge: "topSeller", phone: "054-9998877", verified: true }, location: "Tel Aviv", views: 234, createdAt: new Date(Date.now() - 1*24*60*60*1000), description: "Size 43, DS." },
  { id: 8, name: "DJI Mini 3 Pro", nameHebrew: "רחפן DJI", category: "Electronics", condition: "used", price: 2100, image: "https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=400", seller: { name: "Drone IL", rating: 4.8, sales: 23, badge: "trustedSeller", phone: "050-3334455", verified: true }, location: "Eilat", views: 156, createdAt: new Date(Date.now() - 6*24*60*60*1000), description: "Fly More combo." },
];

export default function GetWorth() {
  const [lang, setLang] = useState('he');
  const t = translations[lang];
  const isRTL = lang === 'he';
  const [activeTab, setActiveTab] = useState('home');
  const [currentView, setCurrentView] = useState('home');
  const [uploadedImages, setUploadedImages] = useState([]);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [authView, setAuthView] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '', phone: '' });
  const [userListings, setUserListings] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  const [savedItems, setSavedItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [priceRange, setPriceRange] = useState({ min: '', max: '' });
  const [sortBy, setSortBy] = useState('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedListing, setSelectedListing] = useState(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [sellerStats] = useState({ points: 75, sales: 2, badge: 'newSeller' });
  const [listingStep, setListingStep] = useState(0);
  const [selectedCondition, setSelectedCondition] = useState(null);
  const [followUpAnswers, setFollowUpAnswers] = useState({ cosmeticDamage: null, batteryHealth: null, repairsOpened: null, missingAccessories: null, itemAge: null, hasWarranty: null, functionalIssues: null });
  const [listingData, setListingData] = useState({ title: '', description: '', price: 0, contactMethod: 'phone', phone: '', location: '', photos: [] });
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);
  const [signInPromptAction, setSignInPromptAction] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const conditionDiscounts = { newSealed: 0, likeNew: 0.15, used: 0.30, poorCondition: 0.70 };
  const calculateFinalPrice = (basePrice, condition, answers) => {
    if (!basePrice) return 0;
    let discount = conditionDiscounts[condition] || 0;
    if (condition === 'used') {
      let pts = 0;
      if (answers.cosmeticDamage === 'yes') pts += 2;
      if (answers.batteryHealth === 'poor') pts += 2;
      if (answers.repairsOpened === 'yes') pts += 2;
      if (answers.functionalIssues === 'yes') pts += 3;
      discount = 0.25 + Math.min(pts, 10) * 0.01;
    }
    return Math.round(basePrice * (1 - discount));
  };

  const filteredListings = useMemo(() => {
    let results = [...sampleListings, ...userListings];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      results = results.filter(item => item.name?.toLowerCase().includes(q) || item.nameHebrew?.toLowerCase().includes(q));
    }
    if (selectedCategory !== 'all') results = results.filter(item => item.category === selectedCategory);
    if (priceRange.min) results = results.filter(item => item.price >= parseInt(priceRange.min));
    if (priceRange.max) results = results.filter(item => item.price <= parseInt(priceRange.max));
    if (sortBy === 'priceLowHigh') results.sort((a, b) => a.price - b.price);
    else if (sortBy === 'priceHighLow') results.sort((a, b) => b.price - a.price);
    else results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return results;
  }, [userListings, searchQuery, selectedCategory, priceRange, sortBy]);

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

  const handleDrag = useCallback((e) => { e.preventDefault(); setDragActive(e.type === "dragenter" || e.type === "dragover"); }, []);
  const handleDrop = useCallback((e) => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]); }, []);
  const startCamera = async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); setCurrentView('camera'); setTimeout(() => { if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); } }, 100); } catch { setError(t.cameraAccessDenied); } };
  const capturePhoto = () => { if (videoRef.current && canvasRef.current) { const ctx = canvasRef.current.getContext('2d'); canvasRef.current.width = videoRef.current.videoWidth; canvasRef.current.height = videoRef.current.videoHeight; ctx.drawImage(videoRef.current, 0, 0); const imageData = canvasRef.current.toDataURL('image/jpeg'); setUploadedImages([imageData]); videoRef.current.srcObject?.getTracks().forEach(tr => tr.stop()); setCurrentView('analyzing'); analyzeImage(imageData).then(r => { setAnalysisResult(r); setCurrentView('results'); }).catch(() => { setError(t.failedToAnalyze); setCurrentView('home'); }); } };
  const stopCamera = () => { videoRef.current?.srcObject?.getTracks().forEach(tr => tr.stop()); setCurrentView('home'); };
  const resetApp = () => { setUploadedImages([]); setAnalysisResult(null); setCurrentView('home'); setError(null); setSelectedCondition(null); setListingStep(0); setSelectedListing(null); };
  const formatPrice = (p) => p ? `₪${p.toLocaleString()}` : "N/A";
  const getTimeAgo = (date) => { const days = Math.floor((Date.now() - new Date(date).getTime()) / (1000*60*60*24)); if (days === 0) return t.today; if (days === 1) return t.yesterday; return `${days} ${t.daysAgo}`; };
  const handleLogin = (e) => { e.preventDefault(); setUser({ name: authForm.name || authForm.email.split('@')[0], email: authForm.email }); setIsLoggedIn(true); setAuthForm({ name: '', email: '', password: '', phone: '' }); if (signInPromptAction === 'list') { setShowSignInPrompt(false); setCurrentView('listing'); } else { setActiveTab('home'); setCurrentView('home'); } setSignInPromptAction(null); };
  const handleSocialLogin = (provider) => { setUser({ name: `${provider} User`, email: `user@${provider.toLowerCase()}.com` }); setIsLoggedIn(true); setShowSignInPrompt(false); setActiveTab('home'); setCurrentView('home'); };
  const handleLogout = () => { setIsLoggedIn(false); setUser(null); setUserListings([]); setSavedItems([]); setActiveTab('home'); setCurrentView('home'); };
  const toggleSaveItem = (item) => { if (!isLoggedIn) { setSignInPromptAction('save'); setShowSignInPrompt(true); return; } const isSaved = savedItems.some(s => s.id === item.id); if (isSaved) setSavedItems(prev => prev.filter(s => s.id !== item.id)); else setSavedItems(prev => [...prev, item]); };
  const isItemSaved = (id) => savedItems.some(s => s.id === id);
  const startListingFlow = () => { if (!isLoggedIn) { setSignInPromptAction('list'); setShowSignInPrompt(true); return; } setListingData({ title: analysisResult?.name || '', description: '', price: analysisResult?.marketValue?.mid || 0, contactMethod: 'phone', phone: '', location: '', photos: uploadedImages }); setCurrentView('listing'); };
  const handleConditionSelect = (condition) => { setSelectedCondition(condition); setListingData(prev => ({ ...prev, price: calculateFinalPrice(analysisResult?.marketValue?.mid, condition, followUpAnswers) })); if (condition === 'used') setListingStep(1); else setListingStep(2); };
  const publishListing = () => { setIsPublishing(true); setTimeout(() => { const newListing = { ...listingData, id: Date.now(), condition: selectedCondition, createdAt: new Date(), views: 0, image: uploadedImages[0], seller: { name: user?.name, rating: 5.0, sales: 0, badge: 'newSeller', verified: false } }; setUserListings(prev => [newListing, ...prev]); setIsPublishing(false); setListingStep(3); }, 1500); };
  const handleContactSeller = (listing) => { if (!isLoggedIn) { setSignInPromptAction('contact'); setShowSignInPrompt(true); return; } setSelectedListing(listing); setShowContactModal(true); };
  const handleTabChange = (tab) => { setActiveTab(tab); setSelectedListing(null); if (tab === 'home') setCurrentView('home'); else if (tab === 'browse') setCurrentView('browse'); else if (tab === 'sell') setCurrentView('myListings'); else if (tab === 'favorites') setCurrentView('favorites'); else if (tab === 'profile') setCurrentView(isLoggedIn ? 'profile' : 'auth'); };

  const Card = ({ children, className = '', style = {}, onClick }) => <div className={`rounded-2xl ${className} ${onClick ? 'cursor-pointer' : ''}`} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', ...style }} onClick={onClick}>{children}</div>;
  const Button = ({ children, primary, disabled, className = '', ...props }) => <button className={`px-5 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 ${primary ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-white/5 hover:bg-white/10 text-white border border-white/10'} ${className}`} disabled={disabled} {...props}>{children}</button>;
  const Input = ({ label, ...props }) => <div className="space-y-1.5">{label && <label className="text-sm text-slate-400">{label}</label>}<input className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none" dir={isRTL ? 'rtl' : 'ltr'} {...props} /></div>;
  const BackButton = ({ onClick }) => <button onClick={onClick} className="flex items-center gap-2 text-slate-400 hover:text-white mb-4">{isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}<span className="text-sm">{t.back}</span></button>;
  const OptionButton = ({ selected, onClick, children, className = '' }) => <button onClick={onClick} className={`px-4 py-2 rounded-lg text-sm font-medium ${selected ? 'bg-blue-600 text-white' : 'bg-white/5 hover:bg-white/10'} ${className}`}>{children}</button>;
  const getConditionLabel = (c) => ({ newSealed: t.newSealed, likeNew: t.likeNew, used: t.used, poorCondition: t.poorCondition }[c] || c);
  const getBadgeIcon = (b) => ({ newSeller: '🌟', risingSeller: '⭐', trustedSeller: '🏅', topSeller: '🏆', eliteSeller: '💎' }[b] || '🌟');
  const getBadgeLabel = (b) => ({ newSeller: t.newSeller, risingSeller: t.risingSeller, trustedSeller: t.trustedSeller, topSeller: t.topSeller, eliteSeller: t.eliteSeller }[b] || b);

  const ListingCard = ({ item }) => (
    <Card className="overflow-hidden" onClick={() => { setSelectedListing(item); setCurrentView('itemDetail'); }}>
      <div className="relative aspect-square">
        <img src={item.image} alt="" className="w-full h-full object-cover" />
        <button onClick={(e) => { e.stopPropagation(); toggleSaveItem(item); }} className={`absolute top-2 ${isRTL ? 'left-2' : 'right-2'} w-8 h-8 rounded-full flex items-center justify-center ${isItemSaved(item.id) ? 'bg-red-500' : 'bg-black/50'}`}><Heart className={`w-4 h-4 ${isItemSaved(item.id) ? 'fill-current' : ''}`} /></button>
      </div>
      <div className="p-3">
        <h3 className="font-medium text-sm truncate">{lang === 'he' && item.nameHebrew ? item.nameHebrew : item.name}</h3>
        <p className="text-lg font-bold text-green-400">{formatPrice(item.price)}</p>
        <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500"><span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{item.location}</span><span>{getTimeAgo(item.createdAt)}</span></div>
      </div>
    </Card>
  );

  return (
    <div className="min-h-screen text-white flex flex-col" style={{ fontFamily: isRTL ? "'Heebo', sans-serif" : "'Inter', sans-serif", background: '#0a0f1a' }} dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="fixed inset-0 pointer-events-none"><div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.15), transparent)' }} /></div>
      <div className="relative flex-1 max-w-md mx-auto w-full flex flex-col pb-20">
        <header className="px-5 pt-12 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => { resetApp(); setActiveTab('home'); }}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25"><DollarSign className="w-5 h-5" /></div>
            <div><h1 className="text-lg font-bold">{t.appName}</h1><p className="text-[9px] text-slate-500 uppercase">{t.appTagline}</p></div>
          </div>
          <button onClick={() => setLang(lang === 'en' ? 'he' : 'en')} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs"><Globe className="w-3.5 h-3.5 text-blue-400" />{lang === 'en' ? 'עב' : 'EN'}</button>
        </header>

        {error && <div className="mx-5 mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3"><AlertCircle className="w-4 h-4 text-red-400" /><p className="text-sm text-red-300 flex-1">{error}</p><button onClick={() => setError(null)}><X className="w-4 h-4 text-red-400" /></button></div>}

        {showSignInPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-5">
            <Card className="p-6 max-w-sm w-full text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto"><User className="w-7 h-7 text-blue-400" /></div>
              <h3 className="text-lg font-bold">{t.signInRequired}</h3>
              <p className="text-slate-400 text-sm">{signInPromptAction === 'save' ? t.signInToSave : signInPromptAction === 'contact' ? t.signInToContact : t.signInToListItem}</p>
              <div className="flex gap-3"><Button className="flex-1" onClick={() => { setShowSignInPrompt(false); setSignInPromptAction(null); }}>{t.cancel}</Button><Button primary className="flex-1" onClick={() => { setShowSignInPrompt(false); setActiveTab('profile'); setCurrentView('auth'); }}>{t.goToSignIn}</Button></div>
            </Card>
          </div>
        )}

        {showContactModal && selectedListing && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-md bg-[#0f1629] rounded-t-3xl p-5 space-y-4">
              <div className="w-12 h-1 bg-white/20 rounded-full mx-auto" />
              <h3 className="text-lg font-bold text-center">{t.contactSeller}</h3>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5">
                <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center text-lg font-bold">{selectedListing.seller?.name?.charAt(0)}</div>
                <div className="flex-1"><span className="font-medium">{selectedListing.seller?.name}</span><div className="text-xs text-slate-400">{getBadgeIcon(selectedListing.seller?.badge)} {getBadgeLabel(selectedListing.seller?.badge)}</div></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <a href={`tel:${selectedListing.seller?.phone}`} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-green-600 font-medium"><Phone className="w-5 h-5" />{t.callSeller}</a>
                <a href={`https://wa.me/972${selectedListing.seller?.phone?.replace(/^0/, '').replace(/-/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#25D366] font-medium"><MessageCircle className="w-5 h-5" />{t.whatsappSeller}</a>
              </div>
              <Button className="w-full" onClick={() => setShowContactModal(false)}>{t.cancel}</Button>
            </div>
          </div>
        )}

        <main className="flex-1 px-5 pb-4 overflow-y-auto">
          {currentView === 'home' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="text-center space-y-3 pt-4">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20"><Sparkles className="w-3.5 h-3.5 text-blue-400" /><span className="text-xs font-medium text-blue-300">{t.aiPowered}</span></div>
                <h2 className="text-3xl font-bold">{t.heroTitle1}<br/><span className="text-blue-400">{t.heroTitle2}</span></h2>
                <p className="text-slate-400 text-sm">{t.heroSubtitle}</p>
              </div>
              <div className={`rounded-xl ${dragActive ? 'border-blue-500/50 bg-blue-500/5' : 'border-white/10'}`} style={{ border: '2px dashed' }} onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} className="hidden" />
                <div className="p-8 text-center space-y-3"><div className="w-14 h-14 mx-auto rounded-xl bg-white/5 flex items-center justify-center"><ImagePlus className="w-6 h-6 text-slate-500" /></div><p className="text-slate-300 text-sm">{t.dropImageHere}</p><p className="text-slate-500 text-xs">{t.orUseButtons}</p></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={startCamera} className="py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 flex items-center justify-center gap-2 font-semibold text-sm"><Scan className="w-5 h-5" />{t.scan}</button>
                <button onClick={() => fileInputRef.current?.click()} className="py-3.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center gap-2 font-semibold text-sm"><Upload className="w-5 h-5" />{t.upload}</button>
              </div>
            </div>
          )}

          {currentView === 'camera' && (
            <div className="fixed inset-0 z-50 bg-black">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute bottom-0 inset-x-0 p-8 flex justify-center gap-6 bg-gradient-to-t from-black/90"><button onClick={stopCamera} className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center"><X className="w-6 h-6" /></button><button onClick={capturePhoto} className="rounded-full bg-blue-600 flex items-center justify-center" style={{width:'72px',height:'72px'}}><div className="w-14 h-14 rounded-full border-4 border-white/30" /></button><div className="w-14" /></div>
            </div>
          )}

          {currentView === 'analyzing' && (
            <div className="flex-1 flex flex-col items-center justify-center py-16">
              <div className="relative"><div className="absolute -inset-4 rounded-2xl bg-blue-500/20 blur-2xl animate-pulse" /><div className="relative w-40 h-40 rounded-2xl overflow-hidden border-2 border-blue-500/30">{uploadedImages[0] && <img src={uploadedImages[0]} alt="" className="w-full h-full object-cover" />}</div></div>
              <div className="mt-6 text-center"><div className="flex items-center justify-center gap-2"><Loader2 className="w-5 h-5 text-blue-400 animate-spin" /><span>{t.analyzing}</span></div></div>
            </div>
          )}

          {currentView === 'results' && analysisResult && (
            <div className="space-y-4 animate-fadeIn pb-4">
              <div className="relative"><div className="aspect-[4/3] rounded-xl overflow-hidden"><img src={uploadedImages[0]} alt="" className="w-full h-full object-cover" /><div className="absolute inset-0 bg-gradient-to-t from-[#0a0f1a] via-transparent" /></div><div className="absolute bottom-2 inset-x-2"><h2 className="text-lg font-bold">{lang === 'he' && analysisResult.nameHebrew ? analysisResult.nameHebrew : analysisResult.name}</h2></div></div>
              <Card className="p-4" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.1), rgba(59,130,246,0.02))', border: '1px solid rgba(59,130,246,0.2)' }}><div className="text-center"><p className="text-sm text-slate-400 mb-1">{t.marketValue}</p><p className="text-3xl font-bold text-blue-400">{formatPrice(analysisResult.marketValue?.mid)}</p>{analysisResult.marketValue?.low > 0 && <p className="text-xs text-slate-500 mt-1">{t.range}: {formatPrice(analysisResult.marketValue.low)} – {formatPrice(analysisResult.marketValue.high)}</p>}</div></Card>
              <div className="flex gap-3 pt-2"><Button primary className="flex-1" onClick={startListingFlow}><Plus className="w-4 h-4" />{t.listThisItem}</Button><Button><Share2 className="w-4 h-4" /></Button></div>
              <button onClick={resetApp} className="w-full py-2 text-slate-400 text-sm flex items-center justify-center gap-2"><Camera className="w-4 h-4" />{t.scanAnother}</button>
            </div>
          )}

          {currentView === 'browse' && !selectedListing && (
            <div className="space-y-4 animate-fadeIn">
              <div className="relative">
                <Search className={`absolute top-1/2 -translate-y-1/2 ${isRTL ? 'right-4' : 'left-4'} w-5 h-5 text-slate-500`} />
                <input type="text" placeholder={t.searchPlaceholder} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className={`w-full py-3 ${isRTL ? 'pr-12 pl-12' : 'pl-12 pr-12'} rounded-xl bg-white/5 border border-white/10 text-white`} dir={isRTL ? 'rtl' : 'ltr'} />
                <button onClick={() => setShowFilters(!showFilters)} className={`absolute top-1/2 -translate-y-1/2 ${isRTL ? 'left-3' : 'right-3'} p-1.5 rounded-lg ${showFilters ? 'bg-blue-600' : 'bg-white/10'}`}><SlidersHorizontal className="w-4 h-4" /></button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-5 px-5">{categories.map((cat) => <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} className={`flex-shrink-0 px-3 py-2 rounded-lg flex items-center gap-2 text-xs font-medium ${selectedCategory === cat.id ? 'bg-blue-600' : 'bg-white/5'}`}><cat.icon className="w-4 h-4" />{cat.label}</button>)}</div>
              {showFilters && <Card className="p-4 space-y-4"><div className="flex items-center justify-between"><h3 className="font-semibold">{t.filters}</h3><button onClick={() => { setPriceRange({ min: '', max: '' }); setSortBy('newest'); }} className="text-xs text-blue-400">{t.clearAll}</button></div><div className="space-y-2"><label className="text-sm text-slate-400">{t.priceRange}</label><div className="flex gap-3"><input type="number" placeholder={t.minPrice} value={priceRange.min} onChange={(e) => setPriceRange({ ...priceRange, min: e.target.value })} className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" /><span>-</span><input type="number" placeholder={t.maxPrice} value={priceRange.max} onChange={(e) => setPriceRange({ ...priceRange, max: e.target.value })} className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm" /></div></div><div className="grid grid-cols-2 gap-2">{[{ id: 'newest', label: t.newest }, { id: 'priceLowHigh', label: t.priceLowHigh }, { id: 'priceHighLow', label: t.priceHighLow }].map((opt) => <button key={opt.id} onClick={() => setSortBy(opt.id)} className={`py-2 px-3 rounded-lg text-xs font-medium ${sortBy === opt.id ? 'bg-blue-600' : 'bg-white/5'}`}>{opt.label}</button>)}</div></Card>}
              <p className="text-sm text-slate-400">{filteredListings.length} {t.results}</p>
              {filteredListings.length === 0 ? <div className="text-center py-12"><Search className="w-12 h-12 text-slate-600 mx-auto mb-3" /><p className="text-slate-400">{t.noResults}</p></div> : <div className="grid grid-cols-2 gap-3">{filteredListings.map((item) => <ListingCard key={item.id} item={item} />)}</div>}
            </div>
          )}

          {currentView === 'itemDetail' && selectedListing && (
            <div className="space-y-4 animate-fadeIn -mx-5 -mt-4">
              <div className="relative aspect-square"><img src={selectedListing.image} alt="" className="w-full h-full object-cover" /><button onClick={() => { setSelectedListing(null); setCurrentView('browse'); }} className={`absolute top-4 ${isRTL ? 'right-4' : 'left-4'} w-10 h-10 rounded-full bg-black/50 flex items-center justify-center`}>{isRTL ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}</button><button onClick={() => toggleSaveItem(selectedListing)} className={`absolute top-4 ${isRTL ? 'left-4' : 'right-4'} w-10 h-10 rounded-full flex items-center justify-center ${isItemSaved(selectedListing.id) ? 'bg-red-500' : 'bg-black/50'}`}><Heart className={`w-5 h-5 ${isItemSaved(selectedListing.id) ? 'fill-current' : ''}`} /></button></div>
              <div className="px-5 space-y-4">
                <div><h1 className="text-xl font-bold">{lang === 'he' && selectedListing.nameHebrew ? selectedListing.nameHebrew : selectedListing.name}</h1><p className="text-3xl font-bold text-green-400 mt-2">{formatPrice(selectedListing.price)}</p></div>
                {selectedListing.description && <Card className="p-4"><h3 className="font-semibold mb-2">{t.description}</h3><p className="text-sm text-slate-300">{selectedListing.description}</p></Card>}
                {selectedListing.seller && <Card className="p-4"><h3 className="font-semibold mb-3">{t.sellerInfo}</h3><div className="flex items-center gap-3"><div className="w-14 h-14 rounded-full bg-blue-500/20 flex items-center justify-center text-xl font-bold">{selectedListing.seller.name?.charAt(0)}</div><div className="flex-1"><span className="font-medium">{selectedListing.seller.name}</span><div className="text-xs text-slate-400">{getBadgeIcon(selectedListing.seller.badge)} {getBadgeLabel(selectedListing.seller.badge)} • ★ {selectedListing.seller.rating}</div></div></div></Card>}
                <div className="flex gap-3 pt-2 pb-4"><Button primary className="flex-1" onClick={() => handleContactSeller(selectedListing)}><MessageCircle className="w-4 h-4" />{t.contactSeller}</Button><Button onClick={() => toggleSaveItem(selectedListing)}><Heart className={`w-4 h-4 ${isItemSaved(selectedListing.id) ? 'fill-current text-red-400' : ''}`} /></Button></div>
              </div>
            </div>
          )}

          {currentView === 'favorites' && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold">{t.savedItems}</h2>
              {savedItems.length === 0 ? <div className="text-center py-12"><Heart className="w-12 h-12 text-slate-600 mx-auto mb-3" /><p className="text-slate-400">{t.noSavedItems}</p><Button primary className="mt-4" onClick={() => handleTabChange('browse')}><Search className="w-4 h-4" />{t.browse}</Button></div> : <div className="grid grid-cols-2 gap-3">{savedItems.map((item) => <ListingCard key={item.id} item={item} />)}</div>}
            </div>
          )}

          {currentView === 'auth' && (
            <div className="space-y-5 animate-fadeIn pt-4">
              <div className="text-center"><h2 className="text-xl font-bold">{authView === 'login' ? t.welcomeBack : t.createAccount}</h2><p className="text-slate-400 text-sm">{authView === 'login' ? t.signInAccess : t.joinGetWorth}</p></div>
              <div className="space-y-2.5">
                <button onClick={() => handleSocialLogin('Google')} className="w-full py-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center gap-3 hover:bg-white/10 text-sm"><svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>{t.continueWithGoogle}</button>
                <button onClick={() => handleSocialLogin('Apple')} className="w-full py-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center gap-3 hover:bg-white/10 text-sm"><svg className="w-5 h-5" fill="white" viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>{t.continueWithApple}</button>
              </div>
              <div className="flex items-center gap-4"><div className="flex-1 h-px bg-white/10" /><span className="text-xs text-slate-500">{t.or}</span><div className="flex-1 h-px bg-white/10" /></div>
              <form onSubmit={handleLogin} className="space-y-3">
                {authView === 'signup' && <Input label={t.fullName} value={authForm.name} onChange={(e) => setAuthForm({...authForm, name: e.target.value})} />}
                <Input label={t.email} type="email" placeholder="email@example.com" value={authForm.email} onChange={(e) => setAuthForm({...authForm, email: e.target.value})} required />
                <Input label={t.password} type="password" placeholder="••••••••" value={authForm.password} onChange={(e) => setAuthForm({...authForm, password: e.target.value})} required />
                <Button primary className="w-full">{authView === 'login' ? t.signIn : t.signUp}</Button>
              </form>
              <p className="text-center text-sm text-slate-400">{authView === 'login' ? t.noAccount : t.haveAccount}{' '}<button onClick={() => setAuthView(authView === 'login' ? 'signup' : 'login')} className="text-blue-400">{authView === 'login' ? t.signUp : t.signIn}</button></p>
            </div>
          )}

          {currentView === 'profile' && isLoggedIn && (
            <div className="space-y-5 animate-fadeIn">
              <Card className="p-4"><div className="flex items-center gap-4"><div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-xl font-bold">{user?.name?.charAt(0).toUpperCase()}</div><div className="flex-1"><h3 className="font-semibold">{user?.name}</h3><p className="text-xs text-slate-400">{user?.email}</p></div><button onClick={handleLogout} className="p-2"><LogOut className="w-4 h-4 text-slate-400" /></button></div></Card>
              <div className="grid grid-cols-3 gap-2">
                <Card className="p-3 text-center"><p className="text-xl font-bold text-blue-400">{userListings.length}</p><p className="text-[10px] text-slate-500">{t.myListings}</p></Card>
                <Card className="p-3 text-center"><p className="text-xl font-bold text-green-400">{sellerStats.sales}</p><p className="text-[10px] text-slate-500">{t.sales}</p></Card>
                <Card className="p-3 text-center"><p className="text-xl font-bold text-red-400">{savedItems.length}</p><p className="text-[10px] text-slate-500">{t.saved}</p></Card>
              </div>
            </div>
          )}

          {currentView === 'myListings' && (
            <div className="space-y-4 animate-fadeIn">
              <h2 className="text-lg font-bold">{t.myListings}</h2>
              {userListings.length === 0 ? <Card className="p-8 text-center"><ShoppingBag className="w-10 h-10 text-slate-600 mx-auto mb-3" /><p className="text-slate-400 text-sm">{t.noListingsYet}</p><Button primary className="mt-4" onClick={() => { setActiveTab('home'); setCurrentView('home'); }}><Scan className="w-4 h-4" />{t.scan}</Button></Card> : <div className="space-y-3">{userListings.map((item) => <Card key={item.id} className="p-3"><div className="flex gap-3"><div className="w-20 h-20 rounded-lg overflow-hidden"><img src={item.image} alt="" className="w-full h-full object-cover" /></div><div className="flex-1"><h3 className="font-medium text-sm">{item.title || item.name}</h3><p className="text-lg font-bold text-green-400">{formatPrice(item.price)}</p><p className="text-xs text-slate-500">{getTimeAgo(item.createdAt)}</p></div></div></Card>)}</div>}
            </div>
          )}

          {currentView === 'listing' && analysisResult && (
            <div className="space-y-4 animate-fadeIn">
              {listingStep === 0 && (
                <>
                  <BackButton onClick={() => setCurrentView('results')} />
                  <div className="text-center"><h2 className="text-lg font-bold">{t.selectCondition}</h2></div>
                  <div className="space-y-2">
                    {[{ id: 'newSealed', label: t.newSealed, desc: t.newSealedDesc, discount: 0, icon: Box },{ id: 'likeNew', label: t.likeNew, desc: t.likeNewDesc, discount: 15, icon: Sparkles },{ id: 'used', label: t.used, desc: t.usedDesc, discount: '25-35', icon: Package },{ id: 'poorCondition', label: t.poorCondition, desc: t.poorConditionDesc, discount: 70, icon: AlertTriangle }].map((cond) => (
                      <button key={cond.id} onClick={() => handleConditionSelect(cond.id)} className={`w-full p-3 rounded-xl text-${isRTL ? 'right' : 'left'} border ${selectedCondition === cond.id ? 'border-blue-500 bg-blue-500/10' : 'border-white/10 bg-white/5'}`}>
                        <div className="flex items-center gap-3"><div className={`w-10 h-10 rounded-lg flex items-center justify-center ${selectedCondition === cond.id ? 'bg-blue-500' : 'bg-white/10'}`}><cond.icon className="w-5 h-5" /></div><div className="flex-1"><div className="flex items-center justify-between"><span className="font-medium text-sm">{cond.label}</span><span className={`text-xs ${cond.discount === 0 ? 'text-green-400' : 'text-orange-400'}`}>{cond.discount === 0 ? '100%' : `-${cond.discount}%`}</span></div><p className="text-[11px] text-slate-400">{cond.desc}</p></div>{selectedCondition === cond.id ? <CheckCircle className="w-5 h-5 text-blue-400" /> : <Circle className="w-5 h-5 text-slate-600" />}</div>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {listingStep === 1 && (
                <>
                  <BackButton onClick={() => setListingStep(0)} />
                  <div className="text-center"><h2 className="text-lg font-bold">{t.tellUsMore}</h2></div>
                  <div className="space-y-3">
                    <Card className="p-3"><p className="text-sm font-medium mb-2">{t.cosmeticDamage}</p><div className="flex gap-2">{['yes','no'].map(o => <OptionButton key={o} selected={followUpAnswers.cosmeticDamage === o} onClick={() => setFollowUpAnswers({...followUpAnswers, cosmeticDamage: o})} className="flex-1">{t[o]}</OptionButton>)}</div></Card>
                    <Card className="p-3"><p className="text-sm font-medium mb-2">{t.batteryHealth}</p><div className="flex gap-2">{['good','degraded','poor'].map(o => <OptionButton key={o} selected={followUpAnswers.batteryHealth === o} onClick={() => setFollowUpAnswers({...followUpAnswers, batteryHealth: o})} className="flex-1">{t[o]}</OptionButton>)}</div></Card>
                    <Card className="p-3"><p className="text-sm font-medium mb-2">{t.functionalIssues}</p><div className="flex gap-2">{['yes','no'].map(o => <OptionButton key={o} selected={followUpAnswers.functionalIssues === o} onClick={() => setFollowUpAnswers({...followUpAnswers, functionalIssues: o})} className="flex-1">{t[o]}</OptionButton>)}</div></Card>
                  </div>
                  <Card className="p-3 text-center" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.1), rgba(34,197,94,0.02))', border: '1px solid rgba(34,197,94,0.3)' }}><p className="text-xs text-slate-400">{t.yourPrice}</p><p className="text-2xl font-bold text-green-400">{formatPrice(calculateFinalPrice(analysisResult?.marketValue?.mid, 'used', followUpAnswers))}</p></Card>
                  <Button primary className="w-full" onClick={() => { setListingData(prev => ({ ...prev, price: calculateFinalPrice(analysisResult?.marketValue?.mid, 'used', followUpAnswers) })); setListingStep(2); }}>{t.continueBtn}</Button>
                </>
              )}
              {listingStep === 2 && (
                <>
                  <BackButton onClick={() => setListingStep(selectedCondition === 'used' ? 1 : 0)} />
                  <div className="text-center"><h2 className="text-lg font-bold">{t.reviewListing}</h2></div>
                  <Input label={t.listingTitle} value={listingData.title} onChange={(e) => setListingData({...listingData, title: e.target.value})} />
                  <Card className="p-4"><div className="flex items-center justify-between mb-2"><span className="text-sm text-slate-400">{t.yourAskingPrice}</span></div><div className="flex items-center gap-3"><span className="text-2xl font-bold">₪</span><input type="number" className="flex-1 bg-transparent text-2xl font-bold focus:outline-none" value={listingData.price} onChange={(e) => setListingData({...listingData, price: parseInt(e.target.value) || 0})} /></div></Card>
                  <Input label={t.location} placeholder={t.addLocation} value={listingData.location} onChange={(e) => setListingData({...listingData, location: e.target.value})} />
                  <Button primary className="w-full py-4" onClick={publishListing} disabled={isPublishing}>{isPublishing ? <><Loader2 className="w-4 h-4 animate-spin" />{t.publishing}</> : <><Check className="w-4 h-4" />{t.publishListing}</>}</Button>
                </>
              )}
              {listingStep === 3 && (
                <div className="text-center py-8 space-y-6">
                  <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto"><CheckCircle className="w-10 h-10 text-green-400" /></div>
                  <div><h2 className="text-2xl font-bold text-green-400">{t.listingPublished}</h2><p className="text-slate-400">{t.listingLive}</p></div>
                  <div className="flex gap-3"><Button className="flex-1" onClick={() => { setActiveTab('sell'); setCurrentView('myListings'); resetApp(); }}><Eye className="w-4 h-4" />{t.viewListings}</Button><Button primary className="flex-1"><Share2 className="w-4 h-4" />{t.shareNow}</Button></div>
                </div>
              )}
            </div>
          )}
        </main>

        <nav className="fixed bottom-0 left-0 right-0 bg-[#0a0f1a]/95 backdrop-blur-lg border-t border-white/10 z-40">
          <div className="max-w-md mx-auto flex">
            {[{ id: 'home', icon: Home, label: t.home },{ id: 'browse', icon: Search, label: t.browse },{ id: 'sell', icon: ShoppingBag, label: t.sell },{ id: 'favorites', icon: Heart, label: t.favorites },{ id: 'profile', icon: User, label: t.profile }].map((tab) => (
              <button key={tab.id} onClick={() => handleTabChange(tab.id)} className={`flex-1 py-3 flex flex-col items-center gap-0.5 relative ${activeTab === tab.id ? 'text-blue-400' : 'text-slate-500'}`}>
                <tab.icon className={`w-5 h-5 ${tab.id === 'favorites' && savedItems.length > 0 ? 'text-red-400' : ''}`} />
                <span className="text-[10px] font-medium">{tab.label}</span>
                {tab.id === 'sell' && userListings.length > 0 && <span className="absolute top-1 right-1/4 w-4 h-4 rounded-full bg-blue-500 text-[9px] flex items-center justify-center">{userListings.length}</span>}
                {tab.id === 'favorites' && savedItems.length > 0 && <span className="absolute top-1 right-1/4 w-4 h-4 rounded-full bg-red-500 text-[9px] flex items-center justify-center">{savedItems.length}</span>}
              </button>
            ))}
          </div>
        </nav>
      </div>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}.animate-fadeIn{animation:fadeIn .3s ease-out}`}</style>
    </div>
  );
}
