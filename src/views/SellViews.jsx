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

  // Pending requests for seller — guard against orders being undefined during init
  const pendingRequests = (orders || []).filter(o => o.seller_id === user?.id && o.status === 'pending');
  const activeOrders = (orders || []).filter(o => (o.seller_id === user?.id || o.buyer_id === user?.id) && !['completed', 'cancelled', 'declined'].includes(o.status));

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
  connectivity:  { en: 'Connectivity?', he: 'קישוריות?' },
  noiseCancelling: { en: 'Noise cancelling?', he: 'מסנן רעשים?' },
  earpads:       { en: 'Earpads condition?', he: 'מצב כריות אוזניים?' },
  bandFit:       { en: 'Band/strap condition?', he: 'מצב רצועה?' },
  waterResist:   { en: 'Water resistance working?', he: 'עמידות במים תקינה?' },
  sensorAccuracy: { en: 'Sensors accurate?', he: 'חיישנים מדויקים?' },
  controllerType: { en: 'Controller count?', he: 'מספר שלטים?' },
  discDrive:     { en: 'Disc drive?', he: 'כונן דיסקים?' },
  panelType:     { en: 'Panel type?', he: 'סוג פאנל?' },
  screenSize:    { en: 'Screen size?', he: 'גודל מסך?' },
  smartFeatures: { en: 'Smart features?', he: 'תכונות חכמות?' },
  speakerType:   { en: 'Speaker type?', he: 'סוג רמקול?' },
  soundQuality:  { en: 'Sound quality?', he: 'איכות שמע?' },

  // ─── Furniture ───
  material:      { en: 'Main material?', he: 'חומר עיקרי?' },
  dimensions:    { en: 'Size?', he: 'גודל?' },
  assembly:      { en: 'Disassembly needed for pickup?', he: 'צריך פירוק לאיסוף?' },
  stains:        { en: 'Any stains or damage?', he: 'יש כתמים או נזק?' },
  furnitureType: { en: 'Furniture type?', he: 'סוג רהיט?' },
  mattressType:  { en: 'Mattress type?', he: 'סוג מזרן?' },
  firmness:      { en: 'Firmness?', he: 'קשיחות?' },
  seatCount:     { en: 'Seat count?', he: 'מספר מושבים?' },
  upholstery:    { en: 'Upholstery condition?', he: 'מצב ריפוד?' },
  tableShape:    { en: 'Table shape?', he: 'צורת שולחן?' },
  tableSeats:    { en: 'Seats how many?', he: 'כמה מקומות?' },
  shelvesCount:  { en: 'Number of shelves/drawers?', he: 'מספר מדפים/מגירות?' },
  doorType:      { en: 'Door type?', he: 'סוג דלתות?' },

  // ─── Watches ───
  authenticity:  { en: 'Authenticity?', he: 'מקוריות?' },
  boxPapers:     { en: 'Original box & papers?', he: 'קופסה ומסמכים מקוריים?' },
  bracelet:      { en: 'Bracelet/strap condition?', he: 'מצב רצועה/צמיד?' },
  service:       { en: 'Recently serviced?', he: 'טופל לאחרונה?' },
  watchType:     { en: 'Watch type?', he: 'סוג שעון?' },
  movement:      { en: 'Movement type?', he: 'סוג מנגנון?' },
  crystalCond:   { en: 'Crystal condition?', he: 'מצב זכוכית?' },

  // ─── Clothing ───
  clothingSize:  { en: 'Size?', he: 'מידה?' },
  fabricType:    { en: 'Fabric type?', he: 'סוג בד?' },
  worn:          { en: 'How many times worn?', he: 'כמה פעמים נלבש?' },
  washed:        { en: 'Has been washed?', he: 'נשטף?' },
  defects:       { en: 'Any defects (holes, stains, fading)?', he: 'יש פגמים (חורים, כתמים, דהייה)?' },
  clothingType:  { en: 'Clothing type?', he: 'סוג ביגוד?' },
  shoeSize:      { en: 'Shoe size (EU)?', he: 'מידת נעל (EU)?' },
  soleCond:      { en: 'Sole condition?', he: 'מצב סוליה?' },
  colorFading:   { en: 'Any color fading?', he: 'דהיית צבע?' },
  zipButtons:    { en: 'Zippers & buttons working?', he: 'רוכסנים וכפתורים תקינים?' },
  fitType:       { en: 'Fit?', he: 'גזרה?' },

  // ─── Sports ───
  sportType:     { en: 'Sport category?', he: 'סוג ספורט?' },
  usage:         { en: 'How much was it used?', he: 'כמה השתמשו?' },
  sportSubtype:  { en: 'Equipment type?', he: 'סוג ציוד?' },
  frameSize:     { en: 'Frame size?', he: 'גודל שלדה?' },
  gears:         { en: 'Gear system working?', he: 'מערכת הילוכים תקינה?' },
  brakes:        { en: 'Brakes condition?', he: 'מצב בלמים?' },
  weightCapacity: { en: 'Weight capacity?', he: 'קיבולת משקל?' },
  resistance:    { en: 'Resistance levels?', he: 'רמות התנגדות?' },

  // ─── Beauty ───
  beautyType:    { en: 'Product type?', he: 'סוג מוצר?' },
  opened:        { en: 'Has it been opened/used?', he: 'נפתח/שומש?' },
  expiry:        { en: 'Within expiry date?', he: 'בתוקף?' },
  volumeSize:    { en: 'Size/volume?', he: 'גודל/נפח?' },
  scent:         { en: 'Scent?', he: 'ריח?' },
  shade:         { en: 'Shade/color?', he: 'גוון/צבע?' },
  finish:        { en: 'Finish type?', he: 'סוג גימור?' },
  colorType:     { en: 'Color type?', he: 'סוג צבע?' },
  scentNotes:    { en: 'Scent family?', he: 'משפחת ריח?' },
  perfumeSize:   { en: 'Bottle size?', he: 'גודל בקבוק?' },
  spf:           { en: 'SPF protection?', he: 'הגנת SPF?' },
  skinType:      { en: 'For skin type?', he: 'לסוג עור?' },
  amountLeft:    { en: 'Amount remaining?', he: 'כמות שנותרה?' },
  jewelryMetal:  { en: 'Metal type?', he: 'סוג מתכת?' },
  gemstone:      { en: 'Gemstone?', he: 'אבן חן?' },
  certificate:   { en: 'Certificate included?', he: 'תעודה כלולה?' },

  // ─── Vehicles ───
  vehicleType:   { en: 'Vehicle type?', he: 'סוג רכב?' },
  mileage:       { en: 'Usage level?', he: 'רמת שימוש?' },
  tires:         { en: 'Tires/wheels condition?', he: 'מצב צמיגים/גלגלים?' },
  km:            { en: 'Kilometers?', he: 'קילומטרים?' },
  year:          { en: 'Year?', he: 'שנה?' },
  engineType:    { en: 'Engine type?', he: 'סוג מנוע?' },
  bikeType:      { en: 'Bike type?', he: 'סוג אופניים?' },
  electricRange: { en: 'Range per charge?', he: 'טווח למטען?' },
  maxSpeed:      { en: 'Max speed?', he: 'מהירות מקסימלית?' },

  // ─── Books ───
  bookCondition: { en: 'Book condition?', he: 'מצב הספר?' },
  pages:         { en: 'Pages condition?', he: 'מצב דפים?' },
  cover:         { en: 'Cover type?', he: 'סוג כריכה?' },
  bookType:      { en: 'Book type?', he: 'סוג ספר?' },
  genre:         { en: 'Genre?', he: 'ז\'אנר?' },
  edition:       { en: 'Edition?', he: 'מהדורה?' },

  // ─── Toys ───
  completeness:  { en: 'All pieces included?', he: 'כל החלקים כלולים?' },
  ageGroup:      { en: 'Age group?', he: 'קבוצת גיל?' },
  toyType:       { en: 'Toy type?', he: 'סוג צעצוע?' },
  pieceCount:    { en: 'Piece count?', he: 'מספר חלקים?' },
  builtStatus:   { en: 'Built or sealed?', he: 'בנוי או סגור?' },

  // ─── Home / Appliances ───
  workingCond:   { en: 'Working condition?', he: 'מצב עבודה?' },
  warranty:      { en: 'Under warranty?', he: 'באחריות?' },
  homeType:      { en: 'Appliance type?', he: 'סוג מכשיר?' },
  energyRating:  { en: 'Energy rating?', he: 'דירוג אנרגיה?' },
  noise:         { en: 'Noise level?', he: 'רמת רעש?' },
  filterCond:    { en: 'Filter/bag condition?', he: 'מצב פילטר/שקית?' },

  // ─── Tools ───
  powerSource:   { en: 'Power source?', he: 'מקור כוח?' },
  toolCondition: { en: 'Tool condition?', he: 'מצב הכלי?' },
  toolType:      { en: 'Tool type?', he: 'סוג כלי?' },
  bladeBit:      { en: 'Blade/bit condition?', he: 'מצב להב/מקדח?' },

  // ─── Smoking ───
  smokingType:   { en: 'Type?', he: 'סוג?' },
  cleanness:     { en: 'Cleanliness?', he: 'ניקיון?' },
  hoseCount:     { en: 'Number of hoses?', he: 'מספר צינורות?' },
  bowlCond:      { en: 'Bowl condition?', he: 'מצב ראש?' },
  coilType:      { en: 'Coil type?', he: 'סוג סליל?' },
  liquidIncluded: { en: 'Liquid included?', he: 'נוזל כלול?' },
};

