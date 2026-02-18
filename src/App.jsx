import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Camera, Upload, X, Sparkles, DollarSign, Package, Smartphone, Watch, ChevronRight, ChevronLeft, Loader2, ImagePlus, Share2, AlertCircle, Shirt, Dumbbell, Scan, User, LogOut, Plus, Trash2, Clock, Globe, Home, ShoppingBag, CheckCircle, Circle, Box, Shield, AlertTriangle, Eye, MessageCircle, Phone, Check, MapPin, Search, SlidersHorizontal, Heart, Grid, RefreshCw, Star, Zap, TrendingUp, Send, Navigation, LocateFixed, Volume2, VolumeX } from 'lucide-react';
import { supabase } from './lib/supabase';

// Sound Effects using Web Audio API (no external files needed)
const SoundEffects = {
  audioContext: null,
  
  getContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this.audioContext;
  },
  
  // Camera shutter sound
  shutter() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      
      // First click (mechanical sound)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'square';
      osc1.frequency.setValueAtTime(1800, now);
      osc1.frequency.exponentialRampToValueAtTime(400, now + 0.03);
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.03);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.03);
      
      // Second click (shutter close)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'square';
      osc2.frequency.setValueAtTime(1200, now + 0.05);
      osc2.frequency.exponentialRampToValueAtTime(300, now + 0.08);
      gain2.gain.setValueAtTime(0.2, now + 0.05);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.05);
      osc2.stop(now + 0.1);
      
      // White noise burst for realism
      const bufferSize = ctx.sampleRate * 0.02;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.1;
      }
      const noise = ctx.createBufferSource();
      const noiseGain = ctx.createGain();
      noise.buffer = buffer;
      noiseGain.gain.setValueAtTime(0.15, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.02);
      noise.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noise.start(now);
    } catch (e) { console.log('Sound error:', e); }
  },
  
  // Success chime (for completed analysis & published)
  success() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      
      // Three ascending notes
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        gain.gain.setValueAtTime(0, now + i * 0.1);
        gain.gain.linearRampToValueAtTime(0.2, now + i * 0.1 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.25);
      });
    } catch (e) { console.log('Sound error:', e); }
  },
  
  // Coin/cha-ching sound (for listing published)
  coin() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      
      // High metallic ding
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(2637, now); // E7
      osc1.frequency.setValueAtTime(3136, now + 0.08); // G7
      gain1.gain.setValueAtTime(0.25, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.4);
      
      // Harmonic
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(5274, now); // E8
      gain2.gain.setValueAtTime(0.1, now);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now);
      osc2.stop(now + 0.2);
    } catch (e) { console.log('Sound error:', e); }
  },
  
  // Tap/click sound (for buttons)
  tap() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.05);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) { console.log('Sound error:', e); }
  },

  // Error/fail sound
  error() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      
      // Two descending notes
      const notes = [349.23, 261.63]; // F4, C4
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.15);
        gain.gain.setValueAtTime(0.2, now + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.15 + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.15);
        osc.stop(now + i * 0.15 + 0.25);
      });
    } catch (e) { console.log('Sound error:', e); }
  }
};

