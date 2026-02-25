import React, { useRef } from 'react';
import { ShoppingBag, Scan, Eye, Clock, Trash2, Heart, Box, Sparkles, Package, AlertTriangle, CheckCircle, Circle, Check, Share2, Loader2, Phone, Plus, X, Camera, Bell, ChevronRight } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, Badge, FadeIn, ScaleIn, InputField, BackButton } from '../components/ui';
import ListingCard from '../components/ListingCard';
import LocationInput from '../components/LocationInput';
import { formatPrice, timeAgo, calcPrice } from '../lib/utils';

export function MyListingsView() {
  // [FIX] Added viewItem to open listing details when tapped
  const { t, lang, rtl, user, myListings, deleteListing, viewItem, goTab, reset, orders, setView, loadOrders, viewOrder } = useApp();

  // Pending requests for seller
  const pendingRequests = orders.filter(o => o.seller_id === user?.id && o.status === 'pending');
  const activeOrders = orders.filter(o => (o.seller_id === user?.id || o.buyer_id === user?.id) && !['completed', 'cancelled', 'declined'].includes(o.status));

  return (
    <div className="space-y-5">
      <FadeIn className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t.myListings}</h2>
        {myListings.length > 0 && <Badge>{myListings.length} {lang === 'he' ? 'פעילים' : 'active'}</Badge>}
      </FadeIn>

      {/* ── Orders & Requests Button ── */}
      {user && (
        <FadeIn delay={50}>
          <button
            onClick={() => { setView('orders'); loadOrders(); }}
            className="w-full p-4 rounded-3xl flex items-center gap-4 transition-all active:scale-[0.98]"
            style={{
              background: pendingRequests.length > 0
                ? 'linear-gradient(135deg, rgba(245,158,11,0.15) 0%, rgba(217,119,6,0.1) 100%)'
                : 'linear-gradient(135deg, rgba(59,130,246,0.1) 0%, rgba(37,99,235,0.05) 100%)',
              border: pendingRequests.length > 0
                ? '1px solid rgba(245,158,11,0.3)'
                : '1px solid rgba(59,130,246,0.15)',
            }}
          >
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center relative ${pendingRequests.length > 0 ? 'bg-amber-500/20' : 'bg-blue-500/20'}`}>
              <Package className={`w-6 h-6 ${pendingRequests.length > 0 ? 'text-amber-400' : 'text-blue-400'}`} />
              {pendingRequests.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-amber-500 text-[10px] font-bold text-black flex items-center justify-center animate-pulse">
                  {pendingRequests.length}
                </span>
              )}
            </div>
            <div className="flex-1 text-left">
              <p className="font-bold text-white">
                {lang === 'he' ? 'הזמנות ובקשות' : 'Orders & Requests'}
              </p>
              <p className="text-xs text-slate-400">
                {pendingRequests.length > 0
                  ? (lang === 'he' ? `${pendingRequests.length} בקשות ממתינות` : `${pendingRequests.length} pending requests`)
                  : (lang === 'he' ? 'הצג היסטוריית עסקאות' : 'View transaction history')
                }
              </p>
            </div>
            {pendingRequests.length > 0 && (
              <div className="w-3 h-3 rounded-full bg-amber-500 animate-pulse" />
            )}
            <ChevronRight className="w-5 h-5 text-slate-500" />
          </button>
        </FadeIn>
      )}

      {/* Active orders summary */}
      {activeOrders.length > 0 && (
        <FadeIn delay={75}>
          <div className="space-y-2">
            <p className="text-xs text-slate-500 font-medium">{lang === 'he' ? 'עסקאות פעילות' : 'Active transactions'}</p>
            {activeOrders.slice(0, 3).map((order) => (
              <button key={order.id} onClick={() => viewOrder(order.id)}
                className="w-full p-3 rounded-xl bg-white/5 border border-white/10 flex items-center gap-3 hover:bg-white/10 transition-all">
                <div className={`w-2 h-2 rounded-full ${order.status === 'pending' ? 'bg-amber-400 animate-pulse' : 'bg-blue-400'}`} />
                <span className="text-sm flex-1 text-left truncate">{order.listing?.title || order.listing?.title_hebrew || 'Order'}</span>
                <Badge color={order.status === 'pending' ? 'amber' : 'blue'} className="text-[9px]">{order.status}</Badge>
              </button>
            ))}
          </div>
        </FadeIn>
      )}

      {myListings.length > 0 ? (
        <div className="space-y-4">
          {myListings.map((item, i) => (
            <FadeIn key={item.id} delay={i * 50}>
              <div className="relative">
                <ListingCard item={item} onClick={() => viewItem(item)} />
                <div className="absolute top-3 right-3 flex gap-2">
                  {item.condition && (
                    <Badge color="blue" className="text-[9px]">{item.condition}</Badge>
                  )}
                </div>
                <button onClick={() => deleteListing(item.id)}
                  className="absolute top-3 left-3 w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center backdrop-blur-md hover:bg-red-500/30 transition-all">
                  <Trash2 className="w-4 h-4 text-red-400" />
                </button>
              </div>
            </FadeIn>
          ))}
        </div>
      ) : (
        <FadeIn delay={100}>
          <Card className="p-10 text-center" gradient="linear-gradient(135deg, rgba(59,130,246,0.08), rgba(59,130,246,0.02))">
            <div className="w-20 h-20 rounded-3xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
              <ShoppingBag className="w-10 h-10 text-blue-400" />
            </div>
            <p className="text-slate-400 mb-4">{t.noListings}</p>
            <Btn primary onClick={() => goTab('home')}><Scan className="w-5 h-5" />{lang === 'he' ? 'סרוק פריט' : 'Scan an item'}</Btn>
          </Card>
        </FadeIn>
      )}
    </div>
  );
}

export function SavedView() {
  const { t, lang, rtl, savedItems, viewItem, toggleSave, user } = useApp();
  return (
    <div className="space-y-5">
      <FadeIn><h2 className="text-2xl font-bold">{t.saved}</h2></FadeIn>
      {savedItems.length > 0 ? (
        <div className="space-y-4">
          {savedItems.map((item, i) => (
            <FadeIn key={item.id} delay={i * 50}>
              <ListingCard item={item} onClick={() => viewItem(item)} />
            </FadeIn>
          ))}
        </div>
      ) : (
        <FadeIn delay={100}>
          <Card className="p-10 text-center" gradient="linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.02))">
            <div className="w-20 h-20 rounded-3xl bg-pink-500/10 flex items-center justify-center mx-auto mb-4">
              <Heart className="w-10 h-10 text-pink-400" />
            </div>
            <p className="text-slate-400">{t.noSaved}</p>
          </Card>
        </FadeIn>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// CATEGORY-SPECIFIC QUESTION DEFINITIONS
// Each question has: key, label (en/he), options with labels
// ═══════════════════════════════════════════════════════

const QUESTION_LABELS = {
  // ─── Common ───
  scratches:     { en: 'Any scratches or scuffs?', he: 'יש שריטות או פגמים?' },
  issues:        { en: 'Any functional issues?', he: 'יש בעיות תפקוד?' },
  accessories:   { en: 'Original accessories included?', he: 'אביזרים מקוריים כלולים?' },

  // ─── Electronics ───
  deviceType:    { en: 'What type of device?', he: 'איזה סוג מכשיר?' },
  battery:       { en: 'Battery health?', he: 'מצב סוללה?' },
  screenCond:    { en: 'Screen condition?', he: 'מצב מסך?' },
  charger:       { en: 'Charger included?', he: 'מטען כלול?' },
  storage:       { en: 'Storage capacity?', he: 'נפח אחסון?' },

  // ─── Furniture ───
  material:      { en: 'Main material?', he: 'חומר עיקרי?' },
  dimensions:    { en: 'Size?', he: 'גודל?' },
  assembly:      { en: 'Disassembly needed for pickup?', he: 'צריך פירוק לאיסוף?' },
  stains:        { en: 'Any stains or damage?', he: 'יש כתמים או נזק?' },

  // ─── Watches ───
  authenticity:  { en: 'Authenticity?', he: 'מקוריות?' },
  boxPapers:     { en: 'Original box & papers?', he: 'קופסה ומסמכים מקוריים?' },
  bracelet:      { en: 'Bracelet/strap condition?', he: 'מצב רצועה/צמיד?' },
  service:       { en: 'Recently serviced?', he: 'טופל לאחרונה?' },

  // ─── Clothing ───
  clothingSize:  { en: 'Size?', he: 'מידה?' },
  fabricType:    { en: 'Fabric type?', he: 'סוג בד?' },
  worn:          { en: 'How many times worn?', he: 'כמה פעמים נלבש?' },
  washed:        { en: 'Has been washed?', he: 'נשטף?' },
  defects:       { en: 'Any defects (holes, stains, fading)?', he: 'יש פגמים (חורים, כתמים, דהייה)?' },

  // ─── Sports ───
  sportType:     { en: 'Sport category?', he: 'סוג ספורט?' },
  usage:         { en: 'How much was it used?', he: 'כמה השתמשו?' },

  // ─── Beauty ───
  beautyType:    { en: 'Product type?', he: 'סוג מוצר?' },
  opened:        { en: 'Has it been opened/used?', he: 'נפתח/שומש?' },
  expiry:        { en: 'Within expiry date?', he: 'בתוקף?' },

  // ─── Vehicles ───
  vehicleType:   { en: 'Vehicle type?', he: 'סוג רכב?' },
  mileage:       { en: 'Usage level?', he: 'רמת שימוש?' },
  tires:         { en: 'Tires/wheels condition?', he: 'מצב צמיגים/גלגלים?' },

  // ─── Books ───
  bookCondition: { en: 'Book condition?', he: 'מצב הספר?' },
  pages:         { en: 'Pages condition?', he: 'מצב דפים?' },
  cover:         { en: 'Cover type?', he: 'סוג כריכה?' },

  // ─── Toys ───
  completeness:  { en: 'All pieces included?', he: 'כל החלקים כלולים?' },
  ageGroup:      { en: 'Age group?', he: 'קבוצת גיל?' },

  // ─── Home / Appliances ───
  workingCond:   { en: 'Working condition?', he: 'מצב עבודה?' },
  warranty:      { en: 'Under warranty?', he: 'באחריות?' },

  // ─── Tools ───
  powerSource:   { en: 'Power source?', he: 'מקור כוח?' },
  toolCondition: { en: 'Tool condition?', he: 'מצב הכלי?' },

  // ─── Smoking ───
  smokingType:   { en: 'Type?', he: 'סוג?' },
  cleanness:     { en: 'Cleanliness?', he: 'ניקיון?' },
};

const OPTION_LABELS = {
  // Common
  yes: { en: 'Yes', he: 'כן' },
  no: { en: 'No', he: 'לא' },
  some: { en: 'Minor', he: 'מעט' },
  none: { en: 'None', he: 'אין' },
  all: { en: 'All included', he: 'הכל כלול' },
  partial: { en: 'Some', he: 'חלק' },
  missing: { en: 'None', he: 'חסר' },

  // Battery
  good: { en: 'Good', he: 'טוב' },
  degraded: { en: 'Degraded', he: 'ירוד' },
  poor: { en: 'Poor', he: 'גרוע' },
  excellent: { en: 'Excellent', he: 'מצוין' },

  // Screen
  perfect: { en: 'Perfect', he: 'מושלם' },
  minorScratches: { en: 'Minor scratches', he: 'שריטות קלות' },
  cracked: { en: 'Cracked', he: 'סדוק' },

  // Device types
  phone:   { en: 'Phone', he: 'טלפון' },
  laptop:  { en: 'Laptop', he: 'מחשב נייד' },
  tablet:  { en: 'Tablet', he: 'טאבלט' },
  console: { en: 'Console', he: 'קונסולה' },
  tv:      { en: 'TV/Monitor', he: 'טלויזיה/מסך' },
  audio:   { en: 'Audio/Speaker', he: 'שמע/רמקול' },
  other:   { en: 'Other', he: 'אחר' },

  // Materials
  wood:     { en: 'Wood', he: 'עץ' },
  metal:    { en: 'Metal', he: 'מתכת' },
  fabric:   { en: 'Fabric', he: 'בד' },
  plastic:  { en: 'Plastic', he: 'פלסטיק' },
  leather:  { en: 'Leather', he: 'עור' },
  glass:    { en: 'Glass', he: 'זכוכית' },

  // Sizes
  xs:     { en: 'XS', he: 'XS' },
  small:  { en: 'S', he: 'S' },
  medium: { en: 'M', he: 'M' },
  large:  { en: 'L', he: 'L' },
  xl:     { en: 'XL', he: 'XL' },
  xxl:    { en: 'XXL', he: 'XXL' },

  // Dimensions
  compact: { en: 'Compact', he: 'קומפקטי' },
  standard: { en: 'Standard', he: 'סטנדרטי' },
  oversized: { en: 'Oversized', he: 'גדול' },

  // Fabric
  cotton:    { en: 'Cotton', he: 'כותנה' },
  synthetic: { en: 'Synthetic', he: 'סינתטי' },
  denim:     { en: 'Denim', he: 'ג\'ינס' },
  wool:      { en: 'Wool', he: 'צמר' },
  silk:      { en: 'Silk', he: 'משי' },

  // Authenticity
  original: { en: 'Original', he: 'מקורי' },
  replica:  { en: 'Replica', he: 'העתק' },
  unknown:  { en: 'Unknown', he: 'לא ידוע' },

  // Bracelet
  mint:     { en: 'Mint', he: 'כחדש' },
  wornLight: { en: 'Light wear', he: 'שחיקה קלה' },
  wornHeavy: { en: 'Heavy wear', he: 'שחיקה רבה' },

  // Wearing
  once:     { en: 'Once', he: 'פעם אחת' },
  few:      { en: 'A few times', he: 'כמה פעמים' },
  many:     { en: 'Many times', he: 'הרבה פעמים' },

  // Sport types
  gym:     { en: 'Gym/Fitness', he: 'חדר כושר' },
  cycling: { en: 'Cycling', he: 'רכיבה' },
  water:   { en: 'Water sports', he: 'ספורט מים' },
  ball:    { en: 'Ball sports', he: 'ספורט כדור' },
  outdoor: { en: 'Outdoor', he: 'חוץ' },
  running: { en: 'Running', he: 'ריצה' },

  // Usage
  light:  { en: 'Light use', he: 'שימוש קל' },
  moderate: { en: 'Moderate use', he: 'שימוש בינוני' },
  heavy:  { en: 'Heavy use', he: 'שימוש רב' },

  // Beauty types
  jewelry:   { en: 'Jewelry', he: 'תכשיטים' },
  cosmetics: { en: 'Cosmetics', he: 'קוסמטיקה' },
  skincare:  { en: 'Skincare', he: 'טיפוח עור' },
  haircare:  { en: 'Haircare', he: 'טיפוח שיער' },
  accessory: { en: 'Accessory', he: 'אביזר' },

  // Vehicle types
  car:        { en: 'Car', he: 'רכב' },
  motorcycle: { en: 'Motorcycle', he: 'אופנוע' },
  bicycle:    { en: 'Bicycle', he: 'אופניים' },
  scooter:    { en: 'Scooter', he: 'קורקינט' },
  skateboard: { en: 'Skateboard', he: 'סקייטבורד' },

  // Book condition
  likeNew:  { en: 'Like new', he: 'כחדש' },
  worn:     { en: 'Worn', he: 'שחוק' },
  damaged:  { en: 'Damaged', he: 'פגום' },

  // Pages
  clean:    { en: 'Clean', he: 'נקי' },
  marked:   { en: 'Some markings', he: 'סימונים' },
  yellowed: { en: 'Yellowed', he: 'מצהיב' },

  // Cover
  hardcover:  { en: 'Hardcover', he: 'כריכה קשה' },
  softcover:  { en: 'Softcover', he: 'כריכה רכה' },

  // Toys
  complete:   { en: 'Complete', he: 'שלם' },
  mostParts:  { en: 'Most parts', he: 'רוב החלקים' },
  incomplete: { en: 'Incomplete', he: 'חסר חלקים' },
  toddler:    { en: '0-3', he: '0-3' },
  kids:       { en: '3-8', he: '3-8' },
  older:      { en: '8+', he: '8+' },

  // Power
  electric:   { en: 'Electric', he: 'חשמלי' },
  battery:    { en: 'Battery', he: 'סוללה' },
  manual:     { en: 'Manual', he: 'ידני' },
  cordless:   { en: 'Cordless', he: 'אלחוטי' },

  // Working condition
  fullyWorking:   { en: 'Fully working', he: 'עובד מלא' },
  partiallyWorks: { en: 'Partially works', he: 'עובד חלקית' },
  notWorking:     { en: 'Not working', he: 'לא עובד' },

  // Storage
  '16gb':  { en: '16GB', he: '16GB' },
  '32gb':  { en: '32GB', he: '32GB' },
  '64gb':  { en: '64GB', he: '64GB' },
  '128gb': { en: '128GB', he: '128GB' },
  '256gb': { en: '256GB', he: '256GB' },
  '512gb': { en: '512GB', he: '512GB' },
  '1tb':   { en: '1TB+', he: '1TB+' },

  // Smoking
  hookah:    { en: 'Hookah', he: 'נרגילה' },
  vape:      { en: 'Vape', he: 'סיגריה אלקטרונית' },
  pipe:      { en: 'Pipe', he: 'מקטרת' },
  smokingOther: { en: 'Other', he: 'אחר' },
  clean_:    { en: 'Clean', he: 'נקי' },
  lightUse:  { en: 'Light residue', he: 'שאריות קלות' },
  needsClean: { en: 'Needs cleaning', he: 'דורש ניקוי' },
};

// ═══════════════════════════════════════════════════════
// CATEGORY → QUESTION SCHEMA
// ═══════════════════════════════════════════════════════

function getQuestionsForCategory(category, answers = {}) {
  const base = [
    { key: 'scratches', opts: ['none', 'some', 'yes'] },
    { key: 'issues', opts: ['no', 'yes'] },
  ];

  switch (category) {
    case 'Electronics': {
      const deviceType = answers.deviceType;
      const hasBattery = ['phone', 'laptop', 'tablet'].includes(deviceType);
      const hasScreen = ['phone', 'laptop', 'tablet', 'tv'].includes(deviceType);
      const questions = [
        { key: 'deviceType', opts: ['phone', 'laptop', 'tablet', 'console', 'tv', 'audio', 'other'], wrap: true },
      ];
      if (hasScreen) {
        questions.push({ key: 'screenCond', opts: ['perfect', 'minorScratches', 'cracked'] });
      }
      if (hasBattery) {
        questions.push({ key: 'battery', opts: ['good', 'degraded', 'poor'] });
      }
      questions.push(
        { key: 'accessories', opts: ['all', 'partial', 'missing'] },
        { key: 'charger', opts: ['yes', 'no'] },
        ...base,
      );
      return questions;
    }

    case 'Furniture':
      return [
        { key: 'material', opts: ['wood', 'metal', 'fabric', 'plastic', 'leather', 'glass'], wrap: true },
        { key: 'dimensions', opts: ['compact', 'standard', 'oversized'] },
        { key: 'stains', opts: ['none', 'some', 'yes'] },
        { key: 'assembly', opts: ['yes', 'no'] },
        ...base,
      ];

    case 'Watches':
      return [
        { key: 'authenticity', opts: ['original', 'replica', 'unknown'] },
        { key: 'boxPapers', opts: ['yes', 'partial', 'no'] },
        { key: 'bracelet', opts: ['mint', 'wornLight', 'wornHeavy'] },
        { key: 'service', opts: ['yes', 'no', 'unknown'] },
        ...base,
      ];

    case 'Clothing':
      return [
        { key: 'clothingSize', opts: ['xs', 'small', 'medium', 'large', 'xl', 'xxl'], wrap: true },
        { key: 'fabricType', opts: ['cotton', 'synthetic', 'denim', 'wool', 'leather', 'silk'], wrap: true },
        { key: 'worn', opts: ['once', 'few', 'many'] },
        { key: 'washed', opts: ['yes', 'no'] },
        { key: 'defects', opts: ['none', 'some', 'yes'] },
      ];

    case 'Sports':
      return [
        { key: 'sportType', opts: ['gym', 'cycling', 'water', 'ball', 'outdoor', 'running', 'other'], wrap: true },
        { key: 'usage', opts: ['light', 'moderate', 'heavy'] },
        ...base,
      ];

    case 'Beauty':
      return [
        { key: 'beautyType', opts: ['jewelry', 'cosmetics', 'skincare', 'haircare', 'accessory'], wrap: true },
        { key: 'opened', opts: ['no', 'yes'] },
        { key: 'expiry', opts: ['yes', 'no', 'unknown'] },
        { key: 'authenticity', opts: ['original', 'replica', 'unknown'] },
      ];

    case 'Vehicles':
      return [
        { key: 'vehicleType', opts: ['car', 'motorcycle', 'bicycle', 'scooter', 'skateboard', 'other'], wrap: true },
        { key: 'mileage', opts: ['light', 'moderate', 'heavy'] },
        { key: 'tires', opts: ['good', 'degraded', 'poor'] },
        ...base,
      ];

    case 'Books':
      return [
        { key: 'bookCondition', opts: ['likeNew', 'good', 'worn', 'damaged'] },
        { key: 'pages', opts: ['clean', 'marked', 'yellowed'] },
        { key: 'cover', opts: ['hardcover', 'softcover'] },
      ];

    case 'Toys':
      return [
        { key: 'completeness', opts: ['complete', 'mostParts', 'incomplete'] },
        { key: 'ageGroup', opts: ['toddler', 'kids', 'older'] },
        ...base,
      ];

    case 'Home':
      return [
        { key: 'workingCond', opts: ['fullyWorking', 'partiallyWorks', 'notWorking'] },
        { key: 'warranty', opts: ['yes', 'no', 'unknown'] },
        { key: 'accessories', opts: ['all', 'partial', 'missing'] },
        ...base,
      ];

    case 'Tools':
      return [
        { key: 'powerSource', opts: ['electric', 'cordless', 'manual'] },
        { key: 'toolCondition', opts: ['excellent', 'good', 'degraded'] },
        { key: 'accessories', opts: ['all', 'partial', 'missing'] },
        ...base,
      ];

    case 'Smoking':
      return [
        { key: 'smokingType', opts: ['hookah', 'vape', 'pipe', 'smokingOther'], wrap: true },
        { key: 'cleanness', opts: ['clean_', 'lightUse', 'needsClean'] },
        { key: 'accessories', opts: ['all', 'partial', 'missing'] },
        ...base,
      ];

    default:
      // Music, Food, Other — generic questions
      return [...base];
  }
}

// Helper: get localized label
function qLabel(key, lang) {
  const l = QUESTION_LABELS[key];
  if (!l) return key;
  return lang === 'he' ? l.he : l.en;
}

function oLabel(opt, lang) {
  const l = OPTION_LABELS[opt];
  if (!l) return opt;
  return lang === 'he' ? l.he : l.en;
}


// ═══════════════════════════════════════════════════════
// LISTING FLOW VIEW
// ═══════════════════════════════════════════════════════

export function ListingFlowView() {
  const {
    t, lang, rtl, result, condition, answers, setAnswers,
    listingStep, setListingStep, listingData, setListingData,
    images, setImages,
    publishing, publishListing, selectCondition, setView,
    reset, goTab, playSound,
  } = useApp();

  const fileInputRef = useRef(null);

  const itemCategory = (result?.category || 'Other').trim();
  const categoryQuestions = getQuestionsForCategory(itemCategory, answers);

  const addMoreImages = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImages((prev) => {
          if (prev.length >= 6) return prev;
          return [...prev, ev.target.result];
        });
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  if (!result) return null;

  return (
    <div className="space-y-5">
      {/* Step 0: Condition */}
      {listingStep === 0 && (
        <>
          <BackButton onClick={() => setView('results')} rtl={rtl} label={t.back} />
          <FadeIn className="text-center"><h2 className="text-2xl font-bold">{t.condition}</h2></FadeIn>
          <div className="space-y-3">
            {[
              { id: 'newSealed', icon: Box, gradient: 'from-emerald-500 to-green-500' },
              { id: 'likeNew', icon: Sparkles, gradient: 'from-blue-500 to-cyan-500' },
              { id: 'used', icon: Package, gradient: 'from-amber-500 to-orange-500' },
              { id: 'poor', icon: AlertTriangle, gradient: 'from-red-500 to-pink-500' }
            ].map((c, i) => (
              <FadeIn key={c.id} delay={i * 50}>
                <button onClick={() => selectCondition(c.id)}
                  className={`w-full p-5 rounded-2xl border-2 flex items-center gap-4 transition-all ${condition === c.id ? 'border-blue-500 bg-blue-500/10 scale-[1.02]' : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/5'}`}>
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

      {/* Step 1: Category-specific condition questions */}
      {listingStep === 1 && (
        <>
          <BackButton onClick={() => setListingStep(0)} rtl={rtl} label={t.back} />
          <FadeIn className="text-center">
            <h2 className="text-2xl font-bold">{lang === 'he' ? 'ספר לנו עוד' : 'Tell us more'}</h2>
            <p className="text-xs text-slate-500 mt-1">
              {lang === 'he' ? `פרטים ספציפיים ל${itemCategory}` : `${itemCategory}-specific details`}
            </p>
          </FadeIn>
          <div className="space-y-4">
            {categoryQuestions.map((q, i) => (
              <FadeIn key={q.key} delay={i * 50}>
                <Card className="p-5">
                  <p className="font-medium mb-3">{qLabel(q.key, lang)}</p>
                  <div className={`flex gap-2 ${q.wrap ? 'flex-wrap' : ''}`}>
                    {q.opts.map((o) => (
                      <button key={o} onClick={() => setAnswers({ ...answers, [q.key]: o })}
                        className={`${q.wrap ? 'px-3' : 'flex-1'} py-3 rounded-xl text-sm font-medium transition-all ${
                          answers[q.key] === o
                            ? 'bg-blue-600 shadow-lg shadow-blue-500/30 text-white'
                            : 'bg-white/5 hover:bg-white/10 text-slate-300'
                        }`}>
                        {oLabel(o, lang)}
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
                {formatPrice(calcPrice(result?.marketValue?.mid, condition, answers, itemCategory))}
              </p>
            </Card>
          </FadeIn>
          <FadeIn delay={200}>
            <Btn primary className="w-full py-4" onClick={() => {
              setListingData((prev) => ({
                ...prev,
                price: calcPrice(result?.marketValue?.mid, condition, answers, itemCategory),
              }));
              setListingStep(2);
            }}>
              {t.continue}
            </Btn>
          </FadeIn>
        </>
      )}

      {/* Step 2: Review listing */}
      {listingStep === 2 && (
        <>
          <BackButton onClick={() => setListingStep((condition === 'used' || condition === 'poor') ? 1 : 0)} rtl={rtl} label={t.back} />
          <FadeIn className="text-center"><h2 className="text-2xl font-bold">{t.review}</h2></FadeIn>

          {/* Image management strip */}
          <FadeIn delay={25}>
            <div className="space-y-2">
              <label className="text-sm text-slate-400 font-medium flex items-center gap-2">
                <Camera className="w-4 h-4" />
                {lang === 'he' ? 'תמונות' : 'Photos'} ({images.length}/6)
              </label>
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                {images.map((img, i) => (
                  <div key={i} className="relative flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 border-white/10">
                    <img src={img} alt="" className="w-full h-full object-cover" />
                    {images.length > 1 && (
                      <button
                        onClick={() => removeImage(i)}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                    {i === 0 && (
                      <div className="absolute bottom-0 inset-x-0 bg-blue-600/90 text-[8px] font-bold text-center py-0.5">
                        {lang === 'he' ? 'ראשית' : 'Cover'}
                      </div>
                    )}
                  </div>
                ))}
                {images.length < 6 && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-shrink-0 w-20 h-20 rounded-xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center gap-1 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all"
                  >
                    <Plus className="w-5 h-5 text-slate-500" />
                    <span className="text-[9px] text-slate-500">{lang === 'he' ? 'הוסף' : 'Add'}</span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={addMoreImages}
                  className="hidden"
                />
              </div>
              {images.length < 2 && (
                <p className="text-[10px] text-amber-400/80 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {lang === 'he' ? 'הוסף עוד תמונה לדירוג איכות גבוה יותר' : 'Add more photos for a higher quality score'}
                </p>
              )}
            </div>
          </FadeIn>

          <FadeIn delay={50}><InputField label={t.title} rtl={rtl} value={listingData.title} onChange={(e) => setListingData({ ...listingData, title: e.target.value })} /></FadeIn>
          <FadeIn delay={100}>
            <div className="space-y-2">
              <label className="text-sm text-slate-400 font-medium">{t.desc}</label>
              <textarea className="w-full px-4 py-4 rounded-2xl bg-white/5 border border-white/10 h-28 resize-none focus:border-blue-500/50 focus:bg-white/10 transition-all"
                value={listingData.desc} onChange={(e) => setListingData({ ...listingData, desc: e.target.value })} />
            </div>
          </FadeIn>
          <FadeIn delay={150}>
            <Card className="p-5" gradient="linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.02))">
              <span className="text-sm text-slate-400">{t.yourPrice}</span>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-3xl font-bold text-green-400">₪</span>
                <input type="number" className="flex-1 bg-transparent text-3xl font-bold text-green-400 focus:outline-none"
                  value={listingData.price} onChange={(e) => setListingData({ ...listingData, price: parseInt(e.target.value) || 0 })} />
              </div>
            </Card>
          </FadeIn>
          <FadeIn delay={200}><InputField label={t.phone} icon={Phone} rtl={rtl} placeholder="050-000-0000" value={listingData.phone} onChange={(e) => setListingData({ ...listingData, phone: e.target.value })} /></FadeIn>
          <FadeIn delay={250}>
            <LocationInput label={t.location} rtl={rtl} value={listingData.location}
              onChange={(e) => setListingData({ ...listingData, location: e.target.value })}
              placeholder={rtl ? 'תל אביב, ירושלים...' : 'Tel Aviv, Jerusalem...'} />
          </FadeIn>
          <FadeIn delay={300}>
            <Btn primary className="w-full py-4" onClick={publishListing} disabled={publishing}>
              {publishing ? <><Loader2 className="w-5 h-5 animate-spin" />{t.publishing}</> : <><Check className="w-5 h-5" />{t.publish}</>}
            </Btn>
          </FadeIn>
        </>
      )}

      {/* Step 3: Success */}
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
  );
}