const OPTION_LABELS = {
  // ─── Common ───
  yes: { en: 'Yes', he: 'כן' },
  no: { en: 'No', he: 'לא' },
  some: { en: 'Minor', he: 'מעט' },
  none: { en: 'None', he: 'אין' },
  all: { en: 'All included', he: 'הכל כלול' },
  partial: { en: 'Some', he: 'חלק' },
  missing: { en: 'None', he: 'חסר' },
  good: { en: 'Good', he: 'טוב' },
  degraded: { en: 'Degraded', he: 'ירוד' },
  poor: { en: 'Poor', he: 'גרוע' },
  excellent: { en: 'Excellent', he: 'מצוין' },
  unknown:  { en: 'Unknown', he: 'לא ידוע' },
  other:    { en: 'Other', he: 'אחר' },

  // ─── Electronics device types ───
  phone:   { en: 'Phone', he: 'טלפון' },
  laptop:  { en: 'Laptop', he: 'מחשב נייד' },
  tablet:  { en: 'Tablet', he: 'טאבלט' },
  console: { en: 'Console', he: 'קונסולה' },
  tv:      { en: 'TV/Monitor', he: 'טלויזיה/מסך' },
  audio:   { en: 'Audio/Speaker', he: 'שמע/רמקול' },
  headphones: { en: 'Headphones', he: 'אוזניות' },
  smartwatch: { en: 'Smartwatch', he: 'שעון חכם' },
  camera:  { en: 'Camera', he: 'מצלמה' },

  // Screen
  perfect: { en: 'Perfect', he: 'מושלם' },
  minorScratches: { en: 'Minor scratches', he: 'שריטות קלות' },
  cracked: { en: 'Cracked', he: 'סדוק' },

  // Connectivity
  wired:       { en: 'Wired', he: 'חוטי' },
  wireless:    { en: 'Wireless/BT', he: 'אלחוטי/BT' },
  both:        { en: 'Both', he: 'שניהם' },
  overEar:     { en: 'Over-ear', he: 'על האוזן' },
  onEar:       { en: 'On-ear', he: 'על האוזן קטן' },
  inEar:       { en: 'In-ear', he: 'תוך-אוזני' },

  // Console
  oneCtrl:     { en: '1 controller', he: 'שלט אחד' },
  twoCtrl:     { en: '2 controllers', he: '2 שלטים' },
  noCtrl:      { en: 'No controller', he: 'ללא שלט' },
  yesDisc:     { en: 'Yes (disc)', he: 'כן (דיסק)' },
  digital:     { en: 'Digital only', he: 'דיגיטלי בלבד' },

  // TV
  led: { en: 'LED', he: 'LED' },
  oled: { en: 'OLED', he: 'OLED' },
  qled: { en: 'QLED', he: 'QLED' },
  lcd: { en: 'LCD', he: 'LCD' },
  under32: { en: 'Under 32"', he: 'מתחת ל-32"' },
  sz32to43: { en: '32-43"', he: '32-43"' },
  sz43to55: { en: '43-55"', he: '43-55"' },
  sz55plus: { en: '55"+', he: '55"+' },

  // Speaker
  portable: { en: 'Portable/BT', he: 'נייד/BT' },
  soundbar: { en: 'Soundbar', he: 'סאונדבר' },
  hifi:     { en: 'Hi-Fi/Stereo', he: 'Hi-Fi/סטריאו' },
  subwoofer: { en: 'Subwoofer', he: 'סאבוופר' },

  // Storage
  '16gb':  { en: '16GB', he: '16GB' },
  '32gb':  { en: '32GB', he: '32GB' },
  '64gb':  { en: '64GB', he: '64GB' },
  '128gb': { en: '128GB', he: '128GB' },
  '256gb': { en: '256GB', he: '256GB' },
  '512gb': { en: '512GB', he: '512GB' },
  '1tb':   { en: '1TB+', he: '1TB+' },

  // ─── Furniture subtypes ───
  sofa:    { en: 'Sofa/Couch', he: 'ספה' },
  bed:     { en: 'Bed/Mattress', he: 'מיטה/מזרן' },
  table:   { en: 'Table/Desk', he: 'שולחן' },
  chair:   { en: 'Chair', he: 'כיסא' },
  closet:  { en: 'Closet/Shelf', he: 'ארון/מדף' },
  furnitureOther: { en: 'Other', he: 'אחר' },

  // Materials
  wood:     { en: 'Wood', he: 'עץ' },
  metal:    { en: 'Metal', he: 'מתכת' },
  fabric:   { en: 'Fabric', he: 'בד' },
  plastic:  { en: 'Plastic', he: 'פלסטיק' },
  leather:  { en: 'Leather', he: 'עור' },
  glass:    { en: 'Glass', he: 'זכוכית' },

  // Dimensions / mattress
  compact:   { en: 'Compact', he: 'קומפקטי' },
  standard:  { en: 'Standard', he: 'סטנדרטי' },
  oversized: { en: 'Oversized', he: 'גדול' },
  spring:    { en: 'Spring', he: 'קפיצים' },
  foam:      { en: 'Foam/Memory', he: 'ספוג/מרובד' },
  latex:     { en: 'Latex', he: 'לטקס' },
  hybrid:    { en: 'Hybrid', he: 'משולב' },
  soft:      { en: 'Soft', he: 'רך' },
  medFirm:   { en: 'Medium-Firm', he: 'בינוני-קשיח' },
  firm:      { en: 'Firm', he: 'קשיח' },
  seats2:    { en: '2-seat', he: '2 מושבים' },
  seats3:    { en: '3-seat', he: '3 מושבים' },
  sectional: { en: 'Sectional', he: 'פינתית' },
  round:     { en: 'Round', he: 'עגול' },
  rectangular: { en: 'Rectangular', he: 'מלבני' },
  adjustable: { en: 'Adjustable', he: 'מתכוונן' },
  seats4:    { en: '4 seats', he: '4 מקומות' },
  seats6:    { en: '6 seats', he: '6 מקומות' },
  seats8plus: { en: '8+ seats', he: '8+ מקומות' },
  shelves2:  { en: '1-2', he: '1-2' },
  shelves4:  { en: '3-4', he: '3-4' },
  shelves6:  { en: '5+', he: '5+' },
  sliding:   { en: 'Sliding', he: 'הזזה' },
  hinged:    { en: 'Hinged', he: 'ציר' },
  open:      { en: 'Open', he: 'פתוח' },

  // ─── Watches subtypes ───
  analog:    { en: 'Analog', he: 'אנלוגי' },
  digitalW:  { en: 'Digital', he: 'דיגיטלי' },
  smartW:    { en: 'Smartwatch', he: 'שעון חכם' },
  luxuryW:   { en: 'Luxury', he: 'יוקרה' },
  automatic: { en: 'Automatic', he: 'אוטומטי' },
  quartz:    { en: 'Quartz', he: 'קוורץ' },
  manualW:   { en: 'Manual wind', he: 'מכני' },
  solar:     { en: 'Solar', he: 'סולארי' },
  original:  { en: 'Original', he: 'מקורי' },
  replica:   { en: 'Replica', he: 'העתק' },
  mint:      { en: 'Mint', he: 'כחדש' },
  wornLight: { en: 'Light wear', he: 'שחיקה קלה' },
  wornHeavy: { en: 'Heavy wear', he: 'שחיקה רבה' },

  // ─── Clothing subtypes ───
  tshirt:    { en: 'T-shirt/Top', he: 'חולצה' },
  jacket:    { en: 'Jacket/Coat', he: 'ז\'קט/מעיל' },
  jeans:     { en: 'Jeans/Pants', he: 'ג\'ינס/מכנסיים' },
  dress:     { en: 'Dress/Skirt', he: 'שמלה/חצאית' },
  shoes:     { en: 'Shoes', he: 'נעליים' },
  bag:       { en: 'Bag/Purse', he: 'תיק' },
  clothingOther: { en: 'Other', he: 'אחר' },

  // Sizes
  xs:     { en: 'XS', he: 'XS' },
  small:  { en: 'S', he: 'S' },
  medium: { en: 'M', he: 'M' },
  large:  { en: 'L', he: 'L' },
  xl:     { en: 'XL', he: 'XL' },
  xxl:    { en: 'XXL', he: 'XXL' },

  // Fabric
  cotton:    { en: 'Cotton', he: 'כותנה' },
  synthetic: { en: 'Synthetic', he: 'סינתטי' },
  denim:     { en: 'Denim', he: "ג'ינס" },
  wool:      { en: 'Wool', he: 'צמר' },
  silk:      { en: 'Silk', he: 'משי' },

  // Wearing
  once:     { en: 'Once', he: 'פעם אחת' },
  few:      { en: 'A few times', he: 'כמה פעמים' },
  many:     { en: 'Many times', he: 'הרבה פעמים' },

  // Shoes
  eu36: { en: '36', he: '36' }, eu37: { en: '37', he: '37' }, eu38: { en: '38', he: '38' },
  eu39: { en: '39', he: '39' }, eu40: { en: '40', he: '40' }, eu41: { en: '41', he: '41' },
  eu42: { en: '42', he: '42' }, eu43: { en: '43', he: '43' }, eu44: { en: '44', he: '44' },
  eu45plus: { en: '45+', he: '45+' },
  soleGood: { en: 'Good', he: 'טוב' },
  soleWorn: { en: 'Worn', he: 'שחוק' },
  soleDamaged: { en: 'Damaged', he: 'פגום' },

  // Fit
  slim:    { en: 'Slim', he: 'צר' },
  regular: { en: 'Regular', he: 'רגיל' },
  loose:   { en: 'Loose/Oversized', he: 'רחב/אוברסייז' },

  // ─── Sports subtypes ───
  gym:     { en: 'Gym/Fitness', he: 'חדר כושר' },
  cycling: { en: 'Cycling', he: 'רכיבה' },
  water:   { en: 'Water sports', he: 'ספורט מים' },
  ball:    { en: 'Ball sports', he: 'ספורט כדור' },
  outdoor: { en: 'Outdoor', he: 'חוץ' },
  running: { en: 'Running', he: 'ריצה' },
  light:   { en: 'Light use', he: 'שימוש קל' },
  moderate: { en: 'Moderate use', he: 'שימוש בינוני' },
  heavy:   { en: 'Heavy use', he: 'שימוש רב' },
  gymMachine: { en: 'Machine/Bench', he: 'מכשיר/ספסל' },
  weights: { en: 'Weights/Dumbbells', he: 'משקולות' },
  cardio:  { en: 'Treadmill/Bike', he: 'הליכון/אופניים' },
  yogaMat: { en: 'Mat/Accessories', he: 'מזרן/אביזרים' },
  road:    { en: 'Road', he: 'כביש' },
  mountain: { en: 'Mountain', he: 'הרים' },
  cityBike: { en: 'City/Hybrid', he: 'עירוני' },
  ebike:   { en: 'Electric', he: 'חשמלי' },

  // ─── Beauty subtypes ───
  shampoo:   { en: 'Shampoo/Hair', he: 'שמפו/שיער' },
  makeup:    { en: 'Makeup', he: 'איפור' },
  hairColor: { en: 'Hair color', he: 'צבע שיער' },
  perfume:   { en: 'Perfume', he: 'בושם' },
  skincare:  { en: 'Skincare', he: 'טיפוח עור' },
  haircare:  { en: 'Haircare', he: 'טיפוח שיער' },
  jewelry:   { en: 'Jewelry', he: 'תכשיטים' },
  cosmetics: { en: 'Cosmetics', he: 'קוסמטיקה' },
  accessory: { en: 'Accessory', he: 'אביזר' },
  nailcare:  { en: 'Nail care', he: 'טיפוח ציפורניים' },

  // Volume
  travel:    { en: 'Travel size', he: 'גודל נסיעה' },
  regularV:  { en: 'Regular', he: 'רגיל' },
  largeV:    { en: 'Large/Family', he: 'גדול/משפחתי' },

  // Scent / notes
  floral:    { en: 'Floral', he: 'פרחוני' },
  fruity:    { en: 'Fruity', he: 'פירותי' },
  fresh:     { en: 'Fresh/Clean', he: 'רענן' },
  woody:     { en: 'Woody', he: 'עצי' },
  oriental:  { en: 'Oriental', he: 'מזרחי' },
  unscented: { en: 'Unscented', he: 'ללא ריח' },

  // Finish
  matte:     { en: 'Matte', he: 'מאט' },
  gloss:     { en: 'Gloss', he: 'מבריק' },
  satin:     { en: 'Satin', he: 'סאטן' },
  sheer:     { en: 'Sheer', he: 'שקוף' },

  // Color type
  permanent: { en: 'Permanent', he: 'קבוע' },
  semiPerm:  { en: 'Semi-permanent', he: 'חצי קבוע' },
  temporary: { en: 'Temporary', he: 'זמני' },

  // Perfume size
  ml30:  { en: '30ml', he: '30ml' },
  ml50:  { en: '50ml', he: '50ml' },
  ml75:  { en: '75ml', he: '75ml' },
  ml100: { en: '100ml', he: '100ml' },
  ml100plus: { en: '100ml+', he: '100ml+' },

  // SPF
  noSpf:   { en: 'No SPF', he: 'ללא SPF' },
  spf15:   { en: 'SPF 15', he: 'SPF 15' },
  spf30:   { en: 'SPF 30', he: 'SPF 30' },
  spf50:   { en: 'SPF 50+', he: 'SPF 50+' },

  // Skin type
  allSkin: { en: 'All types', he: 'כל סוגי העור' },
  drySkin: { en: 'Dry', he: 'יבש' },
  oily:    { en: 'Oily', he: 'שמן' },
  sensitive: { en: 'Sensitive', he: 'רגיש' },

  // Amount
  full:      { en: 'Full/Sealed', he: 'מלא/סגור' },
  most:      { en: '75%+', he: '75%+' },
  half:      { en: '~50%', he: '~50%' },
  lessHalf:  { en: 'Less than 50%', he: 'פחות מ-50%' },

  // Jewelry
  gold:      { en: 'Gold', he: 'זהב' },
  silver:    { en: 'Silver', he: 'כסף' },
  platinum:  { en: 'Platinum', he: 'פלטינה' },
  stainless: { en: 'Stainless steel', he: 'נירוסטה' },
  plated:    { en: 'Plated', he: 'מצופה' },
  diamond:   { en: 'Diamond', he: 'יהלום' },
  gemOther:  { en: 'Other gem', he: 'אבן אחרת' },
  noGem:     { en: 'No gemstone', he: 'ללא אבן' },

  // ─── Vehicles ───
  car:        { en: 'Car', he: 'רכב' },
  motorcycle: { en: 'Motorcycle', he: 'אופנוע' },
  bicycle:    { en: 'Bicycle', he: 'אופניים' },
  scooter:    { en: 'Scooter', he: 'קורקינט' },
  skateboard: { en: 'Skateboard', he: 'סקייטבורד' },
  km0to5k:    { en: '0-5,000 km', he: '0-5,000 ק"מ' },
  km5to20k:   { en: '5-20,000 km', he: '5-20,000 ק"מ' },
  km20to50k:  { en: '20-50,000 km', he: '20-50,000 ק"מ' },
  km50kplus:  { en: '50,000+ km', he: '50,000+ ק"מ' },
  petrol:     { en: 'Petrol', he: 'בנזין' },
  diesel:     { en: 'Diesel', he: 'דיזל' },
  electricV:  { en: 'Electric', he: 'חשמלי' },
  hybridV:    { en: 'Hybrid', he: 'היברידי' },
  range5:     { en: 'Under 5km', he: 'מתחת ל-5 ק"מ' },
  range15:    { en: '5-15km', he: '5-15 ק"מ' },
  range30:    { en: '15-30km', he: '15-30 ק"מ' },
  range30plus: { en: '30km+', he: '30+ ק"מ' },
  speed25:    { en: 'Up to 25 km/h', he: 'עד 25 קמ"ש' },
  speed45:    { en: '25-45 km/h', he: '25-45 קמ"ש' },
  speed45plus: { en: '45+ km/h', he: '45+ קמ"ש' },

  // ─── Books ───
  likeNew:    { en: 'Like new', he: 'כחדש' },
  worn:       { en: 'Worn', he: 'שחוק' },
  damaged:    { en: 'Damaged', he: 'פגום' },
  clean:      { en: 'Clean', he: 'נקי' },
  marked:     { en: 'Some markings', he: 'סימונים' },
  yellowed:   { en: 'Yellowed', he: 'מצהיב' },
  hardcover:  { en: 'Hardcover', he: 'כריכה קשה' },
  softcover:  { en: 'Softcover', he: 'כריכה רכה' },
  novel:      { en: 'Novel/Fiction', he: 'רומן/בדיוני' },
  textbook:   { en: 'Textbook', he: 'ספר לימוד' },
  comic:      { en: 'Comic/Manga', he: 'קומיקס/מנגה' },
  religious:  { en: 'Religious', he: 'דתי' },
  children:   { en: 'Children', he: 'ילדים' },
  first:      { en: 'First edition', he: 'מהדורה ראשונה' },
  later:      { en: 'Later edition', he: 'מהדורה מאוחרת' },

  // ─── Toys ───
  complete:   { en: 'Complete', he: 'שלם' },
  mostParts:  { en: 'Most parts', he: 'רוב החלקים' },
  incomplete: { en: 'Incomplete', he: 'חסר חלקים' },
  toddler:    { en: '0-3', he: '0-3' },
  kids:       { en: '3-8', he: '3-8' },
  older:      { en: '8+', he: '8+' },
  lego:       { en: 'LEGO/Building', he: 'לגו/הרכבה' },
  boardGame:  { en: 'Board game', he: 'משחק קופסה' },
  actionFig:  { en: 'Action figure', he: 'דמות' },
  puzzle:     { en: 'Puzzle', he: 'פאזל' },
  rc:         { en: 'RC/Electronic', he: 'שלט רחוק' },
  toyOther:   { en: 'Other', he: 'אחר' },
  under100:   { en: 'Under 100', he: 'מתחת ל-100' },
  p100to500:  { en: '100-500', he: '100-500' },
  p500to1k:   { en: '500-1000', he: '500-1000' },
  p1kplus:    { en: '1000+', he: '1000+' },
  built:      { en: 'Already built', he: 'כבר בנוי' },
  sealed:     { en: 'Sealed/New', he: 'סגור/חדש' },

  // ─── Home ───
  kitchen:    { en: 'Kitchen', he: 'מטבח' },
  laundry:    { en: 'Laundry', he: 'כביסה' },
  cleaning:   { en: 'Cleaning', he: 'ניקיון' },
  climate:    { en: 'Climate/AC', he: 'מיזוג/אקלים' },
  homeOther:  { en: 'Other', he: 'אחר' },
  fullyWorking:   { en: 'Fully working', he: 'עובד מלא' },
  partiallyWorks: { en: 'Partially works', he: 'עובד חלקית' },
  notWorking:     { en: 'Not working', he: 'לא עובד' },
  aPlus:     { en: 'A+/A++', he: 'A+/A++' },
  aRating:   { en: 'A/B', he: 'A/B' },
  cRating:   { en: 'C or lower', he: 'C ומטה' },
  quiet:     { en: 'Quiet', he: 'שקט' },
  normalN:   { en: 'Normal', he: 'רגיל' },
  loud:      { en: 'Loud', he: 'רועש' },
  filterGood: { en: 'Good', he: 'טוב' },
  filterReplace: { en: 'Needs replacement', he: 'דורש החלפה' },

  // ─── Tools ───
  electric:   { en: 'Electric', he: 'חשמלי' },
  battery:    { en: 'Battery', he: 'סוללה' },
  manual:     { en: 'Manual', he: 'ידני' },
  cordless:   { en: 'Cordless', he: 'אלחוטי' },
  drill:      { en: 'Drill/Driver', he: 'מקדחה' },
  saw:        { en: 'Saw', he: 'מסור' },
  sander:     { en: 'Sander/Grinder', he: 'מלטשת' },
  measuring:  { en: 'Measuring', he: 'מדידה' },
  handTool:   { en: 'Hand tool', he: 'כלי יד' },
  toolOther:  { en: 'Other', he: 'אחר' },
  sharp:      { en: 'Sharp/New', he: 'חד/חדש' },
  usable:     { en: 'Usable', he: 'שמיש' },
  dull:       { en: 'Needs sharpening', he: 'דורש השחזה' },

  // ─── Smoking ───
  hookah:      { en: 'Hookah', he: 'נרגילה' },
  vape:        { en: 'Vape', he: 'סיגריה אלקטרונית' },
  pipe:        { en: 'Pipe', he: 'מקטרת' },
  smokingOther: { en: 'Other', he: 'אחר' },
  clean_:      { en: 'Clean', he: 'נקי' },
  lightUse:    { en: 'Light residue', he: 'שאריות קלות' },
  needsClean:  { en: 'Needs cleaning', he: 'דורש ניקוי' },
  hose1: { en: '1 hose', he: 'צינור אחד' },
  hose2: { en: '2 hoses', he: '2 צינורות' },
  hose3plus: { en: '3+', he: '3+' },
  bowlGood: { en: 'Good', he: 'טוב' },
  bowlChipped: { en: 'Chipped', he: 'סדוק' },
  bowlNew: { en: 'New', he: 'חדש' },
  stock:   { en: 'Stock coil', he: 'סליל מקורי' },
  custom:  { en: 'Custom/RDA', he: 'מותאם/RDA' },
};