const T = {
  en: { appName: "GetWorth", tagline: "AI Valuation", aiPowered: "AI-Powered", heroTitle1: "Know Your", heroTitle2: "Item's Value", heroSub: "Snap or upload any item for instant AI valuation.", drop: "Drop image here", orButtons: "or use buttons below", scan: "Scan", upload: "Upload", analyzing: "Analyzing...", marketValue: "Market Value", range: "Range", listItem: "List This Item", scanAnother: "Scan Another", welcome: "Welcome back", createAcc: "Create account", signInAccess: "Sign in to access", join: "Join GetWorth", google: "Continue with Google", or: "or", name: "Full Name", email: "Email", password: "Password", signIn: "Sign In", signUp: "Sign Up", noAcc: "No account?", haveAcc: "Have account?", back: "Back", myListings: "My Listings", noListings: "No listings yet", home: "Home", browse: "Browse", sell: "Sell", saved: "Saved", profile: "Profile", condition: "Select Condition", newSealed: "New", likeNew: "Like New", used: "Used", poor: "Poor", yourPrice: "Your Price", more: "Tell Us More", scratches: "Scratches?", battery: "Battery?", issues: "Issues?", yes: "Yes", no: "No", good: "Good", degraded: "Degraded", continue: "Continue", review: "Review Listing", title: "Title", desc: "Description", phone: "Phone", location: "Location", publish: "Publish", publishing: "Publishing...", published: "Listed!", live: "Your item is live", view: "View", share: "Share", seller: "Seller", contact: "Contact", call: "Call", whatsapp: "WhatsApp", today: "today", yesterday: "yesterday", daysAgo: "d ago", noSaved: "No saved items", signInReq: "Sign In Required", signInSave: "Sign in to save", signInContact: "Sign in to contact", signInList: "Sign in to list", cancel: "Cancel", all: "All", phones: "Phones", watches: "Watches", clothing: "Clothing", furniture: "Furniture", sports: "Sports", filters: "Filters", clear: "Clear", min: "Min", max: "Max", results: "results", newest: "Newest", lowHigh: "Low-High", highLow: "High-Low", noResults: "No items found", failed: "Analysis failed", cameraDenied: "Camera access denied", verified: "Verified", views: "views", sales: "Sales", reviews: "Reviews", writeReview: "Write a Review", noReviews: "No reviews yet", beFirst: "Be the first to review this seller", yourRating: "Your Rating", reviewPlaceholder: "Share your experience with this seller...", submitReview: "Submit Review", submitting: "Submitting...", reviewSuccess: "Review submitted!", seeAllReviews: "See all reviews", helpful: "Helpful", overallRating: "Overall Rating", basedOn: "based on", receivedReviews: "Reviews Received", responseRate: "Response Rate" },
  he: { appName: "GetWorth", tagline: "הערכת שווי", aiPowered: "AI", heroTitle1: "גלה את", heroTitle2: "שווי הפריט", heroSub: "צלם או העלה תמונה לקבלת הערכה.", drop: "גרור תמונה", orButtons: "או לחץ למטה", scan: "סרוק", upload: "העלה", analyzing: "מנתח...", marketValue: "שווי שוק", range: "טווח", listItem: "פרסם", scanAnother: "סרוק עוד", welcome: "שלום", createAcc: "צור חשבון", signInAccess: "התחבר", join: "הצטרף", google: "המשך עם Google", or: "או", name: "שם", email: "אימייל", password: "סיסמה", signIn: "התחבר", signUp: "הירשם", noAcc: "אין חשבון?", haveAcc: "יש חשבון?", back: "חזור", myListings: "המודעות שלי", noListings: "אין מודעות", home: "בית", browse: "חיפוש", sell: "מכירה", saved: "שמורים", profile: "פרופיל", condition: "בחר מצב", newSealed: "חדש", likeNew: "כמו חדש", used: "משומש", poor: "גרוע", yourPrice: "מחיר", more: "פרטים נוספים", scratches: "שריטות?", battery: "סוללה?", issues: "בעיות?", yes: "כן", no: "לא", good: "טוב", degraded: "בינוני", continue: "המשך", review: "סקירה", title: "כותרת", desc: "תיאור", phone: "טלפון", location: "מיקום", publish: "פרסם", publishing: "מפרסם...", published: "פורסם!", live: "המודעה באוויר", view: "צפה", share: "שתף", seller: "מוכר", contact: "צור קשר", call: "התקשר", whatsapp: "וואטסאפ", today: "היום", yesterday: "אתמול", daysAgo: "ימים", noSaved: "אין שמורים", signInReq: "נדרשת התחברות", signInSave: "התחבר לשמירה", signInContact: "התחבר ליצירת קשר", signInList: "התחבר לפרסום", cancel: "ביטול", all: "הכל", phones: "טלפונים", watches: "שעונים", clothing: "ביגוד", furniture: "ריהוט", sports: "ספורט", filters: "סינון", clear: "נקה", min: "מינ׳", max: "מקס׳", results: "תוצאות", newest: "חדש", lowHigh: "מחיר ↑", highLow: "מחיר ↓", noResults: "לא נמצאו פריטים", failed: "הניתוח נכשל", cameraDenied: "הגישה למצלמה נדחתה", verified: "מאומת", views: "צפיות", sales: "מכירות", reviews: "ביקורות", writeReview: "כתוב ביקורת", noReviews: "אין ביקורות עדיין", beFirst: "היה הראשון לדרג מוכר זה", yourRating: "הדירוג שלך", reviewPlaceholder: "שתף את החוויה שלך עם מוכר זה...", submitReview: "שלח ביקורת", submitting: "שולח...", reviewSuccess: "הביקורת נשלחה!", seeAllReviews: "ראה את כל הביקורות", helpful: "מועיל", overallRating: "דירוג כללי", basedOn: "מבוסס על", receivedReviews: "ביקורות שהתקבלו", responseRate: "אחוז תגובה" }
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

// InputField moved outside component to prevent re-creation on every render
const InputField = ({ label, icon: Icon, rtl, ...p }) => (
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

// LocationInput with GPS support
const LocationInput = ({ label, value, onChange, rtl, placeholder }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const getLocation = async () => {
    if (!navigator.geolocation) {
      setError(rtl ? 'הדפדפן לא תומך במיקום' : 'Geolocation not supported');
      return;
    }

    setLoading(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          // Reverse geocode using free OpenStreetMap Nominatim API
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=14&addressdetails=1`,
            { headers: { 'Accept-Language': rtl ? 'he' : 'en' } }
          );
          const data = await response.json();
          
          // Extract city/town name
          const city = data.address?.city || data.address?.town || data.address?.village || data.address?.suburb || data.address?.municipality || '';
          const area = data.address?.state || data.address?.county || '';
          const locationName = city || area || (rtl ? 'מיקום נמצא' : 'Location found');
          
          onChange({ target: { value: locationName } });
        } catch (e) {
          setError(rtl ? 'שגיאה בזיהוי מיקום' : 'Failed to get location');
        }
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setError(rtl ? 'הגישה למיקום נדחתה' : 'Location access denied');
            break;
          case err.POSITION_UNAVAILABLE:
            setError(rtl ? 'מיקום לא זמין' : 'Location unavailable');
            break;
          case err.TIMEOUT:
            setError(rtl ? 'הזמן הקצוב פג' : 'Request timeout');
            break;
          default:
            setError(rtl ? 'שגיאה בזיהוי מיקום' : 'Failed to get location');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  return (
    <div className="space-y-2">
      {label && <label className="text-sm text-slate-400 font-medium">{label}</label>}
      <div className="relative">
        <MapPin className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'right-4' : 'left-4'} w-5 h-5 text-slate-500`} />
        <input 
          className={`w-full px-4 py-4 ${rtl ? 'pr-12 pl-14' : 'pl-12 pr-14'} rounded-2xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all`}
          dir={rtl ? 'rtl' : 'ltr'}
          value={value}
          onChange={onChange}
          placeholder={placeholder || (rtl ? 'הכנס מיקום' : 'Enter location')}
        />
        <button
          type="button"
          onClick={getLocation}
          disabled={loading}
          className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'left-3' : 'right-3'} w-9 h-9 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 flex items-center justify-center transition-all active:scale-95 disabled:opacity-50`}
          title={rtl ? 'השתמש במיקום נוכחי' : 'Use current location'}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
          ) : (
            <LocateFixed className="w-4 h-4 text-blue-400" />
          )}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />{error}
        </p>
      )}
    </div>
  );
};

// Sample items for home page showcase (demo purposes)
const SAMPLE_ITEMS = [
  { id: 's1', title: 'PlayStation 5', title_hebrew: 'פלייסטיישן 5', price: 1800, condition: 'likeNew', location: 'Tel Aviv', description: 'PS5 Digital Edition, barely used. Comes with 2 controllers and 3 games. Perfect condition, selling because upgrading to Pro.', description_hebrew: 'PS5 דיגיטלי, כמעט לא בשימוש. מגיע עם 2 שלטים ו-3 משחקים. מצב מושלם.', views: 245, created_at: new Date(Date.now() - 2*24*60*60*1000).toISOString(), seller: { full_name: 'David Cohen', badge: 'trustedSeller', rating: 4.8, is_verified: true, total_sales: 23 }, images: ['https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=400&q=80'], contact_phone: '050-1234567' },
  { id: 's2', title: 'Rolex Submariner', title_hebrew: 'רולקס סאבמרינר', price: 45000, condition: 'used', location: 'Herzliya', description: 'Authentic Rolex Submariner Date, 2019 model. Full set with box and papers. Recently serviced.', description_hebrew: 'רולקס סאבמרינר מקורי, דגם 2019. סט מלא עם קופסה ותעודות.', views: 892, created_at: new Date(Date.now() - 5*24*60*60*1000).toISOString(), seller: { full_name: 'Michael Levy', badge: 'eliteSeller', rating: 4.9, is_verified: true, total_sales: 156 }, images: ['https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80'], contact_phone: '052-9876543' },
  { id: 's3', title: 'Dior Sauvage Perfume', title_hebrew: 'בושם דיור סוואג׳', price: 350, condition: 'newSealed', location: 'Ramat Gan', description: 'Brand new sealed Dior Sauvage EDP 100ml. Got as gift, already have one.', description_hebrew: 'דיור סוואג׳ חדש באריזה סגורה 100 מ״ל. קיבלתי במתנה, כבר יש לי.', views: 67, created_at: new Date(Date.now() - 1*24*60*60*1000).toISOString(), seller: { full_name: 'Sarah Israeli', badge: 'newSeller', rating: 5.0, is_verified: false, total_sales: 2 }, images: ['https://images.unsplash.com/photo-1541643600914-78b084683601?w=400&q=80'], contact_phone: '054-5551234' },
  { id: 's4', title: 'Electric Bicycle', title_hebrew: 'אופניים חשמליים', price: 4500, condition: 'used', location: 'Haifa', description: 'Xiaomi Mi Electric Scooter Pro 2. 45km range, top speed 25km/h. Minor scratches but works perfectly.', description_hebrew: 'קורקינט חשמלי שיאומי פרו 2. טווח 45 ק״מ. שריטות קלות אבל עובד מצוין.', views: 312, created_at: new Date(Date.now() - 3*24*60*60*1000).toISOString(), seller: { full_name: 'Yossi Mizrahi', badge: 'trustedSeller', rating: 4.6, is_verified: true, total_sales: 18 }, images: ['https://images.unsplash.com/photo-1571068316344-75bc76f77890?w=400&q=80'], contact_phone: '050-7778899' },
  { id: 's5', title: 'MacBook Pro M3', title_hebrew: 'מקבוק פרו M3', price: 8500, condition: 'likeNew', location: 'Tel Aviv', description: 'MacBook Pro 14" M3 Pro, 18GB RAM, 512GB SSD. AppleCare+ until 2026. Like new condition.', description_hebrew: 'מקבוק פרו 14 אינץ׳ M3 פרו. AppleCare עד 2026. מצב כמו חדש.', views: 534, created_at: new Date(Date.now() - 4*24*60*60*1000).toISOString(), seller: { full_name: 'Noa Shapira', badge: 'topSeller', rating: 4.9, is_verified: true, total_sales: 67 }, images: ['https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400&q=80'], contact_phone: '053-1112233' },
  { id: 's6', title: 'Dining Table Oak', title_hebrew: 'שולחן אוכל אלון', price: 2800, condition: 'used', location: 'Netanya', description: 'Solid oak dining table, seats 6-8 people. Some minor wear but very sturdy. Moving sale!', description_hebrew: 'שולחן אוכל אלון מלא, 6-8 סועדים. בלאי קל אבל יציב מאוד. מכירת מעבר דירה!', views: 156, created_at: new Date(Date.now() - 7*24*60*60*1000).toISOString(), seller: { full_name: 'Amit Goldstein', badge: 'newSeller', rating: 4.5, is_verified: false, total_sales: 5 }, images: ['https://images.unsplash.com/photo-1617806118233-18e1de247200?w=400&q=80'], contact_phone: '058-4445566' },
  { id: 's7', title: 'iPhone 15 Pro Max', title_hebrew: 'אייפון 15 פרו מקס', price: 4200, condition: 'newSealed', location: 'Jerusalem', description: 'iPhone 15 Pro Max 256GB Natural Titanium. New sealed in box. Israeli warranty.', description_hebrew: 'אייפון 15 פרו מקס 256GB טיטניום. חדש באריזה סגורה. אחריות ישראלית.', views: 723, created_at: new Date(Date.now() - 1*24*60*60*1000).toISOString(), seller: { full_name: 'Oren Azulay', badge: 'eliteSeller', rating: 5.0, is_verified: true, total_sales: 234 }, images: ['https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=400&q=80'], contact_phone: '052-8889900' },
  { id: 's8', title: 'Nike Air Jordan 1', title_hebrew: 'נייק אייר ג׳ורדן 1', price: 890, condition: 'newSealed', location: 'Rishon LeZion', description: 'Air Jordan 1 Retro High OG "Chicago" Size 42. Deadstock, never worn. Receipt available.', description_hebrew: 'אייר ג׳ורדן 1 רטרו שיקגו מידה 42. חדש לגמרי, מעולם לא נלבש.', views: 445, created_at: new Date(Date.now() - 2*24*60*60*1000).toISOString(), seller: { full_name: 'Maya Peretz', badge: 'trustedSeller', rating: 4.7, is_verified: true, total_sales: 31 }, images: ['https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&q=80'], contact_phone: '054-2223344' },
  { id: 's9', title: 'Sony 65" 4K TV', title_hebrew: 'טלוויזיה סוני 65 אינץ׳', price: 3200, condition: 'likeNew', location: 'Ashdod', description: 'Sony Bravia XR 65" 4K OLED TV. Stunning picture quality. 1 year old, selling due to relocation.', description_hebrew: 'טלוויזיית סוני בראביה 65 אינץ׳ OLED 4K. איכות תמונה מדהימה. בת שנה.', views: 287, created_at: new Date(Date.now() - 6*24*60*60*1000).toISOString(), seller: { full_name: 'Eli Biton', badge: 'trustedSeller', rating: 4.8, is_verified: true, total_sales: 42 }, images: ['https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?w=400&q=80'], contact_phone: '050-6667788' },
  { id: 's10', title: 'DJI Mavic 3 Drone', title_hebrew: 'רחפן DJI מאוויק 3', price: 5500, condition: 'used', location: 'Beer Sheva', description: 'DJI Mavic 3 Fly More Combo. 15 flight hours. Includes extra batteries and ND filters.', description_hebrew: 'DJI מאוויק 3 קומבו. 15 שעות טיסה. כולל סוללות נוספות ופילטרים.', views: 198, created_at: new Date(Date.now() - 4*24*60*60*1000).toISOString(), seller: { full_name: 'Tal Amir', badge: 'topSeller', rating: 4.9, is_verified: true, total_sales: 89 }, images: ['https://images.unsplash.com/photo-1473968512647-3e447244af8f?w=400&q=80'], contact_phone: '053-9990011' },
  { id: 's11', title: 'Leather Sofa', title_hebrew: 'ספה עור', price: 4800, condition: 'used', location: 'Petah Tikva', description: 'Italian leather 3-seater sofa in cognac brown. Very comfortable. Some patina adds character.', description_hebrew: 'ספת עור איטלקי 3 מושבים בצבע קוניאק. נוחה מאוד. פטינה מוסיפה אופי.', views: 134, created_at: new Date(Date.now() - 8*24*60*60*1000).toISOString(), seller: { full_name: 'Dana Katz', badge: 'newSeller', rating: 4.3, is_verified: false, total_sales: 3 }, images: ['https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=400&q=80'], contact_phone: '058-1234567' },
  { id: 's12', title: 'Canon EOS R5', title_hebrew: 'מצלמת קנון R5', price: 12000, condition: 'likeNew', location: 'Tel Aviv', description: 'Canon EOS R5 body with 24-105mm f/4L lens. Low shutter count (5k). Perfect for professionals.', description_hebrew: 'Canon EOS R5 גוף עם עדשה 24-105. ספירת שאטר נמוכה. מושלם לצלמים מקצועיים.', views: 412, created_at: new Date(Date.now() - 3*24*60*60*1000).toISOString(), seller: { full_name: 'Ran Levi', badge: 'eliteSeller', rating: 5.0, is_verified: true, total_sales: 178 }, images: ['https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=400&q=80'], contact_phone: '052-3334455' },
];

// ========== REVIEWS DATA & COMPONENTS ==========
const SAMPLE_REVIEWS = {
  'David Cohen': [
    { id: 'r1', reviewer: 'Alon Bar', rating: 5, text: 'Excellent seller! PS5 was exactly as described.', text_he: 'מוכר מעולה! ה-PS5 היה בדיוק כמו שתואר.', date: new Date(Date.now() - 10*86400000), verified: true, helpful: 8, item: 'PlayStation 5' },
    { id: 'r2', reviewer: 'Liat Avraham', rating: 5, text: 'Smooth transaction. Item was packed carefully.', text_he: 'עסקה חלקה. הפריט נארז בקפידה.', date: new Date(Date.now() - 25*86400000), verified: true, helpful: 5, item: 'Headphones' },
    { id: 'r3', reviewer: 'Noam Koren', rating: 4, text: 'Good seller. Slight delay but overall positive.', text_he: 'מוכר טוב. עיכוב קל אבל בסך הכל חיובי.', date: new Date(Date.now() - 40*86400000), verified: true, helpful: 3, item: 'Monitor' },
  ],
  'Michael Levy': [
    { id: 'r4', reviewer: 'Yael Stern', rating: 5, text: 'Authentication was legit, super professional.', text_he: 'האימות היה לגיטימי, מקצועי ברמה גבוהה.', date: new Date(Date.now() - 5*86400000), verified: true, helpful: 15, item: 'Omega Seamaster' },
    { id: 'r5', reviewer: 'Ron Dahan', rating: 5, text: 'Best seller on the platform. Quick and honest.', text_he: 'המוכר הכי טוב בפלטפורמה. מהיר וישר.', date: new Date(Date.now() - 15*86400000), verified: true, helpful: 22, item: 'Rolex Datejust' },
    { id: 'r6', reviewer: 'Sivan Gold', rating: 5, text: 'Watch arrived with full paperwork. Recommended.', text_he: 'השעון הגיע עם כל המסמכים. מומלץ.', date: new Date(Date.now() - 30*86400000), verified: true, helpful: 18, item: 'Tag Heuer' },
    { id: 'r7', reviewer: 'Ido Harel', rating: 4, text: 'Professional. Tiny mark not mentioned but offered discount.', text_he: 'מקצועי. סימן קטן שלא הוזכר אבל הציע הנחה.', date: new Date(Date.now() - 45*86400000), verified: true, helpful: 9, item: 'Breitling' },
  ],
  'Noa Shapira': [
    { id: 'r9', reviewer: 'Erez Tal', rating: 5, text: 'MacBook was perfect. Noa helped me set it up!', text_he: 'המקבוק היה מושלם. נועה עזרה לי להגדיר!', date: new Date(Date.now() - 8*86400000), verified: true, helpful: 7, item: 'MacBook Pro' },
    { id: 'r10', reviewer: 'Dina Shapiro', rating: 5, text: 'Super communicative and honest. Top seller.', text_he: 'מאוד תקשורתית וכנה. מוכרת מובילה.', date: new Date(Date.now() - 20*86400000), verified: true, helpful: 6, item: 'iPad Air' },
    { id: 'r11', reviewer: 'Gal Maor', rating: 4, text: 'Good experience. Well packaged and as described.', text_he: 'חוויה טובה. ארוז היטב וכמתואר.', date: new Date(Date.now() - 35*86400000), verified: false, helpful: 2, item: 'AirPods Pro' },
  ],
  'Oren Azulay': [
    { id: 'r12', reviewer: 'Tali Cohen', rating: 5, text: 'iPhone sealed and original. The real deal!', text_he: 'אייפון סגור ומקורי. העניין האמיתי!', date: new Date(Date.now() - 3*86400000), verified: true, helpful: 12, item: 'iPhone 15 Pro' },
    { id: 'r13', reviewer: 'Amit Levy', rating: 5, text: 'Best prices for sealed products. Fast delivery.', text_he: 'המחירים הטובים ביותר למוצרים סגורים. משלוח מהיר.', date: new Date(Date.now() - 12*86400000), verified: true, helpful: 25, item: 'Samsung Galaxy' },
    { id: 'r14', reviewer: 'Shira Avi', rating: 5, text: 'Third purchase. Always reliable, always great.', text_he: 'רכישה שלישית. תמיד אמין, תמיד מעולה.', date: new Date(Date.now() - 22*86400000), verified: true, helpful: 19, item: 'iPad Pro' },
    { id: 'r15', reviewer: 'Yoni Katz', rating: 5, text: 'Went above and beyond. Followed up after sale.', text_he: 'עשה מעל ומעבר. עקב אחרי המכירה.', date: new Date(Date.now() - 33*86400000), verified: true, helpful: 14, item: 'MacBook Air' },
    { id: 'r16', reviewer: 'Netta Oz', rating: 4, text: 'Great seller. Only minor delay in shipping.', text_he: 'מוכר מעולה. רק עיכוב קל במשלוח.', date: new Date(Date.now() - 50*86400000), verified: true, helpful: 8, item: 'AirPods Max' },
  ],
  'Ran Levi': [
    { id: 'r18', reviewer: 'Ofir David', rating: 5, text: 'Camera was stunning. Ran knows his gear.', text_he: 'המצלמה הייתה מדהימה. רן מכיר את הציוד.', date: new Date(Date.now() - 7*86400000), verified: true, helpful: 20, item: 'Canon EOS R5' },
    { id: 'r19', reviewer: 'Chen Regev', rating: 5, text: 'Spotless condition, great communication.', text_he: 'מצב ללא רבב, תקשורת מעולה.', date: new Date(Date.now() - 18*86400000), verified: true, helpful: 13, item: 'RF 70-200mm' },
    { id: 'r20', reviewer: 'Hadas Pearl', rating: 5, text: 'Elite seller for a reason. Everything perfect.', text_he: 'מוכר עילית מסיבה טובה. הכל מושלם.', date: new Date(Date.now() - 28*86400000), verified: true, helpful: 10, item: 'Sony A7IV' },
  ],
};

// Helper: get sample review count
const getSampleReviewCount = (sellerName) => (SAMPLE_REVIEWS[sellerName] || []).length;

// Star Rating Component
const StarRating = ({ rating, onRate, size = 'md', interactive = false }) => {
  const [hovered, setHovered] = useState(0);
  const s = { sm: 'w-3.5 h-3.5', md: 'w-5 h-5', lg: 'w-7 h-7', xl: 'w-9 h-9' }[size];
  const g = { sm: 'gap-0.5', md: 'gap-1', lg: 'gap-1.5', xl: 'gap-2' }[size];
  return (
    <div className={`flex items-center ${g}`}>
      {[1,2,3,4,5].map(i => (
        <button key={i} type="button" disabled={!interactive}
          onMouseEnter={() => interactive && setHovered(i)}
          onMouseLeave={() => interactive && setHovered(0)}
          onClick={() => interactive && onRate?.(i)}
          className={`${interactive ? 'cursor-pointer hover:scale-125 active:scale-95' : 'cursor-default'} transition-all duration-200`}
        >
          <Star className={`${s} transition-all duration-200 ${i <= (hovered || rating) ? 'text-yellow-400 fill-current drop-shadow-[0_0_6px_rgba(250,204,21,0.4)]' : 'text-slate-600'}`} />
        </button>
      ))}
    </div>
  );
};

// Rating Breakdown Bars
const RatingBreakdown = ({ reviews, lang }) => {
  const counts = [5,4,3,2,1].map(s => ({ s, c: reviews.filter(r => r.rating === s).length, p: reviews.length ? (reviews.filter(r => r.rating === s).length / reviews.length) * 100 : 0 }));
  const labels = { 5: lang==='he'?'מצוין':'Excellent', 4: lang==='he'?'טוב מאוד':'Great', 3: lang==='he'?'ממוצע':'Average', 2: lang==='he'?'מתחת':'Below', 1: lang==='he'?'גרוע':'Poor' };
  const colors = { 5:'from-green-400 to-emerald-500', 4:'from-blue-400 to-blue-500', 3:'from-yellow-400 to-amber-500', 2:'from-orange-400 to-orange-500', 1:'from-red-400 to-red-500' };
  return (
    <div className="space-y-2.5">
      {counts.map(({ s: stars, c: count, p: pct }) => (
        <div key={stars} className="flex items-center gap-3">
          <span className="text-xs text-slate-400 w-14 text-right">{labels[stars]}</span>
          <div className="flex items-center gap-1"><span className="text-xs font-semibold text-slate-300 w-3">{stars}</span><Star className="w-3 h-3 text-yellow-400 fill-current" /></div>
          <div className="flex-1 h-2.5 rounded-full bg-white/5 overflow-hidden"><div className={`h-full rounded-full bg-gradient-to-r ${colors[stars]} transition-all duration-700`} style={{width:`${pct}%`}} /></div>
          <span className="text-xs text-slate-500 w-6 text-right">{count}</span>
        </div>
      ))}
    </div>
  );
};

// Single Review Card
const ReviewCard = ({ review, lang, onHelpful }) => {
  const [liked, setLiked] = useState(false);
  const ago = (d) => { const days = Math.floor((Date.now()-new Date(d).getTime())/86400000); return days===0?(lang==='he'?'היום':'Today'):days===1?(lang==='he'?'אתמול':'Yesterday'):days<7?`${days}${lang==='he'?' ימים':'d'}`:days<30?`${Math.floor(days/7)}${lang==='he'?' שבועות':'w'}`:days<365?`${Math.floor(days/30)}${lang==='he'?' חודשים':'mo'}`:`${Math.floor(days/365)}${lang==='he'?' שנים':'y'}`; };
  return (
    <div className="p-4 rounded-2xl transition-all duration-300 hover:bg-white/[0.03]" style={{background:'linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))',border:'1px solid rgba(255,255,255,0.05)'}}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center text-sm font-bold text-blue-300 border border-blue-500/20">{review.reviewer.charAt(0)}</div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{review.reviewer}</span>
            {review.verified && <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-green-500/10 border border-green-500/20"><CheckCircle className="w-2.5 h-2.5 text-green-400" /><span className="text-[9px] font-semibold text-green-400 uppercase">{lang==='he'?'מאומת':'Verified'}</span></span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5"><StarRating rating={review.rating} size="sm" /><span className="text-[10px] text-slate-500">{ago(review.date)}</span></div>
        </div>
      </div>
      {review.item && <div className="flex items-center gap-1.5 mb-2"><ShoppingBag className="w-3 h-3 text-slate-500" /><span className="text-[10px] text-slate-500 font-medium">{review.item}</span></div>}
      <p className="text-sm text-slate-300 leading-relaxed" dir={lang==='he'?'rtl':'ltr'}>{lang==='he'&&review.text_he?review.text_he:review.text}</p>
      <div className="flex items-center justify-end mt-3">
        <button onClick={() => { setLiked(!liked); onHelpful?.(review.id); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs transition-all ${liked?'bg-blue-500/15 text-blue-400 border border-blue-500/30':'bg-white/5 text-slate-500 hover:text-slate-300 border border-transparent hover:border-white/10'}`}>
          <Star className={`w-3 h-3 ${liked?'fill-current':''}`} /><span>{lang==='he'?'מועיל':'Helpful'} ({(review.helpful||0)+(liked?1:0)})</span>
        </button>
      </div>
    </div>
  );
};

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
  
  // Chat state
  const [conversations, setConversations] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef(null);
  
  // Sound settings
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  // Reviews & Rating state (purely additive - no existing functions modified)
  const [sellerReviews, setSellerReviews] = useState([]);
  const [viewingSeller, setViewingSeller] = useState(null);
  const [showWriteReview, setShowWriteReview] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewFilter, setReviewFilter] = useState('all');
  const [reviewsLoading, setReviewsLoading] = useState(false);
  
  // Helper to play sounds (respects soundEnabled setting)
  const playSound = useCallback((soundName) => {
    if (soundEnabled && SoundEffects[soundName]) {
      SoundEffects[soundName]();
    }
  }, [soundEnabled]);

  // ========== REVIEWS FUNCTIONS (independent, no existing functions modified) ==========
  
  const calcAvgRating = useCallback((revs) => {
    if (!revs?.length) return 0;
    return revs.reduce((s, r) => s + r.rating, 0) / revs.length;
  }, []);

  // Load reviews for a seller from Supabase + merge with sample data
  const loadReviewsForSeller = useCallback(async (sellerId, sellerName) => {
    setReviewsLoading(true);
    let allReviews = [];
    
    // Try loading from Supabase (safe - won't crash if table missing)
    if (sellerId && !String(sellerId).startsWith('s')) {
      try {
        const { data } = await supabase
          .from('reviews')
          .select('*, reviewer:profiles!reviews_reviewer_id_fkey(id, full_name, avatar_url)')
          .eq('seller_id', sellerId)
          .order('created_at', { ascending: false });
        if (data) {
          allReviews = data.map(r => ({
            id: r.id, reviewer: r.reviewer?.full_name || r.reviewer_name || 'User',
            rating: r.rating, text: r.text || r.review_text || '',
            text_he: r.text_he || r.review_text_he || r.text || '',
            date: new Date(r.created_at), verified: r.verified_purchase ?? true,
            helpful: r.helpful_count || 0, item: r.item_name || r.listing_title || '', fromDB: true
          }));
        }
      } catch (e) { /* table may not exist yet - that's fine */ }
    }
    
    // Merge sample reviews (avoid duplicates)
    const sampleRevs = SAMPLE_REVIEWS[sellerName] || [];
    const existingIds = new Set(allReviews.map(r => r.id));
    sampleRevs.forEach(sr => { if (!existingIds.has(sr.id)) allReviews.push(sr); });
    
    allReviews.sort((a, b) => new Date(b.date) - new Date(a.date));
    setSellerReviews(allReviews);
    setReviewsLoading(false);
    return allReviews;
  }, []);

  // Open seller profile view
  const openSellerProfile = useCallback((seller) => {
    setViewingSeller(seller);
    setReviewFilter('all');
    setView('sellerProfile');
    // Load reviews async (non-blocking)
    loadReviewsForSeller(seller?.id, seller?.full_name);
  }, [loadReviewsForSeller]);

  // Submit a review to Supabase
  const handleSubmitReview = useCallback(async () => {
    if (reviewRating === 0 || !reviewText.trim()) return;
    setSubmittingReview(true);
    
    const reviewerName = profile?.full_name || user?.email?.split('@')[0] || 'Anonymous';
    let savedToDB = false;
    const sellerId = viewingSeller?.id;
    
    // Try saving to Supabase
    if (sellerId && !String(sellerId).startsWith('s') && user) {
      try {
        const { error } = await supabase.from('reviews').insert({
          seller_id: sellerId, reviewer_id: user.id, reviewer_name: reviewerName,
          rating: reviewRating, text: reviewText, text_he: reviewText, review_text: reviewText,
          item_name: selected?.title || '', listing_title: selected?.title || '',
          verified_purchase: true, helpful_count: 0
        });
        if (!error) {
          savedToDB = true;
          // Update seller avg rating in profiles
          try {
            const allRevs = [{ rating: reviewRating }, ...sellerReviews];
            const newAvg = Math.round((allRevs.reduce((s,r)=>s+r.rating,0)/allRevs.length)*10)/10;
            await supabase.from('profiles').update({ rating: newAvg, review_count: allRevs.length }).eq('id', sellerId);
          } catch (e) { /* non-critical */ }
        }
      } catch (e) { /* DB save failed - still add locally */ }
    }
    
    // Always add locally for instant feedback
    setSellerReviews(prev => [{
      id: `${savedToDB?'db':'local'}_${Date.now()}`, reviewer: reviewerName,
      rating: reviewRating, text: reviewText, text_he: reviewText,
      date: new Date(), verified: true, helpful: 0, item: selected?.title || '', fromDB: savedToDB
    }, ...prev]);
    
    setSubmittingReview(false);
    setShowWriteReview(false);
    setReviewRating(0);
    setReviewText('');
    playSound('success');
    setToast(t?.reviewSuccess || 'Review submitted!');
  }, [reviewRating, reviewText, profile, user, selected, viewingSeller, sellerReviews, playSound]);

  // Filtered reviews for current view
  const filteredReviews = useMemo(() => {
    if (reviewFilter === 'all') return sellerReviews;
    return sellerReviews.filter(r => r.rating === parseInt(reviewFilter));
  }, [sellerReviews, reviewFilter]);

  // Get review count for a seller (sample data)
  const getReviewCount = useCallback((seller) => {
    if (!seller) return 0;
    return getSampleReviewCount(seller.full_name);
  }, []);
  // ========== END REVIEWS FUNCTIONS ==========

  const t = T[lang];
  const rtl = lang === 'he';

  // Auth - with timeout to prevent infinite loading
  useEffect(() => {
    let mounted = true;
    
    // Force loading to false after 1.5 seconds max (reduced from 3s)
    const timeout = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 1500);
    
    const init = async () => {
      try {
        // Start loading listings immediately in parallel
        const listingsPromise = supabase
          .from('listings')
          .select('*, seller:profiles(id, full_name, avatar_url, badge, is_verified, rating)')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(20);
        
        const { data: { session } } = await supabase.auth.getSession();
        
        if (mounted && session?.user) {
          setUser(session.user);
          // Don't wait for profile - load in background
          supabase.from('profiles').select('*').eq('id', session.user.id).single()
            .then(({ data }) => { if (mounted && data) setProfile(data); })
            .catch(() => {});
        }
        
        // Apply listings data
        const { data: listingsData } = await listingsPromise;
        if (mounted && listingsData) setListings(listingsData);
        
      } catch (e) { 
        console.log('Init error:', e); 
      }
      if (mounted) setLoading(false);
    };
    
    init();
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      if (session?.user) {
        setUser(session.user);
        // Load profile in background
        supabase.from('profiles').select('*').eq('id', session.user.id).single()
          .then(({ data }) => { if (data) setProfile(data); })
          .catch(() => {});
        if (event === 'SIGNED_IN' && view === 'auth') { setView('profile'); setTab('profile'); }
      } else { setUser(null); setProfile(null); }
    });
    
    return () => { 
      mounted = false; 
      clearTimeout(timeout);
      subscription.unsubscribe(); 
    };
  }, []);

  // Debounce search input - reduced for snappier feel
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Debounce price range
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPriceRange(priceRange), 300);
    return () => clearTimeout(timer);
  }, [priceRange]);

  useEffect(() => { loadListings(); }, [category, debouncedPriceRange.min, debouncedPriceRange.max, debouncedSearch]);
  useEffect(() => { if (user) loadUserData(); else { setMyListings([]); setSavedItems([]); setSavedIds(new Set()); } }, [user]);
  
  // Auto-dismiss errors after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

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
    // Load conversations
    loadConversations();
  };

  // Chat functions
  const loadConversations = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('conversations')
      .select(`
        *,
        listing:listings(id, title, title_hebrew, price, images),
        buyer:profiles!conversations_buyer_id_fkey(id, full_name, avatar_url),
        seller:profiles!conversations_seller_id_fkey(id, full_name, avatar_url),
        messages(id, content, created_at, sender_id, is_read)
      `)
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .order('updated_at', { ascending: false });
    
    if (data) {
      setConversations(data);
      // Count unread messages
      const unread = data.reduce((count, conv) => {
        const unreadMsgs = conv.messages?.filter(m => !m.is_read && m.sender_id !== user.id) || [];
        return count + unreadMsgs.length;
      }, 0);
      setUnreadCount(unread);
    }
  };

  const loadMessages = async (conversationId) => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    
    if (data) {
      setMessages(data);
      // Mark messages as read
      const unreadIds = data.filter(m => !m.is_read && m.sender_id !== user.id).map(m => m.id);
      if (unreadIds.length > 0) {
        await supabase.from('messages').update({ is_read: true }).in('id', unreadIds);
        loadConversations(); // Refresh to update unread count
      }
    }
  };

  const startConversation = async (item) => {
    if (!user) { setSignInAction('contact'); setShowSignInModal(true); return; }
    
    // For demo items, just open a local chat (won't save to DB)
    if (item.id?.startsWith('s')) {
      setActiveChat({ 
        id: `demo-${item.id}`, 
        listing: item, 
        seller: item.seller,
        otherUser: item.seller,
        isDemo: true 
      });
      setMessages([]);
      setView('chat');
      return;
    }
    
    // Check if conversation already exists
    const { data: existing } = await supabase
      .from('conversations')
      .select('*')
      .eq('listing_id', item.id)
      .eq('buyer_id', user.id)
      .single();
    
    if (existing) {
      setActiveChat({ ...existing, listing: item, seller: item.seller, otherUser: item.seller });
      loadMessages(existing.id);
      setView('chat');
      return;
    }
    
    // Create new conversation
    const { data: newConv, error } = await supabase
      .from('conversations')
      .insert({
        listing_id: item.id,
        buyer_id: user.id,
        seller_id: item.seller_id || item.seller?.id
      })
      .select()
      .single();
    
    if (newConv) {
      setActiveChat({ ...newConv, listing: item, seller: item.seller, otherUser: item.seller });
      setMessages([]);
      setView('chat');
      loadConversations();
    }
  };

  const sendMessage = async (content, isOffer = false, offerAmount = null) => {
    if (!content.trim() || !activeChat || sendingMessage) return;
    
    // For demo chats, just add message locally
    if (activeChat.isDemo) {
      const demoMsg = {
        id: `demo-msg-${Date.now()}`,
        sender_id: user.id,
        content: content.trim(),
        is_offer: isOffer,
        offer_amount: offerAmount,
        created_at: new Date().toISOString(),
        is_read: true
      };
      setMessages(prev => [...prev, demoMsg]);
      setNewMessage('');
      
      // Simulate seller response after 1-2 seconds
      setTimeout(() => {
        const responses = lang === 'he' 
          ? ['מעניין! בוא נדבר', 'אני זמין, איפה נוח לך להיפגש?', 'אשמח לשמוע עוד', 'בוא ניצור קשר בווטסאפ']
          : ['Interesting! Let\'s talk', 'I\'m available, where would you like to meet?', 'I\'d love to hear more', 'Let\'s connect on WhatsApp'];
        const autoReply = {
          id: `demo-reply-${Date.now()}`,
          sender_id: 'seller',
          content: responses[Math.floor(Math.random() * responses.length)],
          created_at: new Date().toISOString(),
          is_read: false
        };
        setMessages(prev => [...prev, autoReply]);
      }, 1500);
      
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      return;
    }
    
    setSendingMessage(true);
    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: activeChat.id,
        sender_id: user.id,
        content: content.trim(),
        is_offer: isOffer,
        offer_amount: offerAmount
      })
      .select()
      .single();
    
    if (data) {
      setMessages(prev => [...prev, data]);
      setNewMessage('');
      // Update conversation timestamp
      await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', activeChat.id);
      // Scroll to bottom
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
    setSendingMessage(false);
  };

  const formatMessageTime = (date) => {
    const d = new Date(date);
    const now = new Date();
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return lang === 'he' ? 'אתמול' : 'Yesterday';
    return d.toLocaleDateString();
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

  const analyzeImage = useCallback(async (imgData) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    try {
      const res = await fetch('/api/analyze', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ imageData: imgData.split(',')[1], lang }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!res.ok) throw new Error('Analysis failed');
      
      const data = await res.json();
      if (data.content?.[0]?.text) {
        return JSON.parse(data.content[0].text.replace(/```json\n?|\n?```/g, '').trim());
      }
      throw new Error('Invalid response');
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        throw new Error(lang === 'he' ? 'הזמן הקצוב פג, נסה שוב' : 'Request timed out, please try again');
      }
      throw e;
    }
  }, [lang]);

  const handleFile = useCallback((file) => {
    if (!file?.type.startsWith('image/')) return;
    
    // Play tap sound for feedback
    playSound('tap');
    
    // Show analyzing state immediately with placeholder
    setView('analyzing');
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      const imageData = e.target.result;
      setImages([imageData]); // Set image immediately for preview
      
      try { 
        const r = await analyzeImage(imageData); 
        setResult(r); 
        setView('results');
        playSound('success'); // Success sound
      } catch { 
        setError(t.failed); 
        setView('home');
        playSound('error'); // Error sound
      }
    };
    reader.readAsDataURL(file);
  }, [t.failed]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } });
      setView('camera');
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => { 
        if (videoRef.current) { 
          videoRef.current.srcObject = stream; 
          videoRef.current.play().catch(() => {}); 
        } 
      });
    } catch { setError(t.cameraDenied); }
  };

  // Ref to store captured image immediately (avoids React state batching delay)
  const capturedImageRef = useRef(null);
  const [showFlash, setShowFlash] = useState(false);

  const capture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    
    // Play shutter sound immediately
    playSound('shutter');
    
    // Show flash effect
    setShowFlash(true);
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Capture frame immediately
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const img = canvas.toDataURL('image/jpeg', 0.85);
    
    // Store in ref immediately (sync) - this prevents black screen
    capturedImageRef.current = img;
    
    // Small delay for flash effect, then transition
    setTimeout(() => {
      setShowFlash(false);
      setImages([img]);
      setView('analyzing');
      
      // Stop camera tracks AFTER view change
      setTimeout(() => {
        video.srcObject?.getTracks().forEach(track => track.stop());
      }, 100);
      
      // Start analysis
      analyzeImage(img)
        .then(r => { 
          setResult(r); 
          setView('results');
          playSound('success');
        })
        .catch(() => { 
          setError(t.failed); 
          setView('home');
          playSound('error');
        });
    }, 150); // Short delay for flash effect
    
  }, [lang, t.failed, playSound]);

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
    if (!user) {
      setError(lang === 'he' ? 'יש להתחבר תחילה' : 'Please sign in first');
      return;
    }
    
    if (!listingData.title || !listingData.price || !listingData.phone || !listingData.location) {
      setError(lang === 'he' ? 'נא למלא את כל השדות' : 'Please fill all fields');
      return;
    }

    setPublishing(true);
    setError(null);
    
    try {
      let imageUrls = [];
      
      // Upload base64 images to Supabase Storage
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (img.startsWith('data:')) {
          // Convert base64 to blob
          const response = await fetch(img);
          const blob = await response.blob();
          const fileName = `${user.id}/${Date.now()}-${i}.jpg`;
          
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('listings')
            .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
          
          if (uploadError) {
            console.error('Upload error:', uploadError);
            // Fallback: store base64 directly (not ideal but works)
            imageUrls.push(img);
          } else {
            // Get public URL
            const { data: { publicUrl } } = supabase.storage.from('listings').getPublicUrl(fileName);
            imageUrls.push(publicUrl);
          }
        } else {
          // Already a URL
          imageUrls.push(img);
        }
      }
      
      // If no images uploaded, use the original array
      if (imageUrls.length === 0) imageUrls = images;
      
      const { data, error: insertError } = await supabase.from('listings').insert({ 
        seller_id: user.id, 
        title: listingData.title, 
        title_hebrew: result?.nameHebrew || '', 
        description: listingData.desc || '', 
        category: result?.category || 'Other', 
        condition, 
        price: listingData.price, 
        images: imageUrls, 
        location: listingData.location, 
        contact_phone: listingData.phone,
        status: 'active'
      }).select();
      
      if (insertError) throw insertError;
      
      // Success!
      await loadUserData();
      await loadListings();
      setListingStep(3);
      showToastMsg(t.published);
      playSound('coin'); // Play cha-ching sound!
      
    } catch (e) { 
      console.error('Publish error:', e);
      setError(lang === 'he' ? 'שגיאה בפרסום, נסה שוב' : 'Failed to publish. Please try again.');
      playSound('error'); // Play error sound
    } finally {
      setPublishing(false);
    }
  };

  const reset = () => { 
    setImages([]); 
    setResult(null); 
    setView('home'); 
    setError(null); 
    setCondition(null); 
    setListingStep(0); 
    setSelected(null); 
    setActiveChat(null); 
    capturedImageRef.current = null; 
  };
  const goTab = (newTab) => { 
    setTab(newTab); 
    setSelected(null); 
    setActiveChat(null);
    if (newTab === 'home') setView('home'); 
    else if (newTab === 'browse') setView('browse'); 
    else if (newTab === 'sell') setView('myListings'); 
    else if (newTab === 'saved') setView('saved'); 
    else if (newTab === 'messages') { setView('inbox'); loadConversations(); }
    else if (newTab === 'profile') setView(user ? 'profile' : 'auth'); 
  };
  const viewItem = (item) => { setSelected(item); setView('detail'); };
  const contactSeller = () => { 
    if (!user) { setSignInAction('contact'); setShowSignInModal(true); return; } 
    setShowContact(true);
  };

  // Input component - kept inside for rtl access but simplified


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
              <h3 className="text-2xl font-bold text-center">{lang === 'he' ? 'יצירת קשר' : 'Contact Seller'}</h3>
              
              {/* Seller Info */}
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

              {/* Contact Options */}
              <div className="space-y-3">
                {/* In-App Message - Primary */}
                <button 
                  onClick={() => { 
                    setShowContact(false); 
                    startConversation(selected); 
                  }}
                  className="w-full py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 text-center font-semibold flex items-center justify-center gap-3 shadow-lg shadow-blue-500/30 active:scale-[0.98] transition-transform"
                >
                  <MessageCircle className="w-5 h-5" />
                  {lang === 'he' ? 'שלח הודעה באפליקציה' : 'Message in App'}
                </button>

                {/* WhatsApp & Phone Row */}
                <div className="grid grid-cols-2 gap-3">
                  <a 
                    href={`https://wa.me/972${(selected.contact_phone || '').replace(/^0/, '').replace(/-/g, '')}?text=${encodeURIComponent(lang === 'he' ? `היי, ראיתי את המודעה שלך ב-GetWorth: ${selected.title}` : `Hi, I saw your listing on GetWorth: ${selected.title}`)}`} 
                    target="_blank" 
                    className="py-4 rounded-2xl bg-gradient-to-r from-[#25D366] to-[#128C7E] text-center font-semibold flex items-center justify-center gap-2 shadow-lg shadow-green-500/30 active:scale-95 transition-transform"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    WhatsApp
                  </a>
                  <a 
                    href={`tel:${selected.contact_phone}`} 
                    className="py-4 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-500 text-center font-semibold flex items-center justify-center gap-2 shadow-lg shadow-green-500/30 active:scale-95 transition-transform"
                  >
                    <Phone className="w-5 h-5" />
                    {lang === 'he' ? 'התקשר' : 'Call'}
                  </a>
                </div>

                {/* Phone number display */}
                {selected.contact_phone && (
                  <p className="text-center text-sm text-slate-500">
                    📞 {selected.contact_phone}
                  </p>
                )}
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
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setSoundEnabled(!soundEnabled)} 
              className={`p-2.5 rounded-2xl border border-white/10 transition-all hover:scale-105 active:scale-95 ${soundEnabled ? 'bg-blue-500/20 hover:bg-blue-500/30' : 'bg-white/5 hover:bg-white/10'}`}
              title={soundEnabled ? (lang === 'he' ? 'השתק צלילים' : 'Mute sounds') : (lang === 'he' ? 'הפעל צלילים' : 'Enable sounds')}
            >
              {soundEnabled ? (
                <Volume2 className="w-4 h-4 text-blue-400" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-500" />
              )}
            </button>
            <button 
              onClick={() => setLang(lang === 'en' ? 'he' : 'en')} 
              className="px-4 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium flex items-center gap-2 transition-all hover:scale-105 active:scale-95"
            >
              <Globe className="w-4 h-4 text-blue-400" />
              {lang === 'en' ? 'עב' : 'EN'}
            </button>
          </div>
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
                        onClick={() => viewItem(item)}
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
                        onClick={() => viewItem(item)}
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
              
              {/* Flash effect overlay */}
              {showFlash && (
                <div className="absolute inset-0 bg-white animate-flash z-50" />
              )}
              
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

          {/* ANALYZING - Premium Animation */}
          {view === 'analyzing' && (
            <div className="flex-1 flex flex-col items-center justify-center py-10 min-h-[70vh]">
              {/* Main container with image */}
              <div className="relative">
                {/* Outer glow rings */}
                <div className="absolute -inset-12 bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-cyan-500/20 rounded-full blur-3xl animate-pulse" />
                <div className="absolute -inset-8 bg-blue-500/10 rounded-full blur-2xl animate-ping" style={{ animationDuration: '2s' }} />
                
                {/* Rotating border ring */}
                <div className="absolute -inset-3 rounded-[2rem] bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 animate-spin-slow opacity-70" style={{ animationDuration: '3s' }} />
                <div className="absolute -inset-2.5 rounded-[1.8rem] bg-[#0a1020]" />
                
                {/* Image container */}
                <div className="relative w-56 h-56 rounded-3xl overflow-hidden shadow-2xl shadow-blue-500/40">
                  {/* Show captured image from ref or state */}
                  {(capturedImageRef.current || images[0]) && (
                    <img 
                      src={capturedImageRef.current || images[0]} 
                      className="w-full h-full object-cover" 
                      alt="Captured item"
                    />
                  )}
                  
                  {/* Scanning line effect */}
                  <div className="absolute inset-0 overflow-hidden">
                    <div className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-400 to-transparent animate-scan" />
                  </div>
                  
                  {/* Corner brackets */}
                  <div className="absolute inset-0 pointer-events-none">
                    <svg className="absolute top-2 left-2 w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 8V4h4M4 16v4h4" />
                    </svg>
                    <svg className="absolute top-2 right-2 w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 8V4h-4M20 16v4h-4" />
                    </svg>
                    <svg className="absolute bottom-2 left-2 w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 8V4h4M4 16v4h4" />
                    </svg>
                    <svg className="absolute bottom-2 right-2 w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 8V4h-4M20 16v4h-4" />
                    </svg>
                  </div>
                  
                  {/* Overlay shimmer */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer-fast" />
                </div>
                
                {/* Floating particles */}
                <div className="absolute -inset-8 pointer-events-none">
                  {[...Array(6)].map((_, i) => (
                    <div
                      key={i}
                      className="absolute w-2 h-2 rounded-full bg-blue-400 animate-float"
                      style={{
                        left: `${20 + (i * 15)}%`,
                        top: `${10 + (i % 3) * 30}%`,
                        animationDelay: `${i * 0.3}s`,
                        animationDuration: `${2 + (i % 2)}s`
                      }}
                    />
                  ))}
                </div>
              </div>
              
              {/* Status text and progress */}
              <div className="mt-10 text-center space-y-5">
                {/* AI Badge */}
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30">
                  <Sparkles className="w-4 h-4 text-blue-400 animate-pulse" />
                  <span className="text-sm font-semibold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                    {lang === 'he' ? 'AI מנתח' : 'AI Analyzing'}
                  </span>
                </div>
                
                {/* Main text */}
                <div>
                  <h3 className="text-xl font-bold text-white mb-1">{t.analyzing}</h3>
                  <p className="text-sm text-slate-400">
                    {lang === 'he' ? 'מזהה פריט וחוקר שוק...' : 'Identifying item & researching market...'}
                  </p>
                </div>
                
                {/* Progress bar */}
                <div className="w-48 mx-auto">
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 rounded-full animate-progress" />
                  </div>
                </div>
                
                {/* Animated steps */}
                <div className="flex items-center justify-center gap-6 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5 animate-pulse">
                    <Scan className="w-3.5 h-3.5 text-blue-400" />
                    <span>{lang === 'he' ? 'סריקה' : 'Scanning'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 animate-pulse" style={{ animationDelay: '0.5s' }}>
                    <Search className="w-3.5 h-3.5 text-purple-400" />
                    <span>{lang === 'he' ? 'חיפוש' : 'Matching'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 animate-pulse" style={{ animationDelay: '1s' }}>
                    <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{lang === 'he' ? 'הערכה' : 'Pricing'}</span>
                  </div>
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
              {/* Image */}
              <div className="relative">
                <div className="aspect-square">
                  <img src={selected.images?.[0]} className="w-full h-full object-cover" />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-[#060a14] via-transparent to-[#060a14]/50" />
                
                <button 
                  onClick={() => { setSelected(null); setView(tab === 'home' ? 'home' : 'browse'); }} 
                  className={`absolute top-4 ${rtl ? 'right-4' : 'left-4'} w-12 h-12 rounded-2xl bg-black/30 backdrop-blur-md flex items-center justify-center hover:bg-black/50 transition-all`}
                >
                  {rtl ? <ChevronRight className="w-6 h-6" /> : <ChevronLeft className="w-6 h-6" />}
                </button>
                
                <button 
                  onClick={() => !selected.id?.startsWith('s') && toggleSave(selected)} 
                  className={`absolute top-4 ${rtl ? 'left-4' : 'right-4'} w-12 h-12 rounded-2xl flex items-center justify-center transition-all backdrop-blur-md ${savedIds.has(selected.id) ? 'bg-red-500 shadow-lg shadow-red-500/50' : 'bg-black/30 hover:bg-black/50'}`}
                >
                  <Heart className={`w-6 h-6 ${savedIds.has(selected.id) ? 'fill-current' : ''}`} />
                </button>

                {/* Condition badge on image */}
                {selected.condition && (
                  <div className={`absolute bottom-4 ${rtl ? 'right-4' : 'left-4'} px-3 py-1.5 rounded-xl text-xs font-bold uppercase backdrop-blur-md ${
                    selected.condition === 'newSealed' ? 'bg-emerald-500/90' : 
                    selected.condition === 'likeNew' ? 'bg-blue-500/90' : 
                    selected.condition === 'used' ? 'bg-amber-500/90' : 'bg-red-500/90'
                  }`}>
                    {selected.condition === 'newSealed' ? (lang === 'he' ? '✨ חדש' : '✨ New') : 
                     selected.condition === 'likeNew' ? (lang === 'he' ? 'כמו חדש' : 'Like New') : 
                     selected.condition === 'used' ? (lang === 'he' ? 'משומש' : 'Used') : (lang === 'he' ? 'משומש מאוד' : 'Fair')}
                  </div>
                )}
              </div>

              <div className="px-5 space-y-4">
                {/* Seller Profile Card - At Top */}
                {selected.seller && (
                  <FadeIn>
                    <Card className="p-4" gradient="linear-gradient(135deg, rgba(59,130,246,0.1), rgba(139,92,246,0.05))">
                      <div className="flex items-center gap-4">
                        {/* Seller Avatar */}
                        <div className="relative">
                          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold shadow-lg ${
                            selected.seller.badge === 'eliteSeller' ? 'bg-gradient-to-br from-yellow-500 to-amber-600 shadow-yellow-500/30' :
                            selected.seller.badge === 'topSeller' ? 'bg-gradient-to-br from-purple-500 to-pink-600 shadow-purple-500/30' :
                            selected.seller.badge === 'trustedSeller' ? 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-blue-500/30' :
                            'bg-gradient-to-br from-slate-500 to-slate-600 shadow-slate-500/30'
                          }`}>
                            {selected.seller.full_name?.charAt(0) || 'S'}
                          </div>
                          {selected.seller.is_verified && (
                            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center border-2 border-[#060a14]">
                              <Check className="w-3.5 h-3.5 text-white" />
                            </div>
                          )}
                        </div>
                        
                        {/* Seller Info */}
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-lg">{selected.seller.full_name || 'Seller'}</span>
                            {selected.seller.is_verified && <Shield className="w-4 h-4 text-blue-400" />}
                          </div>
                          
                          {/* Seller Badge */}
                          <div className="flex items-center gap-2 mt-1">
                            {selected.seller.badge && (
                              <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase ${
                                selected.seller.badge === 'eliteSeller' ? 'bg-yellow-500/20 text-yellow-400' :
                                selected.seller.badge === 'topSeller' ? 'bg-purple-500/20 text-purple-400' :
                                selected.seller.badge === 'trustedSeller' ? 'bg-blue-500/20 text-blue-400' :
                                'bg-slate-500/20 text-slate-400'
                              }`}>
                                {selected.seller.badge === 'eliteSeller' ? (lang === 'he' ? '⭐ מוכר עילית' : '⭐ Elite Seller') :
                                 selected.seller.badge === 'topSeller' ? (lang === 'he' ? '🏆 מוכר מוביל' : '🏆 Top Seller') :
                                 selected.seller.badge === 'trustedSeller' ? (lang === 'he' ? '✓ מוכר מאומת' : '✓ Trusted') :
                                 (lang === 'he' ? '🆕 מוכר חדש' : '🆕 New Seller')}
                              </span>
                            )}
                          </div>
                          
                          {/* Rating & Sales */}
                          <div className="flex items-center gap-3 mt-2">
                            {selected.seller.rating && (
                              <button onClick={() => openSellerProfile(selected.seller)} className="flex items-center gap-1 hover:bg-yellow-500/10 px-1.5 py-0.5 rounded-lg transition-all">
                                <Star className="w-4 h-4 text-yellow-400 fill-current" />
                                <span className="text-sm font-semibold">{selected.seller.rating}</span>
                                {getReviewCount(selected.seller) > 0 && <span className="text-[10px] text-slate-500">({getReviewCount(selected.seller)})</span>}
                              </button>
                            )}
                            {selected.seller.total_sales > 0 && (
                              <div className="flex items-center gap-1 text-slate-400">
                                <ShoppingBag className="w-3.5 h-3.5" />
                                <span className="text-xs">{selected.seller.total_sales} {lang === 'he' ? 'מכירות' : 'sales'}</span>
                              </div>
                            )}
                          </div>
                          {/* See Reviews Link */}
                          {getReviewCount(selected.seller) > 0 && (
                            <button onClick={() => openSellerProfile(selected.seller)} className="flex items-center gap-1.5 mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                              <MessageCircle className="w-3.5 h-3.5" /><span>{t.seeAllReviews}</span><ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </Card>
                  </FadeIn>
                )}

                {/* Item Title & Price */}
                <FadeIn delay={50}>
                  <div>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {selected.category && <Badge>{selected.category}</Badge>}
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" />{selected.views || 0} {lang === 'he' ? 'צפיות' : 'views'}
                      </span>
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />{timeAgo(selected.created_at)}
                      </span>
                    </div>
                    <h1 className="text-2xl font-bold">{lang === 'he' && selected.title_hebrew ? selected.title_hebrew : selected.title}</h1>
                    <div className="flex items-center gap-2 mt-1">
                      <MapPin className="w-4 h-4 text-slate-500" />
                      <span className="text-sm text-slate-400">{selected.location}</span>
                    </div>
                  </div>
                  <p className="text-4xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent mt-3">
                    {formatPrice(selected.price)}
                  </p>
                </FadeIn>

                {/* Description */}
                {(selected.description || selected.description_hebrew) && (
                  <FadeIn delay={100}>
                    <Card className="p-5">
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <Package className="w-5 h-5 text-blue-400" />{lang === 'he' ? 'תיאור' : 'Description'}
                      </h3>
                      <p className="text-sm text-slate-300 leading-relaxed">
                        {lang === 'he' && selected.description_hebrew ? selected.description_hebrew : selected.description}
                      </p>
                    </Card>
                  </FadeIn>
                )}

                {/* Contact Buttons */}
                <FadeIn delay={150} className="flex gap-3 pb-6">
                  <Btn primary className="flex-1 py-4" onClick={contactSeller}>
                    <MessageCircle className="w-5 h-5" />{lang === 'he' ? 'צור קשר' : 'Contact'}
                  </Btn>
                  <Btn onClick={() => !selected.id?.startsWith('s') && toggleSave(selected)} className="px-5">
                    <Heart className={`w-5 h-5 ${savedIds.has(selected.id) ? 'fill-current text-red-400' : ''}`} />
                  </Btn>
                </FadeIn>
              </div>
            </div>
          )}

          {/* SELLER PROFILE WITH REVIEWS */}
          {view === 'sellerProfile' && viewingSeller && (
            <div className="space-y-5 pb-4">
              <FadeIn>
                <button onClick={() => { setView(selected ? 'detail' : 'browse'); setViewingSeller(null); }} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                  <ChevronLeft className="w-5 h-5" /><span className="text-sm font-medium">{t.back}</span>
                </button>
              </FadeIn>

              {/* Seller Hero Card */}
              <FadeIn delay={50}>
                <Card className="p-6 overflow-hidden relative">
                  <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full opacity-20 blur-3xl" style={{background: viewingSeller.badge==='eliteSeller'?'#eab308':viewingSeller.badge==='topSeller'?'#a855f7':'#3b82f6'}} />
                  <div className="relative flex items-center gap-5">
                    <div className="relative">
                      <div className={`w-24 h-24 rounded-3xl flex items-center justify-center text-4xl font-bold shadow-2xl ${viewingSeller.badge==='eliteSeller'?'bg-gradient-to-br from-yellow-500 to-amber-600':viewingSeller.badge==='topSeller'?'bg-gradient-to-br from-purple-500 to-pink-600':viewingSeller.badge==='trustedSeller'?'bg-gradient-to-br from-blue-500 to-blue-600':'bg-gradient-to-br from-slate-500 to-slate-600'}`}>
                        {viewingSeller.full_name?.charAt(0)||'S'}
                      </div>
                      {viewingSeller.is_verified && <div className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center border-2 border-[#060a14]"><Check className="w-4 h-4 text-white" /></div>}
                    </div>
                    <div className="flex-1">
                      <h2 className="text-2xl font-bold">{viewingSeller.full_name}</h2>
                      {viewingSeller.badge && <span className={`inline-flex px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase mt-1.5 ${viewingSeller.badge==='eliteSeller'?'bg-yellow-500/20 text-yellow-400':viewingSeller.badge==='topSeller'?'bg-purple-500/20 text-purple-400':viewingSeller.badge==='trustedSeller'?'bg-blue-500/20 text-blue-400':'bg-slate-500/20 text-slate-400'}`}>
                        {viewingSeller.badge==='eliteSeller'?'⭐ Elite':viewingSeller.badge==='topSeller'?'🏆 Top':viewingSeller.badge==='trustedSeller'?'✓ Trusted':'🆕 New'}
                      </span>}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-6">
                    <div className="text-center p-3 rounded-2xl bg-white/5">
                      <div className="flex items-center justify-center gap-1 mb-1"><Star className="w-4 h-4 text-yellow-400 fill-current" /><span className="text-xl font-bold text-yellow-400">{sellerReviews.length?calcAvgRating(sellerReviews).toFixed(1):(viewingSeller.rating||'—')}</span></div>
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{t.overallRating}</p>
                    </div>
                    <div className="text-center p-3 rounded-2xl bg-white/5"><p className="text-xl font-bold text-blue-400">{viewingSeller.total_sales||0}</p><p className="text-[10px] text-slate-500 uppercase tracking-wider">{t.sales}</p></div>
                    <div className="text-center p-3 rounded-2xl bg-white/5"><p className="text-xl font-bold text-green-400">{sellerReviews.length}</p><p className="text-[10px] text-slate-500 uppercase tracking-wider">{t.reviews}</p></div>
                  </div>
                </Card>
              </FadeIn>

              {/* Rating Breakdown */}
              {sellerReviews.length > 0 && (
                <FadeIn delay={100}>
                  <Card className="p-5">
                    <h3 className="font-semibold mb-4 flex items-center gap-2"><Star className="w-5 h-5 text-yellow-400 fill-current" />{t.overallRating}<span className="text-sm text-slate-400 font-normal">({t.basedOn} {sellerReviews.length} {t.reviews.toLowerCase()})</span></h3>
                    <div className="flex items-center gap-6 mb-3">
                      <div className="text-center">
                        <div className="text-5xl font-black bg-gradient-to-b from-yellow-300 to-yellow-500 bg-clip-text text-transparent">{calcAvgRating(sellerReviews).toFixed(1)}</div>
                        <StarRating rating={Math.round(calcAvgRating(sellerReviews))} size="md" />
                      </div>
                      <div className="flex-1"><RatingBreakdown reviews={sellerReviews} lang={lang} /></div>
                    </div>
                  </Card>
                </FadeIn>
              )}

              {/* Write Review CTA */}
              {user && (
                <FadeIn delay={150}>
                  <button onClick={() => setShowWriteReview(true)} className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-semibold text-white shadow-lg shadow-blue-500/30 active:scale-[0.98] transition-all" style={{background:'linear-gradient(135deg,#3b82f6,#2563eb,#1d4ed8)',boxShadow:'0 8px 24px rgba(59,130,246,0.4)'}}>
                    <Star className="w-5 h-5" />{t.writeReview}
                  </button>
                </FadeIn>
              )}

              {/* Filter Tabs */}
              {sellerReviews.length > 0 && (
                <FadeIn delay={200}>
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                    {['all','5','4','3','2','1'].map(f => {
                      const cnt = f==='all'?sellerReviews.length:sellerReviews.filter(r=>r.rating===parseInt(f)).length;
                      if (f!=='all'&&cnt===0) return null;
                      return <button key={f} onClick={() => setReviewFilter(f)} className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${reviewFilter===f?'bg-blue-500/20 text-blue-400 border border-blue-500/30':'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'}`}>
                        {f==='all'?(lang==='he'?'הכל':'All'):<><Star className="w-3 h-3 text-yellow-400 fill-current" />{f}</>}<span className="text-[10px] opacity-70">({cnt})</span>
                      </button>;
                    })}
                  </div>
                </FadeIn>
              )}

              {/* Reviews List */}
              <div className="space-y-3">
                {reviewsLoading ? (
                  [1,2,3].map(i => <div key={i} className="p-4 rounded-2xl" style={{background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.05)'}}><div className="flex gap-3 mb-3"><Skeleton className="w-10 h-10 !rounded-xl" /><div className="space-y-2 flex-1"><Skeleton className="h-3 w-24 !rounded-lg" /><Skeleton className="h-2.5 w-20 !rounded-lg" /></div></div><Skeleton className="h-3 w-full !rounded-lg mb-2" /><Skeleton className="h-3 w-3/4 !rounded-lg" /></div>)
                ) : filteredReviews.length > 0 ? (
                  filteredReviews.map((r,i) => <FadeIn key={r.id} delay={250+i*50}><ReviewCard review={r} lang={lang} /></FadeIn>)
                ) : (
                  <FadeIn delay={250} className="text-center py-12">
                    <div className="w-20 h-20 rounded-3xl bg-yellow-500/10 flex items-center justify-center mx-auto mb-4"><Star className="w-10 h-10 text-yellow-500/50" /></div>
                    <p className="text-slate-400 mb-2">{t.noReviews}</p><p className="text-slate-500 text-sm">{t.beFirst}</p>
                  </FadeIn>
                )}
              </div>
            </div>
          )}

          {/* WRITE REVIEW MODAL */}
          {showWriteReview && (
            <div className="fixed inset-0 z-50 flex items-end justify-center">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowWriteReview(false)} />
              <div className="relative w-full max-w-md animate-slideUp">
                <div className="rounded-t-3xl overflow-hidden" style={{background:'linear-gradient(180deg,#0f1629,#060a14)',border:'1px solid rgba(255,255,255,0.1)',borderBottom:'none'}}>
                  <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-white/20" /></div>
                  <div className="px-6 pb-8 space-y-6">
                    <div className="text-center">
                      <h3 className="text-xl font-bold">{t.writeReview}</h3>
                      {viewingSeller && <p className="text-sm text-slate-400 mt-1">{lang==='he'?`עבור ${viewingSeller.full_name}`:`for ${viewingSeller.full_name}`}</p>}
                    </div>
                    <div className="text-center space-y-3">
                      <p className="text-sm text-slate-400">{t.yourRating}</p>
                      <div className="flex justify-center"><StarRating rating={reviewRating} onRate={setReviewRating} size="xl" interactive /></div>
                      {reviewRating > 0 && <p className="text-sm font-semibold animate-fadeIn" style={{color:reviewRating>=4?'#4ade80':reviewRating>=3?'#facc15':'#f87171'}}>
                        {reviewRating===5?'🌟 '+(lang==='he'?'מצוין!':'Excellent!'):reviewRating===4?'👍 '+(lang==='he'?'טוב מאוד!':'Great!'):reviewRating===3?(lang==='he'?'ממוצע':'Average'):reviewRating===2?(lang==='he'?'מתחת לממוצע':'Below Average'):(lang==='he'?'גרוע':'Poor')}
                      </p>}
                    </div>
                    <div>
                      <textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)} placeholder={t.reviewPlaceholder} dir={rtl?'rtl':'ltr'} rows={4} maxLength={500} className="w-full px-4 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all resize-none" />
                      <div className="flex justify-end mt-1"><span className={`text-[10px] ${reviewText.length>400?'text-yellow-400':'text-slate-500'}`}>{reviewText.length}/500</span></div>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={() => { setShowWriteReview(false); setReviewRating(0); setReviewText(''); }} className="flex-1 py-3.5 rounded-2xl font-semibold bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 transition-all active:scale-95">{t.cancel}</button>
                      <button onClick={handleSubmitReview} disabled={reviewRating===0||!reviewText.trim()||submittingReview} className="flex-1 py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2 disabled:opacity-40 active:scale-95 transition-all" style={{background:'linear-gradient(135deg,#3b82f6,#2563eb,#1d4ed8)',boxShadow:'0 8px 24px rgba(59,130,246,0.4)'}}>
                        {submittingReview?<><Loader2 className="w-4 h-4 animate-spin" />{t.submitting}</>:<><Send className="w-4 h-4" />{t.submitReview}</>}
                      </button>
                    </div>
                  </div>
                </div>
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

          {/* INBOX - Messages List */}
          {view === 'inbox' && (
            <div className="space-y-4">
              <FadeIn>
                <h2 className="text-2xl font-bold">{lang === 'he' ? 'הודעות' : 'Messages'}</h2>
              </FadeIn>
              
              {!user ? (
                <FadeIn className="text-center py-16">
                  <div className="w-20 h-20 rounded-3xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                    <MessageCircle className="w-10 h-10 text-blue-400" />
                  </div>
                  <p className="text-slate-400 mb-5">{lang === 'he' ? 'התחבר כדי לראות הודעות' : 'Sign in to see messages'}</p>
                  <Btn primary onClick={() => goTab('profile')}>{t.signIn}</Btn>
                </FadeIn>
              ) : conversations.length === 0 ? (
                <FadeIn className="text-center py-16">
                  <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                    <MessageCircle className="w-10 h-10 text-slate-600" />
                  </div>
                  <p className="text-slate-400 mb-2">{lang === 'he' ? 'אין הודעות עדיין' : 'No messages yet'}</p>
                  <p className="text-slate-500 text-sm mb-5">{lang === 'he' ? 'התחל שיחה עם מוכר' : 'Start a conversation with a seller'}</p>
                  <Btn primary onClick={() => goTab('browse')}>{lang === 'he' ? 'חפש פריטים' : 'Browse Items'}</Btn>
                </FadeIn>
              ) : (
                <div className="space-y-3">
                  {conversations.map((conv, i) => {
                    const otherUser = conv.buyer_id === user.id ? conv.seller : conv.buyer;
                    const lastMessage = conv.messages?.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
                    const unreadCount = conv.messages?.filter(m => !m.is_read && m.sender_id !== user.id).length || 0;
                    
                    return (
                      <FadeIn key={conv.id} delay={i * 50}>
                        <Card 
                          className="p-4 cursor-pointer" 
                          onClick={() => {
                            setActiveChat({ ...conv, otherUser });
                            loadMessages(conv.id);
                            setView('chat');
                          }}
                        >
                          <div className="flex items-center gap-4">
                            {/* Item Image */}
                            <div className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
                              <img src={conv.listing?.images?.[0]} alt="" className="w-full h-full object-cover" />
                              {unreadCount > 0 && (
                                <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center">
                                  {unreadCount}
                                </div>
                              )}
                            </div>
                            
                            {/* Conversation Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold truncate">{otherUser?.full_name || 'User'}</span>
                                <span className="text-[10px] text-slate-500">{lastMessage ? formatMessageTime(lastMessage.created_at) : ''}</span>
                              </div>
                              <p className="text-sm text-slate-400 truncate">{conv.listing?.title}</p>
                              <p className={`text-xs truncate mt-1 ${unreadCount > 0 ? 'text-white font-medium' : 'text-slate-500'}`}>
                                {lastMessage?.is_offer ? `💰 ${lang === 'he' ? 'הצעת מחיר' : 'Price offer'}: ₪${lastMessage.offer_amount}` : lastMessage?.content || (lang === 'he' ? 'שיחה חדשה' : 'New conversation')}
                              </p>
                            </div>
                            
                            <ChevronRight className="w-5 h-5 text-slate-500" />
                          </div>
                        </Card>
                      </FadeIn>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* CHAT - Single Conversation */}
          {view === 'chat' && activeChat && (
            <div className="flex flex-col h-[calc(100vh-180px)] -mx-5">
              {/* Chat Header */}
              <div className="px-5 py-3 border-b border-white/10 flex items-center gap-3">
                <button 
                  onClick={() => { setActiveChat(null); setView('inbox'); }}
                  className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center"
                >
                  {rtl ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
                </button>
                
                <div className="w-10 h-10 rounded-xl overflow-hidden">
                  <img src={activeChat.listing?.images?.[0]} alt="" className="w-full h-full object-cover" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{activeChat.otherUser?.full_name || activeChat.seller?.full_name || 'User'}</p>
                  <p className="text-xs text-slate-400 truncate">{activeChat.listing?.title}</p>
                </div>
                
                <div className="text-right">
                  <p className="text-lg font-bold text-green-400">{formatPrice(activeChat.listing?.price)}</p>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {messages.length === 0 && (
                  <div className="text-center py-8">
                    <p className="text-slate-500 text-sm">{lang === 'he' ? 'התחל את השיחה' : 'Start the conversation'}</p>
                  </div>
                )}
                
                {messages.map((msg, i) => {
                  const isMe = msg.sender_id === user.id;
                  return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                        isMe 
                          ? 'bg-blue-600 rounded-br-sm' 
                          : 'bg-white/10 rounded-bl-sm'
                      }`}>
                        {msg.is_offer && (
                          <div className={`text-xs mb-1 ${isMe ? 'text-blue-200' : 'text-slate-400'}`}>
                            💰 {lang === 'he' ? 'הצעת מחיר' : 'Price Offer'}
                          </div>
                        )}
                        {msg.is_offer && msg.offer_amount && (
                          <p className="text-xl font-bold text-green-400 mb-1">₪{msg.offer_amount.toLocaleString()}</p>
                        )}
                        <p className="text-sm">{msg.content}</p>
                        <p className={`text-[10px] mt-1 ${isMe ? 'text-blue-200' : 'text-slate-500'}`}>
                          {formatMessageTime(msg.created_at)}
                          {isMe && msg.is_read && ' ✓✓'}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Actions */}
              <div className="px-5 py-2 flex gap-2 overflow-x-auto scrollbar-hide">
                {[
                  { text: lang === 'he' ? 'עדיין זמין?' : 'Still available?', icon: '❓' },
                  { text: lang === 'he' ? 'מחיר סופי?' : 'Best price?', icon: '💰' },
                  { text: lang === 'he' ? 'איפה למסור?' : 'Where to meet?', icon: '📍' },
                ].map((quick, i) => (
                  <button 
                    key={i}
                    onClick={() => sendMessage(quick.text)}
                    className="flex-shrink-0 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs hover:bg-white/10 transition-all"
                  >
                    {quick.icon} {quick.text}
                  </button>
                ))}
              </div>

              {/* Message Input */}
              <div className="px-5 py-3 border-t border-white/10">
                <div className="flex gap-2">
                  <button 
                    onClick={() => {
                      const amount = prompt(lang === 'he' ? 'הכנס הצעת מחיר:' : 'Enter your offer:');
                      if (amount && !isNaN(amount)) {
                        sendMessage(`${lang === 'he' ? 'אני מציע' : 'I offer'} ₪${amount}`, true, parseInt(amount));
                      }
                    }}
                    className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center text-green-400 hover:bg-green-500/30 transition-all"
                  >
                    <DollarSign className="w-5 h-5" />
                  </button>
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendMessage(newMessage)}
                    placeholder={lang === 'he' ? 'כתוב הודעה...' : 'Type a message...'}
                    className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:outline-none focus:border-blue-500/50"
                    dir={rtl ? 'rtl' : 'ltr'}
                  />
                  <button 
                    onClick={() => sendMessage(newMessage)}
                    disabled={!newMessage.trim() || sendingMessage}
                    className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center disabled:opacity-50 hover:bg-blue-500 transition-all"
                  >
                    {sendingMessage ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-5 h-5" />}
                  </button>
                </div>
              </div>
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
                  {authMode === 'signup' && <InputField label={t.name} icon={User} rtl={rtl} value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} />}
                  <InputField label={t.email} type="email" rtl={rtl} value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} required />
                  <InputField label={t.password} type="password" rtl={rtl} value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} required />
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

              {/* Rating & Reviews Card on Profile */}
              <FadeIn delay={150}>
                <Card className="p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold flex items-center gap-2"><Star className="w-5 h-5 text-yellow-400 fill-current" />{t.receivedReviews}</h3>
                    <Badge color="yellow"><Star className="w-3 h-3 text-yellow-400 fill-current inline mr-1" />{profile?.rating || '5.0'}</Badge>
                  </div>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="text-center"><div className="text-3xl font-black text-yellow-400">{profile?.rating || '5.0'}</div><StarRating rating={Math.round(profile?.rating || 5)} size="sm" /></div>
                    <div className="flex-1 text-center py-3 rounded-xl bg-white/5"><p className="text-lg font-bold text-slate-300">{profile?.review_count || 0}</p><p className="text-[10px] text-slate-500 uppercase">{t.reviews}</p></div>
                    <div className="flex-1 text-center py-3 rounded-xl bg-white/5"><p className="text-lg font-bold text-green-400">98%</p><p className="text-[10px] text-slate-500 uppercase">{t.responseRate}</p></div>
                  </div>
                  <div className="text-center py-4 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
                    <Star className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                    <p className="text-xs text-slate-500">{(profile?.review_count||0)===0?t.noReviews:`${profile.review_count} ${t.reviews.toLowerCase()}`}</p>
                    <p className="text-[10px] text-slate-600 mt-1">{lang==='he'?'ביקורות יופיעו כאן לאחר מכירות':'Reviews will appear here after sales'}</p>
                  </div>
                </Card>
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
                    <InputField label={t.title} rtl={rtl} value={listingData.title} onChange={(e) => setListingData({ ...listingData, title: e.target.value })} />
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
                    <InputField label={t.phone} icon={Phone} rtl={rtl} placeholder="050-000-0000" value={listingData.phone} onChange={(e) => setListingData({ ...listingData, phone: e.target.value })} />
                  </FadeIn>
                  <FadeIn delay={250}>
                    <LocationInput 
                      label={t.location} 
                      rtl={rtl} 
                      value={listingData.location} 
                      onChange={(e) => setListingData({ ...listingData, location: e.target.value })}
                      placeholder={rtl ? 'תל אביב, ירושלים...' : 'Tel Aviv, Jerusalem...'}
                    />
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
              { id: 'messages', icon: MessageCircle },
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
        @keyframes shimmer-fast {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes scan {
          0% { top: 0%; opacity: 1; }
          50% { opacity: 0.5; }
          100% { top: 100%; opacity: 1; }
        }
        @keyframes progress {
          0% { width: 0%; }
          50% { width: 70%; }
          100% { width: 100%; }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0.6; }
          50% { transform: translateY(-15px) scale(1.2); opacity: 1; }
        }
        @keyframes flash {
          0% { opacity: 0.9; }
          100% { opacity: 0; }
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
        .animate-shimmer-fast { animation: shimmer-fast 1.5s infinite; }
        .animate-spin-slow { animation: spin-slow 4s linear infinite; }
        .animate-scan { animation: scan 2s ease-in-out infinite; }
        .animate-progress { animation: progress 3s ease-in-out infinite; }
        .animate-float { animation: float 2s ease-in-out infinite; }
        .animate-flash { animation: flash 0.15s ease-out forwards; }
        .animate-marquee-left { animation: marquee-left 25s linear infinite; }
        .animate-marquee-right { animation: marquee-right 30s linear infinite; }
        .animate-marquee-left:hover, .animate-marquee-right:hover { animation-play-state: paused; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}