// ═══════════════════════════════════════════════════════
// CATEGORY → SUBTYPE → QUESTION SCHEMA
// Pattern: First question selects subtype, then conditional
// questions appear based on that subtype selection.
// Falls back to generic category questions if subtype unknown.
// ═══════════════════════════════════════════════════════

function getQuestionsForCategory(category, answers = {}) {
  // Base questions shared across most physical goods
  const base = [
    { key: 'scratches', opts: ['none', 'some', 'yes'] },
    { key: 'issues', opts: ['no', 'yes'] },
  ];

  switch (category) {

    // ─────────────────────────────────────────────────────
    // ELECTRONICS — subtype drives screen/battery/storage
    // ─────────────────────────────────────────────────────
    case 'Electronics': {
      const sub = answers.deviceType;
      // Always show subtype picker first
      const questions = [
        { key: 'deviceType', opts: ['phone', 'laptop', 'tablet', 'console', 'headphones', 'smartwatch', 'tv', 'audio', 'camera', 'other'], wrap: true },
      ];

      // Subtype-specific questions appear only after selection
      if (sub === 'phone' || sub === 'tablet') {
        questions.push(
          { key: 'screenCond', opts: ['perfect', 'minorScratches', 'cracked'] },
          { key: 'battery', opts: ['good', 'degraded', 'poor'] },
          { key: 'storage', opts: ['64gb', '128gb', '256gb', '512gb', '1tb'], wrap: true },
          { key: 'charger', opts: ['yes', 'no'] },
        );
      } else if (sub === 'laptop') {
        questions.push(
          { key: 'screenCond', opts: ['perfect', 'minorScratches', 'cracked'] },
          { key: 'battery', opts: ['good', 'degraded', 'poor'] },
          { key: 'storage', opts: ['128gb', '256gb', '512gb', '1tb'], wrap: true },
          { key: 'charger', opts: ['yes', 'no'] },
        );
      } else if (sub === 'headphones') {
        // Headphones: connectivity + pads matter, no screen/storage
        questions.push(
          { key: 'connectivity', opts: ['wired', 'wireless', 'both'] },
          { key: 'noiseCancelling', opts: ['yes', 'no'] },
          { key: 'earpads', opts: ['good', 'degraded', 'poor'] },
          { key: 'battery', opts: ['good', 'degraded', 'poor'] },
        );
      } else if (sub === 'smartwatch') {
        // Smartwatch: band + sensors + water resistance
        questions.push(
          { key: 'screenCond', opts: ['perfect', 'minorScratches', 'cracked'] },
          { key: 'battery', opts: ['good', 'degraded', 'poor'] },
          { key: 'bandFit', opts: ['good', 'degraded', 'poor'] },
          { key: 'waterResist', opts: ['yes', 'no', 'unknown'] },
          { key: 'sensorAccuracy', opts: ['yes', 'no'] },
          { key: 'charger', opts: ['yes', 'no'] },
        );
      } else if (sub === 'console') {
        // Console: controllers + disc drive matter
        questions.push(
          { key: 'controllerType', opts: ['oneCtrl', 'twoCtrl', 'noCtrl'] },
          { key: 'discDrive', opts: ['yesDisc', 'digital'] },
          { key: 'storage', opts: ['256gb', '512gb', '1tb'], wrap: true },
        );
      } else if (sub === 'tv') {
        // TV: panel + size + smart features
        questions.push(
          { key: 'panelType', opts: ['led', 'oled', 'qled', 'lcd'], wrap: true },
          { key: 'screenSize', opts: ['under32', 'sz32to43', 'sz43to55', 'sz55plus'] },
          { key: 'screenCond', opts: ['perfect', 'minorScratches', 'cracked'] },
          { key: 'smartFeatures', opts: ['yes', 'no'] },
        );
      } else if (sub === 'audio') {
        // Speaker/audio: type + sound quality
        questions.push(
          { key: 'speakerType', opts: ['portable', 'soundbar', 'hifi', 'subwoofer'], wrap: true },
          { key: 'connectivity', opts: ['wired', 'wireless', 'both'] },
          { key: 'soundQuality', opts: ['excellent', 'good', 'degraded'] },
          { key: 'battery', opts: ['good', 'degraded', 'poor'] },
        );
      } else if (sub === 'camera') {
        questions.push(
          { key: 'battery', opts: ['good', 'degraded', 'poor'] },
          { key: 'screenCond', opts: ['perfect', 'minorScratches', 'cracked'] },
        );
      }
      // Common electronics tail
      questions.push(
        { key: 'accessories', opts: ['all', 'partial', 'missing'] },
        ...base,
      );
      return questions;
    }

    // ─────────────────────────────────────────────────────
    // FURNITURE — subtype drives sofa/bed/table specifics
    // ─────────────────────────────────────────────────────
    case 'Furniture': {
      const sub = answers.furnitureType;
      const questions = [
        { key: 'furnitureType', opts: ['sofa', 'bed', 'table', 'chair', 'closet', 'furnitureOther'], wrap: true },
        { key: 'material', opts: ['wood', 'metal', 'fabric', 'plastic', 'leather', 'glass'], wrap: true },
      ];

      if (sub === 'sofa') {
        questions.push(
          { key: 'seatCount', opts: ['seats2', 'seats3', 'sectional'] },
          { key: 'upholstery', opts: ['good', 'degraded', 'poor'] },
          { key: 'stains', opts: ['none', 'some', 'yes'] },
        );
      } else if (sub === 'bed') {
        questions.push(
          { key: 'mattressType', opts: ['spring', 'foam', 'latex', 'hybrid'] },
          { key: 'firmness', opts: ['soft', 'medFirm', 'firm'] },
          { key: 'dimensions', opts: ['compact', 'standard', 'oversized'] },
          { key: 'stains', opts: ['none', 'some', 'yes'] },
        );
      } else if (sub === 'table') {
        questions.push(
          { key: 'tableShape', opts: ['round', 'rectangular', 'adjustable'] },
          { key: 'tableSeats', opts: ['seats4', 'seats6', 'seats8plus'] },
        );
      } else if (sub === 'closet') {
        questions.push(
          { key: 'shelvesCount', opts: ['shelves2', 'shelves4', 'shelves6'] },
          { key: 'doorType', opts: ['sliding', 'hinged', 'open'] },
        );
      } else {
        // Chair / other — generic
        questions.push(
          { key: 'dimensions', opts: ['compact', 'standard', 'oversized'] },
          { key: 'stains', opts: ['none', 'some', 'yes'] },
        );
      }

      questions.push(
        { key: 'assembly', opts: ['yes', 'no'] },
        ...base,
      );
      return questions;
    }

    // ─────────────────────────────────────────────────────
    // WATCHES — subtype: analog, digital, smart, luxury
    // ─────────────────────────────────────────────────────
    case 'Watches': {
      const sub = answers.watchType;
      const questions = [
        { key: 'watchType', opts: ['analog', 'digitalW', 'smartW', 'luxuryW'], wrap: true },
      ];

      if (sub === 'luxuryW') {
        // Luxury watches need authenticity, movement, service
        questions.push(
          { key: 'authenticity', opts: ['original', 'replica', 'unknown'] },
          { key: 'movement', opts: ['automatic', 'quartz', 'manualW'] },
          { key: 'boxPapers', opts: ['yes', 'partial', 'no'] },
          { key: 'service', opts: ['yes', 'no', 'unknown'] },
          { key: 'crystalCond', opts: ['perfect', 'minorScratches', 'cracked'] },
        );
      } else if (sub === 'smartW') {
        // Smart watches: battery, screen, band
        questions.push(
          { key: 'battery', opts: ['good', 'degraded', 'poor'] },
          { key: 'screenCond', opts: ['perfect', 'minorScratches', 'cracked'] },
          { key: 'charger', opts: ['yes', 'no'] },
          { key: 'waterResist', opts: ['yes', 'no', 'unknown'] },
        );
      } else {
        // Analog / Digital — standard questions
        questions.push(
          { key: 'authenticity', opts: ['original', 'replica', 'unknown'] },
          { key: 'boxPapers', opts: ['yes', 'partial', 'no'] },
        );
      }

      questions.push(
        { key: 'bracelet', opts: ['mint', 'wornLight', 'wornHeavy'] },
        ...base,
      );
      return questions;
    }

    // ─────────────────────────────────────────────────────
    // CLOTHING — subtype: tshirt, jacket, jeans, dress, shoes, bag
    // ─────────────────────────────────────────────────────
    case 'Clothing': {
      const sub = answers.clothingType;
      const questions = [
        { key: 'clothingType', opts: ['tshirt', 'jacket', 'jeans', 'dress', 'shoes', 'bag', 'clothingOther'], wrap: true },
      ];

      if (sub === 'shoes') {
        // Shoes use EU sizes, sole condition instead of fabric
        questions.push(
          { key: 'shoeSize', opts: ['eu36', 'eu37', 'eu38', 'eu39', 'eu40', 'eu41', 'eu42', 'eu43', 'eu44', 'eu45plus'], wrap: true },
          { key: 'soleCond', opts: ['soleGood', 'soleWorn', 'soleDamaged'] },
          { key: 'worn', opts: ['once', 'few', 'many'] },
          { key: 'defects', opts: ['none', 'some', 'yes'] },
        );
      } else if (sub === 'bag') {
        // Bags: no "size", focus on material + authenticity
        questions.push(
          { key: 'fabricType', opts: ['leather', 'synthetic', 'fabric', 'other'], wrap: true },
          { key: 'authenticity', opts: ['original', 'replica', 'unknown'] },
          { key: 'worn', opts: ['once', 'few', 'many'] },
          { key: 'defects', opts: ['none', 'some', 'yes'] },
        );
      } else if (sub === 'jacket') {
        // Jackets: size + fabric + zippers important
        questions.push(
          { key: 'clothingSize', opts: ['xs', 'small', 'medium', 'large', 'xl', 'xxl'], wrap: true },
          { key: 'fabricType', opts: ['cotton', 'synthetic', 'leather', 'wool', 'denim'], wrap: true },
          { key: 'zipButtons', opts: ['yes', 'no'] },
          { key: 'worn', opts: ['once', 'few', 'many'] },
          { key: 'defects', opts: ['none', 'some', 'yes'] },
        );
      } else if (sub === 'jeans') {
        // Jeans: fit matters
        questions.push(
          { key: 'clothingSize', opts: ['xs', 'small', 'medium', 'large', 'xl', 'xxl'], wrap: true },
          { key: 'fitType', opts: ['slim', 'regular', 'loose'] },
          { key: 'colorFading', opts: ['none', 'some', 'yes'] },
          { key: 'worn', opts: ['once', 'few', 'many'] },
          { key: 'washed', opts: ['yes', 'no'] },
        );
      } else {
        // T-shirt, Dress, Other — standard clothing flow
        questions.push(
          { key: 'clothingSize', opts: ['xs', 'small', 'medium', 'large', 'xl', 'xxl'], wrap: true },
          { key: 'fabricType', opts: ['cotton', 'synthetic', 'denim', 'wool', 'leather', 'silk'], wrap: true },
          { key: 'worn', opts: ['once', 'few', 'many'] },
          { key: 'washed', opts: ['yes', 'no'] },
          { key: 'defects', opts: ['none', 'some', 'yes'] },
        );
      }
      return questions;
    }

    // ─────────────────────────────────────────────────────
    // SPORTS — subtype: gym equipment, cycling, water, ball
    // ─────────────────────────────────────────────────────
    case 'Sports': {
      const sub = answers.sportType;
      const questions = [
        { key: 'sportType', opts: ['gym', 'cycling', 'water', 'ball', 'outdoor', 'running', 'other'], wrap: true },
      ];

      if (sub === 'gym') {
        // Gym: machine vs weights vs cardio
        questions.push(
          { key: 'sportSubtype', opts: ['gymMachine', 'weights', 'cardio', 'yogaMat'], wrap: true },
        );
        if (answers.sportSubtype === 'gymMachine' || answers.sportSubtype === 'cardio') {
          questions.push(
            { key: 'weightCapacity', opts: ['light', 'moderate', 'heavy'] },
            { key: 'resistance', opts: ['yes', 'no'] },
          );
        }
      } else if (sub === 'cycling') {
        // Cycling: bike type + frame + gears + brakes
        questions.push(
          { key: 'sportSubtype', opts: ['road', 'mountain', 'cityBike', 'ebike'], wrap: true },
          { key: 'frameSize', opts: ['small', 'medium', 'large'] },
          { key: 'gears', opts: ['yes', 'no'] },
          { key: 'brakes', opts: ['good', 'degraded', 'poor'] },
          { key: 'tires', opts: ['good', 'degraded', 'poor'] },
        );
        if (answers.sportSubtype === 'ebike') {
          questions.push(
            { key: 'battery', opts: ['good', 'degraded', 'poor'] },
          );
        }
      }

      questions.push(
        { key: 'usage', opts: ['light', 'moderate', 'heavy'] },
        ...base,
      );
      return questions;
    }

    // ─────────────────────────────────────────────────────
    // BEAUTY — subtype: shampoo, makeup, hairColor, perfume,
    //          skincare, jewelry, nailcare, accessory
    // ─────────────────────────────────────────────────────
    case 'Beauty': {
      const sub = answers.beautyType;
      const questions = [
        { key: 'beautyType', opts: ['shampoo', 'makeup', 'hairColor', 'perfume', 'skincare', 'jewelry', 'nailcare', 'accessory', 'other'], wrap: true },
      ];

      if (sub === 'shampoo' || sub === 'haircare') {
        // Shampoo/Hair products: volume, scent, opened, expiry
        questions.push(
          { key: 'volumeSize', opts: ['travel', 'regularV', 'largeV'] },
          { key: 'scent', opts: ['floral', 'fruity', 'fresh', 'unscented'], wrap: true },
          { key: 'opened', opts: ['no', 'yes'] },
          { key: 'amountLeft', opts: ['full', 'most', 'half', 'lessHalf'] },
          { key: 'expiry', opts: ['yes', 'no', 'unknown'] },
        );
      } else if (sub === 'makeup' || sub === 'cosmetics') {
        // Makeup: shade, finish, opened, expiry
        questions.push(
          { key: 'shade', opts: ['light', 'medium', 'other'], wrap: true },
          { key: 'finish', opts: ['matte', 'gloss', 'satin', 'sheer'] },
          { key: 'opened', opts: ['no', 'yes'] },
          { key: 'amountLeft', opts: ['full', 'most', 'half', 'lessHalf'] },
          { key: 'expiry', opts: ['yes', 'no', 'unknown'] },
        );
      } else if (sub === 'hairColor') {
        // Hair color: shade, permanent vs semi, opened, expiry
        questions.push(
          { key: 'shade', opts: ['light', 'medium', 'other'], wrap: true },
          { key: 'colorType', opts: ['permanent', 'semiPerm', 'temporary'] },
          { key: 'opened', opts: ['no', 'yes'] },
          { key: 'expiry', opts: ['yes', 'no', 'unknown'] },
        );
      } else if (sub === 'perfume') {
        // Perfume: size, scent family, opened, authenticity
        questions.push(
          { key: 'perfumeSize', opts: ['ml30', 'ml50', 'ml75', 'ml100', 'ml100plus'], wrap: true },
          { key: 'scentNotes', opts: ['floral', 'fruity', 'fresh', 'woody', 'oriental'], wrap: true },
          { key: 'opened', opts: ['no', 'yes'] },
          { key: 'amountLeft', opts: ['full', 'most', 'half', 'lessHalf'] },
          { key: 'authenticity', opts: ['original', 'replica', 'unknown'] },
          { key: 'boxPapers', opts: ['yes', 'no'] },
        );
      } else if (sub === 'skincare') {
        // Skincare: SPF, skin type, size, opened, expiry
        questions.push(
          { key: 'spf', opts: ['noSpf', 'spf15', 'spf30', 'spf50'] },
          { key: 'skinType', opts: ['allSkin', 'drySkin', 'oily', 'sensitive'], wrap: true },
          { key: 'volumeSize', opts: ['travel', 'regularV', 'largeV'] },
          { key: 'opened', opts: ['no', 'yes'] },
          { key: 'amountLeft', opts: ['full', 'most', 'half', 'lessHalf'] },
          { key: 'expiry', opts: ['yes', 'no', 'unknown'] },
        );
      } else if (sub === 'jewelry') {
        // Jewelry: metal type, gemstone, authenticity, certificate
        questions.push(
          { key: 'jewelryMetal', opts: ['gold', 'silver', 'platinum', 'stainless', 'plated'], wrap: true },
          { key: 'gemstone', opts: ['diamond', 'gemOther', 'noGem'] },
          { key: 'authenticity', opts: ['original', 'replica', 'unknown'] },
          { key: 'certificate', opts: ['yes', 'no'] },
          { key: 'boxPapers', opts: ['yes', 'no'] },
          ...base,
        );
        return questions; // Jewelry uses base (scratches), skip expiry
      } else if (sub === 'nailcare') {
        questions.push(
          { key: 'opened', opts: ['no', 'yes'] },
          { key: 'amountLeft', opts: ['full', 'most', 'half', 'lessHalf'] },
          { key: 'expiry', opts: ['yes', 'no', 'unknown'] },
        );
      } else {
        // Accessory / Other — generic beauty
        questions.push(
          { key: 'opened', opts: ['no', 'yes'] },
          { key: 'expiry', opts: ['yes', 'no', 'unknown'] },
          { key: 'authenticity', opts: ['original', 'replica', 'unknown'] },
        );
      }
      return questions;
    }

    // ─────────────────────────────────────────────────────
    // VEHICLES — subtype: car, motorcycle, bicycle, scooter
    // ─────────────────────────────────────────────────────
    case 'Vehicles': {
      const sub = answers.vehicleType;
      const questions = [
        { key: 'vehicleType', opts: ['car', 'motorcycle', 'bicycle', 'scooter', 'skateboard', 'other'], wrap: true },
      ];

      if (sub === 'car') {
        questions.push(
          { key: 'km', opts: ['km0to5k', 'km5to20k', 'km20to50k', 'km50kplus'] },
          { key: 'engineType', opts: ['petrol', 'diesel', 'electricV', 'hybridV'], wrap: true },
          { key: 'tires', opts: ['good', 'degraded', 'poor'] },
        );
      } else if (sub === 'motorcycle') {
        questions.push(
          { key: 'km', opts: ['km0to5k', 'km5to20k', 'km20to50k', 'km50kplus'] },
          { key: 'engineType', opts: ['petrol', 'electricV'] },
          { key: 'tires', opts: ['good', 'degraded', 'poor'] },
        );
      } else if (sub === 'bicycle') {
        questions.push(
          { key: 'bikeType', opts: ['road', 'mountain', 'cityBike', 'ebike'], wrap: true },
          { key: 'frameSize', opts: ['small', 'medium', 'large'] },
          { key: 'gears', opts: ['yes', 'no'] },
          { key: 'brakes', opts: ['good', 'degraded', 'poor'] },
          { key: 'tires', opts: ['good', 'degraded', 'poor'] },
        );
        if (answers.bikeType === 'ebike') {
          questions.push(
            { key: 'battery', opts: ['good', 'degraded', 'poor'] },
            { key: 'electricRange', opts: ['range5', 'range15', 'range30', 'range30plus'] },
          );
        }
      } else if (sub === 'scooter') {
        questions.push(
          { key: 'maxSpeed', opts: ['speed25', 'speed45', 'speed45plus'] },
          { key: 'battery', opts: ['good', 'degraded', 'poor'] },
          { key: 'electricRange', opts: ['range5', 'range15', 'range30', 'range30plus'] },
          { key: 'tires', opts: ['good', 'degraded', 'poor'] },
        );
      } else {
        // Skateboard / other
        questions.push(
          { key: 'mileage', opts: ['light', 'moderate', 'heavy'] },
        );
      }

      questions.push(...base);
      return questions;
    }

    // ─────────────────────────────────────────────────────
    // BOOKS — subtype: novel, textbook, comic, religious, children
    // ─────────────────────────────────────────────────────
    case 'Books': {
      const sub = answers.bookType;
      const questions = [
        { key: 'bookType', opts: ['novel', 'textbook', 'comic', 'religious', 'children', 'other'], wrap: true },
        { key: 'bookCondition', opts: ['likeNew', 'good', 'worn', 'damaged'] },
        { key: 'cover', opts: ['hardcover', 'softcover'] },
        { key: 'pages', opts: ['clean', 'marked', 'yellowed'] },
      ];

      if (sub === 'textbook') {
        questions.push(
          { key: 'edition', opts: ['first', 'later', 'unknown'] },
        );
      } else if (sub === 'comic') {
        questions.push(
          { key: 'edition', opts: ['first', 'later', 'unknown'] },
        );
      }
      return questions;
    }

    // ─────────────────────────────────────────────────────
    // TOYS — subtype: LEGO, board game, action figure, etc.
    // ─────────────────────────────────────────────────────
    case 'Toys': {
      const sub = answers.toyType;
      const questions = [
        { key: 'toyType', opts: ['lego', 'boardGame', 'actionFig', 'puzzle', 'rc', 'toyOther'], wrap: true },
        { key: 'ageGroup', opts: ['toddler', 'kids', 'older'] },
      ];

      if (sub === 'lego') {
        // LEGO: piece count + built vs sealed
        questions.push(
          { key: 'pieceCount', opts: ['under100', 'p100to500', 'p500to1k', 'p1kplus'] },
          { key: 'builtStatus', opts: ['sealed', 'built'] },
          { key: 'completeness', opts: ['complete', 'mostParts', 'incomplete'] },
        );
      } else if (sub === 'boardGame') {
        questions.push(
          { key: 'completeness', opts: ['complete', 'mostParts', 'incomplete'] },
        );
      } else if (sub === 'rc') {
        questions.push(
          { key: 'battery', opts: ['good', 'degraded', 'poor'] },
          { key: 'completeness', opts: ['complete', 'mostParts', 'incomplete'] },
        );
      } else {
        questions.push(
          { key: 'completeness', opts: ['complete', 'mostParts', 'incomplete'] },
        );
      }

      questions.push(...base);
      return questions;
    }

    // ─────────────────────────────────────────────────────
    // HOME / APPLIANCES — subtype: kitchen, laundry, cleaning, climate
    // ─────────────────────────────────────────────────────
    case 'Home': {
      const sub = answers.homeType;
      const questions = [
        { key: 'homeType', opts: ['kitchen', 'laundry', 'cleaning', 'climate', 'homeOther'], wrap: true },
        { key: 'workingCond', opts: ['fullyWorking', 'partiallyWorks', 'notWorking'] },
      ];

      if (sub === 'kitchen' || sub === 'laundry') {
        questions.push(
          { key: 'energyRating', opts: ['aPlus', 'aRating', 'cRating', 'unknown'] },
          { key: 'noise', opts: ['quiet', 'normalN', 'loud'] },
        );
      } else if (sub === 'cleaning') {
        questions.push(
          { key: 'filterCond', opts: ['filterGood', 'filterReplace'] },
        );
      } else if (sub === 'climate') {
        questions.push(
          { key: 'energyRating', opts: ['aPlus', 'aRating', 'cRating', 'unknown'] },
          { key: 'noise', opts: ['quiet', 'normalN', 'loud'] },
        );
      }

      questions.push(
        { key: 'warranty', opts: ['yes', 'no', 'unknown'] },
        { key: 'accessories', opts: ['all', 'partial', 'missing'] },
        ...base,
      );
      return questions;
    }

    // ─────────────────────────────────────────────────────
    // TOOLS — subtype: drill, saw, sander, hand tool, etc.
    // ─────────────────────────────────────────────────────
    case 'Tools': {
      const sub = answers.toolType;
      const questions = [
        { key: 'toolType', opts: ['drill', 'saw', 'sander', 'measuring', 'handTool', 'toolOther'], wrap: true },
        { key: 'powerSource', opts: ['electric', 'cordless', 'manual'] },
      ];

      if (sub === 'drill' || sub === 'saw' || sub === 'sander') {
        // Power tools: blade/bit condition matters
        questions.push(
          { key: 'bladeBit', opts: ['sharp', 'usable', 'dull'] },
        );
        if (answers.powerSource === 'cordless') {
          questions.push(
            { key: 'battery', opts: ['good', 'degraded', 'poor'] },
          );
        }
      }

      questions.push(
        { key: 'toolCondition', opts: ['excellent', 'good', 'degraded'] },
        { key: 'accessories', opts: ['all', 'partial', 'missing'] },
        ...base,
      );
      return questions;
    }

    // ─────────────────────────────────────────────────────
    // SMOKING — subtype: hookah, vape, pipe
    // ─────────────────────────────────────────────────────
    case 'Smoking': {
      const sub = answers.smokingType;
      const questions = [
        { key: 'smokingType', opts: ['hookah', 'vape', 'pipe', 'smokingOther'], wrap: true },
      ];

      if (sub === 'hookah') {
        questions.push(
          { key: 'hoseCount', opts: ['hose1', 'hose2', 'hose3plus'] },
          { key: 'bowlCond', opts: ['bowlNew', 'bowlGood', 'bowlChipped'] },
          { key: 'cleanness', opts: ['clean_', 'lightUse', 'needsClean'] },
        );
      } else if (sub === 'vape') {
        questions.push(
          { key: 'battery', opts: ['good', 'degraded', 'poor'] },
          { key: 'coilType', opts: ['stock', 'custom'] },
          { key: 'liquidIncluded', opts: ['yes', 'no'] },
          { key: 'cleanness', opts: ['clean_', 'lightUse', 'needsClean'] },
        );
      } else {
        questions.push(
          { key: 'cleanness', opts: ['clean_', 'lightUse', 'needsClean'] },
        );
      }

      questions.push(
        { key: 'accessories', opts: ['all', 'partial', 'missing'] },
        ...base,
      );
      return questions;
    }

    // ─────────────────────────────────────────────────────
    // DEFAULT — Music, Food, Other → generic
    // ─────────────────────────────────────────────────────
    default:
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