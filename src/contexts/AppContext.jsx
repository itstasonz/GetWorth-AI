import React, { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import T from '../lib/translations';
import SoundEffects from '../lib/sounds';
import { sanitizeSearch, calcPrice, computeQualityScore, PAGE_SIZE, extractSerialFromOCR, maskSerial, validateIMEI, formatMessagePreview, hasRealPrice, observedPriceMid, positivePriceOrNull } from '../lib/utils';
import { cacheGet, cacheSet, cacheDelete } from '../lib/appCache';
import { useUrlSync, setNavDirection } from '../lib/urlSync';
import { reportError } from '../lib/telemetry';
import { recordObservation, OBS } from '../lib/observations';
import { fetchReviewsFor } from '../lib/reviews';

const AppContext = createContext(null);
const DEV = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

// ═══ FRONTEND-007A (MKT-3): pending buy intent — sessionStorage-backed ═════
// A signed-out Buy tap stores an intent so the flow can resume after sign-in.
// OAuth (Google etc.) performs a FULL-PAGE redirect, so the intent must
// survive a document reload: sessionStorage does (same tab, across
// navigations and cross-origin round-trips) and dies with the tab — exactly
// the lifetime a "come right back" intent should have. localStorage/IDB are
// deliberately NOT used: the intent must never outlive the browser session.
//
// SINGLE SOURCE OF TRUTH: these four helpers are the only accessors. Every
// mutation updates sessionStorage and the in-memory fallback in the same
// synchronous call, so the two can never drift; the fallback is read only
// when storage is unavailable (private-mode quota), where it preserves the
// FRONTEND-007 same-document behavior. Payload is ONLY {listingId, ts} —
// never form data, listing/seller/pricing snapshots, or auth state.
// Consumption is take-semantics (read+delete in one synchronous step), so an
// intent can resume at most once per storage write.
const PENDING_BUY_KEY = 'gw-pending-buy';
const PENDING_BUY_TTL_MS = 5 * 60 * 1000; // intent older than this is stale — drop, don't resume
let pendingBuyFallback = null; // used only when sessionStorage throws

const writePendingBuy = (listingId) => {
  const intent = { listingId: String(listingId), ts: Date.now() };
  pendingBuyFallback = intent;
  try { sessionStorage.setItem(PENDING_BUY_KEY, JSON.stringify(intent)); } catch {}
};
const clearPendingBuy = () => {
  pendingBuyFallback = null;
  try { sessionStorage.removeItem(PENDING_BUY_KEY); } catch {}
};
const readPendingBuy = () => {
  let intent = pendingBuyFallback;
  try {
    const raw = sessionStorage.getItem(PENDING_BUY_KEY);
    if (raw) intent = JSON.parse(raw);
  } catch { /* corrupt or unavailable — fall through to fallback/cleanup */ }
  if (!intent || typeof intent.listingId !== 'string' || typeof intent.ts !== 'number'
      || Date.now() - intent.ts >= PENDING_BUY_TTL_MS) {
    if (intent) clearPendingBuy(); // expired/malformed: delete, never resume
    return null;
  }
  return intent;
};
const takePendingBuy = () => { // consume-once: read and delete synchronously
  const intent = readPendingBuy();
  clearPendingBuy();
  return intent;
};

// ── Camera debug log — visible on-screen panel for iPhone debugging ──
const camLogs = [];
export const camLog = (msg) => {
  const entry = `${new Date().toISOString().slice(11,23)} ${msg}`;
  console.log('[CAM]', entry);
  camLogs.push(entry);
  if (camLogs.length > 30) camLogs.shift();
  if (DEV) window.__camLogs = camLogs;
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};

// ═══════════════════════════════════════════════════════════════════════════
// ALPHA-002 — Realtime channel lifecycle manager
// ═══════════════════════════════════════════════════════════════════════════
// Mobile browsers kill the realtime WebSocket constantly: backgrounding, screen
// lock, Wi-Fi ⇄ cellular hand-off, and connection loss all silently drop it.
// The previous subscribe() handlers only LOGGED on CHANNEL_ERROR / TIMED_OUT,
// so once the socket died it stayed dead until the effect re-ran (never, within
// a session) — chat and notifications went quiet with no visible failure.
//
// This hook owns the full connection lifecycle for ONE channel and recovers
// automatically. It contains no business logic: the caller supplies
// `buildChannel(name)` — a channel with its `.on(...)` handlers attached but NOT
// yet subscribed — and an optional `onRecover` that re-syncs state after a
// reconnect (so a recovered socket never leaves the UI showing stale data).
//
//   • Reconnects on CHANNEL_ERROR, TIMED_OUT, and CLOSED
//   • Reconnects on the `online` event and on visibilitychange → visible
//   • Exponential backoff (1s → 30s), reset to 0 on a successful SUBSCRIBED
//   • Single-flight: never runs two connects or holds two channels at once
//   • Leak-free: clears its timer, channel, and window/document listeners on unmount
function useRealtimeChannel(userId, channelKey, buildChannel, onRecover) {
  // Keep the latest closures without re-running the effect — otherwise every
  // unrelated re-render would tear the socket down and rebuild it.
  const buildRef   = useRef(buildChannel);
  const recoverRef = useRef(onRecover);
  buildRef.current   = buildChannel;
  recoverRef.current = onRecover;

  useEffect(() => {
    if (!userId) return;

    const BACKOFFS = [1000, 2000, 5000, 10000, 20000, 30000];
    let cancelled    = false;
    let channel      = null;
    let retryTimer   = null;
    let attempt      = 0;
    let connecting   = false;
    let hasConnected = false;

    const clearRetry  = () => { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } };
    const dropChannel = () => { if (channel) { supabase.removeChannel(channel); channel = null; } };

    const scheduleReconnect = () => {
      if (cancelled || retryTimer) return;              // one pending retry at a time
      const delay = BACKOFFS[Math.min(attempt, BACKOFFS.length - 1)];
      attempt += 1;
      retryTimer = setTimeout(() => { retryTimer = null; connect(); }, delay);
    };

    const connect = async () => {
      if (cancelled || connecting) return;              // single-flight guard
      connecting = true;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled || !session?.access_token) return;

        dropChannel();                                  // never hold two subscriptions
        const name = `${channelKey}-${userId}`;
        channel = buildRef.current(name).subscribe((status) => {
          if (cancelled) return;
          if (status === 'SUBSCRIBED') {
            attempt = 0;
            clearRetry();
            if (DEV) console.log(`✅ ${name} SUBSCRIBED`);
            if (hasConnected) { try { recoverRef.current?.(); } catch { /* resync best-effort */ } }
            hasConnected = true;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (DEV) console.warn(`⚠️ ${name} ${status} — scheduling reconnect`);
            dropChannel();
            scheduleReconnect();
          }
        });
      } finally {
        connecting = false;
      }
    };

    // Explicit environment signal (network back / app foregrounded): recover
    // immediately, but don't thrash a socket that is already healthy.
    const kick = () => {
      if (cancelled || connecting) return;
      // Skip when a socket is already up OR a join is already in flight. `connecting`
      // covers connect()'s await window; `'joining'` covers the window after connect()
      // returns but before SUBSCRIBED fires — so a burst of online + visibilitychange
      // events can never interrupt or duplicate an in-progress connection.
      if (channel && (channel.state === 'joined' || channel.state === 'joining')) return;
      attempt = 0;
      clearRetry();
      connect();
    };

    const onOnline     = () => kick();
    const onVisibility = () => { if (document.visibilityState === 'visible') kick(); };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);

    connect();

    return () => {
      cancelled = true;
      clearRetry();
      dropChannel();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [userId, channelKey]);
}

// ═══════════════════════════════════════════════════════
// Image compression — run BEFORE sending to API
// Resizes to max dimension, JPEG quality configurable (default 800px, 0.65)
// Perf: skips decode+resize if raw image is already under 150KB
// Modern browsers auto-handle EXIF orientation on canvas draw
// ═══════════════════════════════════════════════════════
function compressImage(dataUrl, maxDim = 800, quality = 0.65) {
  const t0 = performance.now();
  // Perf: skip compression entirely if image is already small enough
  const rawKB = Math.round(dataUrl.length * 0.75 / 1024);
  if (rawKB < 150) {
    if (DEV) console.log(`[Compress] Skip — already ${rawKB}KB (${(performance.now() - t0).toFixed(0)}ms)`);
    return Promise.resolve(dataUrl);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas 2D context unavailable')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        if (DEV) {
          const compKB = Math.round(compressed.length * 0.75 / 1024);
          console.log(`[Compress] ${img.naturalWidth}×${img.naturalHeight} → ${w}×${h} | ${rawKB}KB → ${compKB}KB (${(performance.now() - t0).toFixed(0)}ms)`);
        }
        resolve(compressed);
      } catch (e) {
        reject(new Error('Image compression failed: ' + e.message));
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for compression'));
    img.src = dataUrl;
  });
}

export function AppProvider({ children }) {
  // Core state
  const [lang, setLang] = useState('he');
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('home');
  const [view, setView] = useState('home');
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);

  // Listings state
  const [listings, setListings] = useState([]);
  const [myListings, setMyListings] = useState([]);
  const [savedIds, setSavedIds] = useState(new Set());
  const [savedItems, setSavedItems] = useState([]);

  // Pagination
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listingsPage, setListingsPage] = useState(0);

  // Scan/listing flow state
  const [images, setImages] = useState([]);
  // Perf: ref mirror of images state — safe to read in async code without setState tricks
  const imagesRef = useRef([]);
  useEffect(() => { imagesRef.current = images; }, [images]);
  const [result, setResult] = useState(null);
  const [valuations, setValuations] = useState([]);
  const [valuationsLoading, setValuationsLoading] = useState(false);
  const [listingStep, setListingStep] = useState(0);
  const [condition, setCondition] = useState(null);
  const [answers, setAnswers] = useState({});
  const [listingData, setListingData] = useState({ title: '', desc: '', price: 0, phone: '', location: '' });
  // Serial/IMEI verification state
  const [serialData, setSerialData] = useState(null); // { photo, rawText, serial, masked, verified, type } | null
  const [serialLoading, setSerialLoading] = useState(false);
  const serialLoadingRef = useRef(false);
  const [publishing, setPublishing] = useState(false);
  const capturedImageRef = useRef(null);
  const [showFlash, setShowFlash] = useState(false);
  const loadRequestIdRef = useRef(0); // Race-condition guard for tab/filter switching

  // ─── Pipeline state machine ───
  // idle → compressing → analyzing → success
  // failure states: compress_error, analysis_error
  const [pipelineState, setPipelineState] = useState('idle');
  const [pipelineError, setPipelineError] = useState(null);
  const pipelineAbortRef = useRef(null);
  // In-flight guard — prevents duplicate /api/analyze calls from rapid taps.
  const pipelineActiveRef = useRef(false);
  // SCAN-2: exact snapshot of the last attempted scan input, taken at the top
  // of every runPipeline. Retry replays THIS — same image, same append
  // context, same pre-attempt images array — instead of rebuilding from
  // capturedImageRef, which never knew about appended label photos (retrying
  // a failed append used to silently drop the photo the user just took).
  // ownerId makes a stale user's images unreplayable after logout.
  const lastAttemptRef = useRef(null); // { image, appendMode, imagesBefore, ownerId }
  // Rate-limit cooldown (epoch ms). Scan/retry disabled until now passes this.
  const [scanCooldownUntil, setScanCooldownUntil] = useState(0);
  const scanCooldownUntilRef = useRef(0); // latest value for use inside callbacks
  // GW-000: one scan_uuid per scan LIFECYCLE (reused across append/refine of the
  // same item; a fresh scan gets a new one). Sent to /api/analyze so the server
  // stamps the valuation + scan_events; future events reference this id.
  const currentScanUuidRef = useRef(null);
  // Perf: cache recognition hints in memory — refresh every 5 min, not every scan
  const hintsCacheRef = useRef({ data: [], ts: 0 });

  // ─── Multi-photo + Help modal ───
  const [addPhotoMode, setAddPhotoMode] = useState(false); // true = appending photo to existing scan
  const [helpModalOpen, setHelpModalOpen] = useState(false);

  // ─── Torch (flash) state ───
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // Browse state
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [priceRange, setPriceRange] = useState({ min: '', max: '' });
  const [debouncedPriceRange, setDebouncedPriceRange] = useState({ min: '', max: '' });
  const [sort, setSort] = useState('newest');
  const [filterCondition, setFilterCondition] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState(null);

  // Auth state
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [signInAction, setSignInAction] = useState(null);
  // FRONTEND-007 (MKT-3): pending buy intent — set when a signed-out user
  // taps Buy, consumed exactly once by the sign-in effect. See the
  // sessionStorage-backed helpers at module scope (FRONTEND-007A): the
  // intent survives OAuth full-page redirects and dies with the tab.
  const [showContact, setShowContact] = useState(false);
  const [heartAnim, setHeartAnim] = useState(null);

  // Chat state
  const [conversations, setConversations] = useState([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const conversationsLastLoadRef = useRef(0);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef(null);
  // CHAT-002: refs mirror chat state for the realtime handler. Reading state via
  // a setState updater's side effect is unreliable (React only evaluates updaters
  // eagerly when the queue is empty) — refs are always current.
  const activeChatRef = useRef(null);
  const conversationsRef = useRef([]);
  useEffect(() => { activeChatRef.current = activeChat; }, [activeChat]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  // FRONTEND-003 (CHAT-1): monotonic request id — only the NEWEST
  // loadConversations invocation may write state or IndexedDB; stale responses
  // are discarded, never applied. Bumped on logout so in-flight responses from
  // a previous session die silently instead of repopulating cleared state.
  const convReqIdRef = useRef(0);
  // FRONTEND-003 (CHAT-5): same guard for loadMessages, plus "which
  // conversation do the current `messages` belong to" — switching threads must
  // never render the previous conversation's messages.
  const msgReqIdRef = useRef(0);
  const messagesConvIdRef = useRef(null);
  // FRONTEND-003 session-ownership invariant: a response or realtime event may
  // write chat state/cache only when BOTH hold — (1) its request generation is
  // still current (req-id refs above) and (2) the user it was started for is
  // STILL the authenticated user. This ref is the synchronous source for (2):
  // it is updated inside the auth listener and at the top of signOut — not in
  // an effect — so it can never lag behind an auth change the way closures and
  // effect-timed state do. Ordering alone leaves a microtask window between
  // signOut and the cleanup effect where an in-flight response could re-write
  // state (and re-persist conv-{uid} to IndexedDB after signOut deleted it).
  const currentUserIdRef = useRef(null);
  // FRONTEND-004: who was signed in before the current auth state — lets the
  // user→null cleanup distinguish a REAL logout/expiry (navigate home, delete
  // that user's caches) from the anonymous app boot, where the same effect
  // fires but urlSync has just restored a deep link that must not be clobbered.
  const prevUserIdRef = useRef(null);

  // In-app message notification banner
  const [msgNotification, setMsgNotification] = useState(null);

  // Seller profile state
  const [sellerProfile, setSellerProfile] = useState(null);
  const [sellerListings, setSellerListings] = useState([]);
  const [loadingSeller, setLoadingSeller] = useState(false);

  // Orders state
  const [orders, setOrders] = useState([]);
  const [activeOrder, setActiveOrder] = useState(null);
  const [activeOrderId, setActiveOrderId] = useState(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const ordersLastLoadRef = useRef(0);

  // Notifications state (order events)
  const [orderNotifications, setOrderNotifications] = useState([]);
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);
  // FRONTEND-009: bell panel overlay (current page stays visible underneath).
  // Loading/error are surfaced honestly — a failed load must never render as
  // an empty "no notifications" state.
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);

  // Sound
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Camera permission
  const cameraStreamRef = useRef(null);
  const cameraPermissionGranted = useRef(false);
  const [cameraBlocked, setCameraBlocked] = useState(false);

  // Refs
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Profile cache for notification banners
  const profileCacheRef = useRef({});
  const profileLastLoadRef = useRef(0);

  const t = T[lang] || T.he || {};
  const rtl = lang === 'he';

  const playSound = useCallback((soundName) => {
    if (soundEnabled && SoundEffects[soundName]) {
      SoundEffects[soundName]();
    }
  }, [soundEnabled]);

  const showToastMsg = useCallback((msg, type = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts(prev => [...prev.slice(-3), { id, message: msg, type }]); // keep max 4
  }, []);
  const dismissToast = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  // ─── Refresh current user's profile from DB — 60s TTL to avoid hitting network on every tab tap ───
  const refreshProfile = useCallback(async () => {
    if (!user) return;
    if (profileLastLoadRef.current > 0 && (Date.now() - profileLastLoadRef.current < 60000)) return;
    const ownerId = user.id;
    const { data } = await supabase.rpc('get_own_profile').single();
    if (currentUserIdRef.current !== ownerId) return; // FRONTEND-004 ownership
    if (data) { setProfile(data); profileLastLoadRef.current = Date.now(); }
  }, [user]);

  // ─── Helper: get profile with in-memory cache ───
  const getCachedProfile = async (userId) => {
    if (!userId) return null;
    if (profileCacheRef.current[userId]) return profileCacheRef.current[userId];
    const { data } = await supabase.from('profiles').select('id, full_name, avatar_url').eq('id', userId).single();
    if (data) profileCacheRef.current[userId] = data;
    return data;
  };

  // Prevents filter useEffect from double-fetching listings on mount (init() already fetches)
  const filterInitSkippedRef = useRef(true);

  // ─── INIT + AUTH LISTENER ────────────────────────────
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      // Phase 1: read IDB cache — instant (~1ms), no network needed
      const [cachedListings, cachedLang] = await Promise.all([
        cacheGet('listings'),
        cacheGet('lang'),
      ]);
      if (mounted) {
        if (cachedListings?.length) {
          setListings(cachedListings);
          setHasMore(cachedListings.length >= PAGE_SIZE);
        }
        if (cachedLang) setLang(cachedLang);
      }

      // Phase 2: network refresh in background — doesn't block UI
      try {
        // DEV: log full URL so we can verify OAuth redirect landed here with tokens
        if (import.meta.env.DEV) console.log('[Auth] returned URL=', window.location.href);

        const [sessionResult, listingsResult] = await Promise.all([
          supabase.auth.getSession(),
          supabase
            .from('listings')
            .select('*, seller:profiles(id, full_name, avatar_url, badge, is_verified, rating, review_count, total_sales, created_at)')
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(PAGE_SIZE),
        ]);

        if (import.meta.env.DEV) {
          console.log('[Auth] session user=', sessionResult.data?.session?.user?.email ?? null);
        }

        // AUTH-001: Preview-safe boot diagnostic. Every other auth log in this
        // file is behind import.meta.env.DEV or the hostname-based DEV flag,
        // both FALSE on a Vercel Preview production build — which is why the
        // 401 investigation had server evidence and no client evidence at all.
        //
        // Booleans and a timestamp only: no token, no email, no user id. One
        // line per page load, so it is safe to leave on in production too, and
        // it is the line that distinguishes "session never restored" (an
        // infrastructure/redirect problem) from "session restored but the token
        // was not attached" (a client problem). Do not gate this behind DEV.
        console.log('[Auth] boot', JSON.stringify({
          sessionPresent: !!sessionResult.data?.session,
          userIdPresent: !!sessionResult.data?.session?.user?.id,
          accessTokenPresent: !!sessionResult.data?.session?.access_token,
          expiresInSec: sessionResult.data?.session?.expires_at
            ? sessionResult.data.session.expires_at - Math.floor(Date.now() / 1000)
            : null,
          at: new Date().toISOString(),
        }));

        if (mounted && sessionResult.data?.session?.user) {
          currentUserIdRef.current = sessionResult.data.session.user.id;
          setUser(sessionResult.data.session.user);
          supabase.rpc('get_own_profile').single()
            .then(({ data }) => { if (mounted && data) setProfile(data); })
            .catch(() => {});
        }

        if (mounted && listingsResult.data) {
          setListings(listingsResult.data);
          setHasMore(listingsResult.data.length === PAGE_SIZE);
          cacheSet('listings', listingsResult.data);
        }
      } catch (e) { console.log('Init refresh error:', e); }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (import.meta.env.DEV) {
        console.log('[Auth] auth state change=', event, 'user=', session?.user?.email ?? null);
      }
      if (!mounted) return;
      if (event === 'PASSWORD_RECOVERY') {
        currentUserIdRef.current = session.user.id;
        setUser(session.user);
        setPasswordRecovery(true);
        setAuthMode('recovery');
        setShowSignInModal(true);
        return;
      }
      if (session?.user) {
        currentUserIdRef.current = session.user.id;
        setUser(session.user);
        supabase.rpc('get_own_profile').single()
          .then(({ data }) => { if (mounted && data) setProfile(data); })
          .catch(err => { if (DEV) console.error('[Auth] Profile fetch failed:', err); });
      } else { currentUserIdRef.current = null; setUser(null); setProfile(null); }
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Debounce price range
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPriceRange(priceRange), 300);
    return () => clearTimeout(timer);
  }, [priceRange]);

  // Persist lang to IDB so it's restored instantly on next launch
  useEffect(() => { cacheSet('lang', lang); }, [lang]);

  // Reload listings when filters change — skip first mount (init() already fetched)
  useEffect(() => {
    if (filterInitSkippedRef.current) { filterInitSkippedRef.current = false; return; }
    setListingsPage(0);
    setHasMore(true);
    loadListings(true);
  }, [category, filterCondition, debouncedPriceRange.min, debouncedPriceRange.max, debouncedSearch]);

  // ═══ FRONTEND-004: centralized logout / user-switch reset ═══════════════
  // The ONE place that erases every user-owned and session-transient atom.
  // Runs on explicit logout, session expiry, and account switch — safe to
  // call repeatedly (every operation is idempotent). Ownership guards on the
  // loaders (currentUserIdRef, FRONTEND-003 pattern) make its timing safe:
  // even a response resolving mid-reset cannot write for a signed-out user.
  //
  // INTENTIONALLY RETAINED (not user-owned):
  //   lang / soundEnabled          device preferences
  //   listings + browse filters/pagination   public marketplace cache
  //   scanCooldownUntil            server rate-limit echo — clearing it on
  //                                logout would let re-login dodge cooldowns
  //   toasts                       auto-dismissing; signOut clears explicitly
  //                                before posting its own confirmation
  //   hintsCacheRef                global recognition patterns, not user data
  //   publishing/sendingMessage/*Uploading   in-flight flags their own
  //                                          finally blocks release
  const clearUserState = ({ navigate = false, outgoingUserId = null } = {}) => {
    // 1) Async safety first: invalidate request generations and per-user refs
    //    so anything in flight dies before the visible state is rebuilt.
    convReqIdRef.current++; msgReqIdRef.current++; messagesConvIdRef.current = null;
    ordersLastLoadRef.current = 0; conversationsLastLoadRef.current = 0; profileLastLoadRef.current = 0;
    currentScanUuidRef.current = null; capturedImageRef.current = null;
    lastAttemptRef.current = null; // SCAN-2: never replay a signed-out user's images
    // MKT-3: a REAL logout/expiry/switch must drop the buy intent so it can
    // never resume in another account's session. Guarded by outgoingUserId:
    // this function also runs on the anonymous boot — which is exactly the
    // document the OAuth redirect returns to — and clearing there would
    // delete the persisted intent moments before the restored session
    // consumes it. (Intents are only ever written while signed OUT, so an
    // intent present during a boot belongs to this tab's current visitor.)
    if (outgoingUserId) clearPendingBuy();
    profileCacheRef.current = {}; serialLoadingRef.current = false;
    if (pipelineAbortRef.current) pipelineAbortRef.current.abort();
    if (cameraStreamRef.current) {
      try { cameraStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
      cameraStreamRef.current = null;
    }
    // 2) User-owned data.
    setProfile(null);
    setMyListings([]); setSavedItems([]); setSavedIds(new Set());
    setConversations([]); setConversationsLoading(false); setUnreadCount(0);
    setMessages([]); setMessagesLoading(false); setNewMessage('');
    setOrders([]); setActiveOrder(null); setActiveOrderId(null); setOrdersLoading(false);
    setOrderNotifications([]); setNotifUnreadCount(0);
    setShowNotifications(false); setNotifLoading(false); setNotifError(false);
    setValuations([]); setValuationsLoading(false);
    setResult(null); setImages([]);
    setSerialData(null); setSerialLoading(false);
    setListingData({ title: '', desc: '', price: 0, phone: '', location: '' });
    setAnswers({}); setCondition(null); setListingStep(0);
    setSellerReviews([]); setSellerProfile(null); setSellerListings([]);
    setSellerReviewsError(false); setSellerReviewsTotal(0);
    setMyReviews([]); setMyReviewsLoading(false); setMyReviewsError(false); setMyReviewsTotal(0);
    // 3) Session-transient UI (private overlays, selections, banners, drafts).
    setSelected(null); setActiveChat(null); setMsgNotification(null);
    setShowCheckout(false); setShowContact(false);
    setShowSignInModal(false); setSignInAction(null);
    setHelpModalOpen(false); setAddPhotoMode(false); setCameraBlocked(false);
    setHeartAnim(null); setShowFlash(false);
    setPipelineState('idle'); setPipelineError(null);
    setError(null);
    setAuthForm({ name: '', email: '', password: '' }); setAuthError(null);
    setAuthMode('login'); setPasswordRecovery(false);
    setTorchOn(false); setTorchSupported(false);
    // 4) User-scoped IndexedDB — idempotent with signOut's deletes, and makes
    //    session-EXPIRY equivalent to explicit logout on shared devices.
    if (outgoingUserId) {
      ['mylistings', 'saved', 'conv', 'orders']
        .forEach(k => cacheDelete(`${k}-${outgoingUserId}`));
    }
    // 5) Navigation — only on a real user→null transition (see prevUserIdRef).
    if (navigate) { setNavDirection('tab'); setTab('home'); setView('home'); }
  };

  // Load user data when auth changes
  useEffect(() => {
    if (user) {
      prevUserIdRef.current = user.id;
      loadUserData();
      // MKT-3: consume the pending buy intent exactly once. takePendingBuy
      // deletes the stored intent synchronously BEFORE the async resume, so
      // rapid auth transitions, a second effect run from a token refresh, a
      // double OAuth callback, or a page refresh after a successful resume
      // can never replay it. TTL/shape validation lives in the helper.
      const pending = takePendingBuy();
      if (pending) {
        setSignInAction(null);
        resumeBuyIntent(pending.listingId, user.id);
      }
    }
    else {
      const outgoing = prevUserIdRef.current;
      prevUserIdRef.current = null;
      // navigate only when someone was actually signed in — on anonymous boot
      // this effect also fires, and clobbering the view would break the deep
      // link urlSync just restored.
      clearUserState({ navigate: !!outgoing, outgoingUserId: outgoing });
    }
  }, [user]);

  // Auto-dismiss errors
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Auto-dismiss message notification banner
  useEffect(() => {
    if (msgNotification) {
      const timer = setTimeout(() => setMsgNotification(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [msgNotification]);

  // ═══════════════════════════════════════════════════════
  // REALTIME MESSAGING + IN-APP NOTIFICATION ENGINE
  // ═══════════════════════════════════════════════════════
  useRealtimeChannel(
    user?.id,
    'rt-msgs',
    (channelName) => supabase
      .channel(channelName)
      .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          async (payload) => {
            const newMsg = payload.new;
            // Ownership gate: handlers were bound with the subscribing user's
            // closure; an event buffered in the socket can still fire during
            // teardown after logout/switch. Drop it before ANY state write.
            if (!user || currentUserIdRef.current !== user.id) return;
            if (newMsg.sender_id === user.id) return;

            // CHAT-002: read the open chat from a ref, never from a setState
            // updater side effect (the old pattern intermittently reported false
            // while the user WAS in the chat → phantom banner + wrong badge).
            const isInThisChat = activeChatRef.current?.id === newMsg.conversation_id;
            if (isInThisChat) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === newMsg.id)) return prev;
                return [...prev, newMsg];
              });
              setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
              supabase.from('messages').update({ is_read: true }).eq('id', newMsg.id)
                .then(({ error }) => { if (error && DEV) console.error('[Chat] Mark read failed:', error); });
            }

            if (!isInThisChat) {
              try {
                const [senderProfile, convData] = await Promise.all([
                  getCachedProfile(newMsg.sender_id),
                  supabase
                    .from('conversations')
                    .select('listing:listings(id, title, title_hebrew, images)')
                    .eq('id', newMsg.conversation_id)
                    .single()
                    .then(r => r.data),
                ]);
                const senderName = senderProfile?.full_name || (lang === 'he' ? 'משתמש' : 'Someone');
                const listing = convData?.listing;
                const listingTitle = (lang === 'he' && listing?.title_hebrew)
                  ? listing.title_hebrew : (listing?.title || '');
                setMsgNotification({
                  senderName, listingTitle, content: formatMessagePreview(newMsg.content, lang),
                  conversationId: newMsg.conversation_id,
                  listingImage: listing?.images?.[0] || null,
                  isOffer: newMsg.is_offer, offerAmount: newMsg.offer_amount,
                });
                playSound('tap');
              } catch (err) {
                console.warn('Notification enrichment failed:', err);
                setMsgNotification({
                  senderName: lang === 'he' ? 'הודעה חדשה' : 'New message',
                  listingTitle: '', content: formatMessagePreview(newMsg.content, lang),
                  conversationId: newMsg.conversation_id,
                });
              }
            }
            // Update the conversation preview in-place — avoids a full network reload
            // on every incoming message. Only fall back to a reload if the conversation
            // isn't in state yet (e.g. a brand-new thread the user hasn't seen).
            // Membership is checked via ref (not inside the updater) so the updater
            // stays pure. If we're reading this chat right now the preview is stored
            // as already-read — the derived unread count must not include it.
            if (!conversationsRef.current.some(c => c.id === newMsg.conversation_id)) {
              loadConversations(true); // unknown thread — full (request-id-guarded) refetch
            } else {
              const previewMsg = isInThisChat ? { ...newMsg, is_read: true } : newMsg;
              const cur = conversationsRef.current;
              const idx = cur.findIndex(c => c.id === newMsg.conversation_id);
              if (idx !== -1) {
                const updated = { ...cur[idx], updated_at: newMsg.created_at, messages: [previewMsg] };
                // applyConversations persists to IndexedDB too (CHAT-4): a
                // badge earned or cleared in-session now survives app restart
                // instead of resurrecting from a stale cache snapshot.
                applyConversations([updated, ...cur.slice(0, idx), ...cur.slice(idx + 1)]);
              }
            }
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages' },
          (payload) => {
            const updated = payload.new;
            // Ownership gate — see the INSERT handler above.
            if (!user || currentUserIdRef.current !== user.id) return;
            setMessages((prev) => {
              // Guard: skip if the updated message is not in the current view.
              // Without this, every is_read mark on any conversation creates a
              // new array reference and triggers a React re-render unnecessarily.
              if (!prev.some((m) => m.id === updated.id)) return prev;
              return prev.map((m) => m.id === updated.id ? { ...m, ...updated } : m);
            });
            // CHAT-4: also reconcile the conversation PREVIEW + cache — read
            // marks from elsewhere (same account on another device/tab) must
            // clear the inbox badge without waiting for a full refetch.
            const cur = conversationsRef.current;
            const idx = cur.findIndex(c => (c.messages || []).some(m => m.id === updated.id));
            if (idx !== -1) {
              const next = [...cur];
              next[idx] = {
                ...cur[idx],
                messages: cur[idx].messages.map(m => m.id === updated.id ? { ...m, ...updated } : m),
              };
              applyConversations(next);
            }
          }
        ),
    // Re-sync after a reconnect (realtime does not replay events missed while
    // the socket was down). CHAT-002: also reload the OPEN conversation —
    // without this, messages missed during the outage update the inbox preview
    // but never appear in the thread the user is looking at.
    () => {
      loadConversations(true);
      const open = activeChatRef.current;
      if (open?.id && !open.isDemo) loadMessages(open.id);
    },
  );

  // ═══════════════════════════════════════════════════════
  // REALTIME: ORDER NOTIFICATIONS + ORDER STATUS CHANGES
  // ═══════════════════════════════════════════════════════
  // Load notification count + subscribe for live updates
  const loadNotifications = useCallback(async () => {
    if (!user) return;
    const ownerId = user.id;
    setNotifLoading(true);
    setNotifError(false);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, data, read_at, created_at')
        .eq('user_id', ownerId)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      if (currentUserIdRef.current !== ownerId) return; // FRONTEND-004 ownership
      setOrderNotifications(data || []);
      setNotifUnreadCount((data || []).filter(n => !n.read_at).length);
    } catch (e) {
      if (currentUserIdRef.current !== ownerId) return;
      if (DEV) console.warn('[Notifs] Load error:', e.message);
      setNotifError(true); // FRONTEND-009: panel shows error+retry, never a false empty
    } finally {
      if (currentUserIdRef.current === ownerId) setNotifLoading(false);
    }
  }, [user]);

  const markNotifRead = useCallback(async (notifId) => {
    const ownerId = currentUserIdRef.current; // whoever tapped
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', notifId);
    // FRONTEND-004b ownership: a stale completion must not decrement the NEXT
    // account's freshly-loaded badge.
    if (!ownerId || currentUserIdRef.current !== ownerId) return;
    setOrderNotifications(prev => prev.map(n => n.id === notifId ? { ...n, read_at: new Date().toISOString() } : n));
    setNotifUnreadCount(prev => Math.max(0, prev - 1));
  }, []);

  const markAllNotifsRead = useCallback(async () => {
    if (!user) return;
    const ownerId = user.id;
    await supabase.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('user_id', ownerId).is('read_at', null);
    if (currentUserIdRef.current !== ownerId) return; // FRONTEND-004b ownership
    setOrderNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    setNotifUnreadCount(0);
  }, [user]);

  useEffect(() => { if (user?.id) loadNotifications(); }, [user?.id, loadNotifications]);

  useRealtimeChannel(
    user?.id,
    'rt-notifs',
    (channelName) => supabase
      .channel(channelName)
      .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
          (payload) => {
            // FRONTEND-004 ownership gate: events buffered during channel
            // teardown must not repopulate a signed-out user's badge/list.
            if (!user || currentUserIdRef.current !== user.id) return;
            const notif = payload.new;
            setOrderNotifications(prev => [notif, ...prev]);
            setNotifUnreadCount(prev => prev + 1);
            showToastMsg(notif.title || (lang === 'he' ? 'התראה חדשה' : 'New notification'));
            playSound('tap');
            if (notif.type?.startsWith('ORDER_')) {
              loadOrders(true);
            }
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'orders' },
          (payload) => {
            if (!user || currentUserIdRef.current !== user.id) return; // FRONTEND-004 ownership
            const updated = payload.new;
            if (updated.buyer_id !== user.id && updated.seller_id !== user.id) return;
            setOrders(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o));
            setActiveOrder(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev);
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'orders' },
          (payload) => {
            if (!user || currentUserIdRef.current !== user.id) return; // FRONTEND-004 ownership
            const newOrder = payload.new;
            if (newOrder.seller_id === user.id || newOrder.buyer_id === user.id) {
              if (DEV) console.log('[Realtime] New order detected, refreshing orders');
              loadOrders(true);
            }
          }
        ),
    // Re-sync notifications + orders after a reconnect (missed while offline).
    () => { loadNotifications(); loadOrders(true); },
  );

  // Tap notification banner → open that conversation
  const openNotification = async (notification) => {
    if (!notification?.conversationId || !user) return;
    const ownerId = user.id; // FRONTEND-004b: no post-logout navigation/state
    setMsgNotification(null);
    const conv = conversations.find((c) => c.id === notification.conversationId);
    if (conv) {
      const otherUser = conv.buyer_id === user.id ? conv.seller : conv.buyer;
      setActiveChat({ ...conv, otherUser });
      loadMessages(conv.id);
      setNavDirection('push'); setView('chat');
      setTab('messages');
      return;
    }
    const { data } = await supabase
      .from('conversations')
      .select(`*, listing:listings(id, title, title_hebrew, price, images), buyer:profiles!conversations_buyer_id_fkey(id, full_name, avatar_url), seller:profiles!conversations_seller_id_fkey(id, full_name, avatar_url)`)
      .eq('id', notification.conversationId)
      .single();
    if (currentUserIdRef.current !== ownerId) return;
    if (data) {
      const otherUser = data.buyer_id === user.id ? data.seller : data.buyer;
      setActiveChat({ ...data, otherUser });
      loadMessages(data.id);
      setNavDirection('push'); setView('chat');
      setTab('messages');
      loadConversations(true);
    }
  };

  const dismissNotification = useCallback(() => setMsgNotification(null), []);

  // ─── DATA LOADING ───────────────────────────────────

  const loadListings = useCallback(async (reset = false) => {
    const thisRequestId = ++loadRequestIdRef.current; // Increment request ID
    // MKT-1: a reset must atomically restore pagination — refresh callers
    // (pull-to-refresh, Refresh button) fetch page 0 here, so listingsPage
    // must be 0 too or the next Load More requests page N+1 and silently
    // skips pages 1..N. (The filter-change effect also sets these; idempotent.)
    if (reset) { setListingsPage(0); setHasMore(true); }
    const page = reset ? 0 : listingsPage;
    const offset = page * PAGE_SIZE;
    let query = supabase
      .from('listings')
      .select('*, seller:profiles(id, full_name, avatar_url, badge, is_verified, rating, review_count, total_sales, created_at)')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (category !== 'all') query = query.eq('category', category);
    if (filterCondition !== 'all') query = query.eq('condition', filterCondition);
    if (debouncedPriceRange.min) query = query.gte('price', parseInt(debouncedPriceRange.min));
    if (debouncedPriceRange.max) query = query.lte('price', parseInt(debouncedPriceRange.max));
    if (debouncedSearch) {
      const safe = sanitizeSearch(debouncedSearch);
      if (safe) query = query.or(`title.ilike.%${safe}%,title_hebrew.ilike.%${safe}%,description.ilike.%${safe}%,category.ilike.%${safe}%`);
    }
    const { data } = await query;
    // Stale response guard: if another request fired while we were waiting, discard this result
    if (thisRequestId !== loadRequestIdRef.current) return;
    if (data) {
      // Normalize category on read — trim whitespace to match tab IDs exactly
      const normalized = data.map(item => ({
        ...item,
        category: item.category ? item.category.trim() : 'Other'
      }));
      if (reset || page === 0) { setListings(normalized); } else { setListings((prev) => [...prev, ...normalized]); }
      setHasMore(normalized.length === PAGE_SIZE);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, filterCondition, debouncedPriceRange.min, debouncedPriceRange.max, debouncedSearch]);

  const loadMoreListings = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const thisRequestId = ++loadRequestIdRef.current;
    const nextPage = listingsPage + 1;
    setListingsPage(nextPage);
    const offset = nextPage * PAGE_SIZE;
    let query = supabase
      .from('listings')
      .select('*, seller:profiles(id, full_name, avatar_url, badge, is_verified, rating, review_count, total_sales, created_at)')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (category !== 'all') query = query.eq('category', category);
    if (filterCondition !== 'all') query = query.eq('condition', filterCondition);
    if (debouncedPriceRange.min) query = query.gte('price', parseInt(debouncedPriceRange.min));
    if (debouncedPriceRange.max) query = query.lte('price', parseInt(debouncedPriceRange.max));
    if (debouncedSearch) {
      const safe = sanitizeSearch(debouncedSearch);
      if (safe) query = query.or(`title.ilike.%${safe}%,title_hebrew.ilike.%${safe}%,description.ilike.%${safe}%,category.ilike.%${safe}%`);
    }
    const { data } = await query;
    if (thisRequestId !== loadRequestIdRef.current) { setLoadingMore(false); return; }
    if (data) {
      const normalized = data.map(item => ({
        ...item,
        category: item.category ? item.category.trim() : 'Other'
      }));
      setListings((prev) => [...prev, ...normalized]);
      setHasMore(normalized.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  };

  const loadUserData = async () => {
    if (!user) return;
    // FRONTEND-004 ownership: responses started for this user must not write
    // after logout/switch — they would repopulate cleared state and recreate
    // deleted caches (same invariant as the chat loaders, FRONTEND-003).
    const ownerId = user.id;
    const owned = () => currentUserIdRef.current === ownerId;

    // Phase 1: IDB cache — fill state before network returns
    const [cachedMy, cachedSaved] = await Promise.all([
      cacheGet(`mylistings-${ownerId}`),
      cacheGet(`saved-${ownerId}`),
    ]);
    if (!owned()) return;
    if (cachedMy?.length) setMyListings(cachedMy);
    if (cachedSaved?.length) {
      setSavedItems(cachedSaved.map(s => s.listing).filter(Boolean));
      setSavedIds(new Set(cachedSaved.map(s => s.listing_id)));
    }

    // Phase 2: network refresh
    const [myResult, savedResult] = await Promise.allSettled([
      supabase.from('listings').select('*').eq('seller_id', ownerId).neq('status', 'deleted').order('created_at', { ascending: false }),
      supabase.from('saved_items').select('*, listing:listings(*, seller:profiles(id, full_name, badge))').eq('user_id', ownerId)
    ]);
    if (!owned()) return;
    if (myResult.status === 'fulfilled' && myResult.value.data) {
      setMyListings(myResult.value.data);
      cacheSet(`mylistings-${ownerId}`, myResult.value.data);
    }
    if (savedResult.status === 'fulfilled' && savedResult.value.data) {
      const savedData = savedResult.value.data;
      setSavedItems(savedData.map(s => s.listing).filter(Boolean));
      setSavedIds(new Set(savedData.map(s => s.listing_id)));
      cacheSet(`saved-${ownerId}`, savedData);
    } else if (savedResult.status === 'fulfilled' && savedResult.value.error) {
      // FRONTEND-009: this SELECT was 403ing for every user (saved_items RLS,
      // migration 20260719000002) and the failure vanished without a trace.
      console.error('[Saved] Load failed:', savedResult.value.error.message);
    }
    loadConversations(true);
    loadOrders(true);
  };

  // ─── SELLER PROFILE ──────────────────────────────────
  const viewSellerProfile = async (sellerId) => {
    if (!sellerId) return;
    setNavDirection('push');
    setLoadingSeller(true);
    setView('sellerProfile');
    const [{ data: profileData, error: profileErr }, { data: listingsData, error: listingsErr }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, avatar_url, is_verified, rating, review_count, badge, total_sales, reputation_points, response_rate, created_at').eq('id', sellerId).single(),
      supabase.from('listings')
        .select('*, seller:profiles(id, full_name, avatar_url, badge, is_verified, rating, review_count, total_sales, created_at)')
        .eq('seller_id', sellerId).eq('status', 'active')
        .order('created_at', { ascending: false })
    ]);
    if (profileErr) console.error('[Seller] Profile fetch failed:', profileErr);
    if (listingsErr) console.error('[Seller] Listings fetch failed:', listingsErr);
    if (profileData) setSellerProfile(profileData);
    if (listingsData) setSellerListings(listingsData);
    setLoadingSeller(false);
  };

  // ─── CHAT ───────────────────────────────────────────

  // BADGE SEMANTIC (single, explicit): unreadCount = number of CONVERSATIONS
  // containing messages the current user has not read. It is derived from
  // `conversations` in exactly one place (the effect below) and never mixes in
  // notification-table rows (notifUnreadCount — bell badge), transient message
  // banners (msgNotification), or raw per-message counts.
  // CHAT-002: badge semantics = number of CONVERSATIONS with unread messages.
  // The preview query only carries the last message per conversation, so a
  // per-message total was never obtainable here — the old code mixed both
  // meanings (initial load counted ≤1/conv, realtime incremented per message)
  // and the badge visibly shrank on every reload. unreadCount is now derived
  // from `conversations` in one place (effect below) for every path: initial
  // load, cache, realtime, reconnect.
  const countUnread = (convList, userId) =>
    (convList || []).reduce((n, c) =>
      n + ((c.messages || []).some(m => !m.is_read && m.sender_id !== userId) ? 1 : 0), 0);

  useEffect(() => {
    setUnreadCount(user ? countUnread(conversations, user.id) : 0);
  }, [conversations, user]);

  // FRONTEND-003: the ONLY write path for conversation-list state (CHAT-1/3/4).
  // Source-of-truth contract: DB is authoritative; React state is the current
  // session's representation; IndexedDB is a startup accelerator that must
  // never look fresher than memory — so every accepted list is written to BOTH
  // in the same call. The open conversation's preview is coerced to read (the
  // user is literally looking at it): a fetch that started before a mark-read
  // commit — the one interleaving request-ids alone can't order — can no
  // longer resurrect its badge.
  const applyConversations = useCallback((list) => {
    // Ownership gate: `user` here is the CLOSURE owner (who the data belongs
    // to); currentUserIdRef is who is authenticated NOW. Writing state or
    // conv-{uid} for anyone but the current user is forbidden — this blocks
    // post-logout re-persistence and any cross-account write, independent of
    // request ordering.
    if (!user || currentUserIdRef.current !== user.id) return;
    const openId = activeChatRef.current?.id;
    const next = (list || []).map(c =>
      c.id === openId && (c.messages || []).some(m => !m.is_read && m.sender_id !== user.id)
        ? { ...c, messages: c.messages.map(m => m.sender_id !== user.id ? { ...m, is_read: true } : m) }
        : c
    );
    setConversations(next); // unreadCount derives from this via effect
    cacheSet(`conv-${user.id}`, next);
  }, [user]);

  const loadConversations = useCallback(async (force = false) => {
    if (!user) return;
    if (!force && conversationsLastLoadRef.current > 0 && (Date.now() - conversationsLastLoadRef.current < 30000)) return;

    // CHAT-1: stale-response guard. Ids are assigned at start, and mark-read
    // always triggers a fresh forced load AFTER its commit — so any request
    // that read the DB pre-commit necessarily has a lower id and is discarded
    // before it can overwrite state or cache.
    const reqId = ++convReqIdRef.current;
    const ownerId = user.id; // captured at start — the user this request is FOR
    const isStale = () => reqId !== convReqIdRef.current || currentUserIdRef.current !== ownerId;
    const t0 = DEV ? performance.now() : 0;

    // Phase 1: IDB cache — cold-start accelerator ONLY (CHAT-3). Every
    // in-memory write also wrote the cache, so memory is always at least as
    // fresh: reapplying cache over live state is what made cleared badges
    // visibly resurrect. Skip it entirely once state exists for this session.
    if (conversationsRef.current.length === 0) {
      setConversationsLoading(true);
      const cached = await cacheGet(`conv-${user.id}`);
      if (isStale()) return;
      if (cached?.length && conversationsRef.current.length === 0) {
        applyConversations(cached);
        setConversationsLoading(false);
        if (DEV) console.log(`[Chat] IDB cache: ${cached.length} convs in ${(performance.now() - t0).toFixed(0)}ms`);
      }
    }

    // Phase 2: lightweight network refresh — ONLY preview data (last msg per
    // conv). Full threads are fetched lazily when a conversation opens.
    if (DEV) console.log(`[Chat] Network fetch start (+${(performance.now() - t0).toFixed(0)}ms)`);
    const { data } = await supabase
      .from('conversations')
      .select(`id, buyer_id, seller_id, updated_at,
        listing:listings(id, title, title_hebrew, price, images),
        buyer:profiles!buyer_id(id, full_name, avatar_url),
        seller:profiles!seller_id(id, full_name, avatar_url),
        messages(id, content, created_at, sender_id, is_read, is_offer, offer_amount)`)
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false, referencedTable: 'messages' })
      .limit(1, { referencedTable: 'messages' });
    if (isStale()) return; // a newer request owns state, cache, and the skeleton
    if (data) {
      applyConversations(data);
      conversationsLastLoadRef.current = Date.now();
      if (DEV) console.log(`[Chat] Network done: ${data.length} convs in ${(performance.now() - t0).toFixed(0)}ms`);
    }
    setConversationsLoading(false);
  }, [user, applyConversations]);

  const loadMessages = async (conversationId) => {
    // CHAT-5: switching threads must never show the previous conversation's
    // messages — clear immediately when the target conversation changes.
    // (Re-opening the SAME conversation keeps messages visible while fresh
    // ones fetch, preserving the original perf behavior.)
    if (messagesConvIdRef.current !== conversationId) {
      setMessages([]);
      messagesConvIdRef.current = conversationId;
    }
    const reqId = ++msgReqIdRef.current;
    const ownerId = user.id; // captured at start — the user this thread belongs to
    setMessagesLoading(true);
    const { data } = await supabase
      .from('messages').select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    // Stale guard: a slow fetch for a previously-opened conversation must not
    // overwrite the thread the user is looking at now — and a response owned
    // by a signed-out (or switched) account must never render at all.
    if (reqId !== msgReqIdRef.current
        || messagesConvIdRef.current !== conversationId
        || currentUserIdRef.current !== ownerId) return;
    if (data) {
      setMessages(data);
      const unreadIds = data.filter((m) => !m.is_read && m.sender_id !== user.id).map((m) => m.id);
      if (unreadIds.length > 0) {
        // CHAT-2: only a SUCCESSFUL commit may clear unread state. Scope is
        // schema-safe: ids come from this conversation's rows where the
        // sender is NOT the current user (recipient-side), and the write is
        // idempotent. On failure the badge stays honest — retry happens
        // naturally on the next open and via onRecover's reload while the
        // chat is still open. No user-facing error for a background write.
        const { error: readErr } = await supabase.from('messages')
          .update({ is_read: true }).in('id', unreadIds);
        if (readErr) {
          if (DEV) console.warn('[Chat] mark-read failed (badge stays honest):', readErr.message);
        } else {
          // Immediate in-place reconciliation of state + cache (badge clears
          // now, not when the refetch lands), then a guarded refetch to sync
          // the rest. The refetch starts after the commit, so it can only
          // confirm the read state.
          applyConversations(conversationsRef.current.map(c =>
            c.id === conversationId
              ? { ...c, messages: (c.messages || []).map(m => m.sender_id !== user.id ? { ...m, is_read: true } : m) }
              : c
          ));
          loadConversations(true);
        }
      }
    }
    setMessagesLoading(false);
  };

  // ─── START CONVERSATION ───
  const startConversation = async (item) => {
    if (!user) { setSignInAction('contact'); setShowSignInModal(true); return; }
    if (item.id?.toString().startsWith('s')) {
      setActiveChat({ id: `demo-${item.id}`, listing: item, seller: item.seller, otherUser: item.seller, isDemo: true });
      setNavDirection('push'); setMessages([]); setView('chat'); return;
    }
    const sellerId = item.seller_id || item.seller?.id;
    if (sellerId === user.id) {
      showToastMsg(lang === 'he' ? 'זה הפריט שלך!' : "That's your own listing!"); return;
    }
    const ownerId = user.id; // FRONTEND-004b: no post-logout chat navigation
    const { data: existingList } = await supabase.from('conversations').select('*')
      .eq('listing_id', item.id)
      .or(`and(buyer_id.eq.${user.id},seller_id.eq.${sellerId}),and(buyer_id.eq.${sellerId},seller_id.eq.${user.id})`);
    if (currentUserIdRef.current !== ownerId) return;
    const existing = existingList?.[0];
    if (existing) {
      const otherUserId = existing.buyer_id === user.id ? existing.seller_id : existing.buyer_id;
      const otherProfile = await getCachedProfile(otherUserId);
      setActiveChat({ ...existing, listing: item, seller: item.seller, otherUser: otherProfile || item.seller });
      setNavDirection('push'); loadMessages(existing.id); setView('chat'); return;
    }
    if (!sellerId) { setError(lang === 'he' ? 'לא ניתן ליצור שיחה' : 'Cannot start conversation'); return; }
    const payload = { listing_id: item.id, buyer_id: user.id, seller_id: sellerId };
    // Use .select() WITHOUT .single() — same pattern as messages.
    // If RETURNING is filtered to 0 rows by the conversations SELECT RLS policy,
    // .single() would throw PGRST116 and falsely report failure even though the
    // INSERT succeeded.
    const { data: rows, error: convError } = await supabase.from('conversations')
      .insert(payload).select();
    if (currentUserIdRef.current !== ownerId) return;
    if (convError) {
      console.error('[Chat] startConversation failed:', convError);
      console.error('[Chat] error code:', convError.code, '| message:', convError.message);
      // Fallback: conversation may already exist (race, duplicate key, etc.)
      const { data: retryRows } = await supabase.from('conversations').select('*')
        .eq('listing_id', item.id).or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`).limit(1);
      if (currentUserIdRef.current !== ownerId) return;
      const retry = retryRows?.[0];
      if (retry) {
        const otherUserId = retry.buyer_id === user.id ? retry.seller_id : retry.buyer_id;
        const otherProfile = await getCachedProfile(otherUserId);
        setActiveChat({ ...retry, listing: item, seller: item.seller, otherUser: otherProfile || item.seller });
        setNavDirection('push'); loadMessages(retry.id); setView('chat'); return;
      }
      setError(lang === 'he' ? 'שגיאה ביצירת שיחה' : 'Failed to start conversation'); return;
    }
    const newConv = rows?.[0] ?? null;
    if (newConv) {
      setActiveChat({ ...newConv, listing: item, seller: item.seller, otherUser: item.seller });
      setNavDirection('push'); setMessages([]); setView('chat'); loadConversations(true);
    } else {
      // INSERT succeeded (no error) but RETURNING was filtered by RLS SELECT policy.
      // Fetch the row directly — buyer_id = auth.uid() so SELECT policy must pass.
      console.error('[Chat] INSERT ok but RETURNING empty — fetching conversation directly');
      const { data: fetchRows } = await supabase.from('conversations').select('*')
        .eq('listing_id', item.id).eq('buyer_id', user.id).eq('seller_id', sellerId).limit(1);
      if (currentUserIdRef.current !== ownerId) return;
      const fetched = fetchRows?.[0];
      if (fetched) {
        setActiveChat({ ...fetched, listing: item, seller: item.seller, otherUser: item.seller });
        setNavDirection('push'); setMessages([]); setView('chat'); loadConversations(true);
      } else {
        console.error('[Chat] Could not fetch conversation after INSERT');
        setError(lang === 'he' ? 'שגיאה ביצירת שיחה' : 'Failed to start conversation');
      }
    }
  };

  // ─── SEND MESSAGE ───
  const sendMessage = async (content, isOffer = false, offerAmount = null) => {
    const text = (typeof content === 'string' ? content : '').trim();
    if (!text || !activeChat || sendingMessage) return;
    if (activeChat.isDemo) {
      const demoMsg = { id: `demo-msg-${Date.now()}`, sender_id: user.id, content: text, is_offer: isOffer, offer_amount: offerAmount, created_at: new Date().toISOString(), is_read: true };
      setMessages((prev) => [...prev, demoMsg]); setNewMessage('');
      setTimeout(() => {
        const responses = lang === 'he'
          ? ['מעניין! בוא נדבר', 'אני זמין, איפה נוח לך להיפגש?', 'אשמח לשמוע עוד', 'בוא ניצור קשר בווטסאפ']
          : ["Interesting! Let's talk", "I'm available, where would you like to meet?", "I'd love to hear more", "Let's connect on WhatsApp"];
        setMessages((prev) => [...prev, { id: `demo-reply-${Date.now()}`, sender_id: 'seller', content: responses[Math.floor(Math.random() * responses.length)], created_at: new Date().toISOString(), is_read: false }]);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }, 1500);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      return;
    }
    const ownerId = user.id; // FRONTEND-004b ownership
    setSendingMessage(true); setNewMessage('');
    const optimisticId = `temp-${Date.now()}`;
    const optimisticMsg = { id: optimisticId, conversation_id: activeChat.id, sender_id: user.id, content: text, is_offer: isOffer, offer_amount: offerAmount, created_at: new Date().toISOString(), is_read: false };
    setMessages((prev) => [...prev, optimisticMsg]);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    const payload = { conversation_id: activeChat.id, sender_id: user.id, content: text, is_offer: isOffer, offer_amount: offerAmount };
    try {
      // Use .select() WITHOUT .single() so a RETURNING result filtered by the
      // messages_select_participants RLS policy (nested conversation lookup) returns
      // an empty array — not a PGRST116 error — and the optimistic message stays visible.
      const { data: rows, error: msgError } = await supabase.from('messages')
        .insert(payload)
        .select();
      if (msgError) throw msgError;
      const data = rows?.[0] ?? null;
      if (data) {
        // RETURNING gave us the real row — swap optimistic for authoritative.
        setMessages((prev) => prev.map((m) => m.id === optimisticId ? data : m));
      }
      // Always refresh conversation timestamp (best-effort; error is non-fatal).
      const { error: convUpdateErr } = await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', activeChat.id);
      if (convUpdateErr) console.warn('[Chat] Conversation timestamp update failed:', convUpdateErr.message);
    } catch (e) {
      // FRONTEND-004b: a failure resolving post-logout must not restore this
      // draft or raise an error banner in the next session's UI.
      if (currentUserIdRef.current !== ownerId) { setSendingMessage(false); return; }
      console.error('[Chat] sendMessage failed:', e);
      console.error('[Chat] activeChat:', activeChat);
      console.error('[Chat] payload:', payload);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setNewMessage(text);
      setError(lang === 'he' ? 'שליחת ההודעה נכשלה' : 'Failed to send message');
    }
    setSendingMessage(false);
  };

  // ─── CHAT IMAGE UPLOAD ──────────────────────────────
  // Compress file to 1024px JPEG, upload to listings bucket under user's
  // path, then send a message containing the special __chat_img__ prefix
  // so ChatViews.jsx can render it as an image bubble.
  const sendChatImageMessage = async (file) => {
    if (!file || !activeChat || !user) return;
    // Compress
    const canvas = document.createElement('canvas');
    const imgEl = new Image();
    const dataUrl = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = e => res(e.target.result);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
    await new Promise((res, rej) => { imgEl.onload = res; imgEl.onerror = rej; imgEl.src = dataUrl; });
    const MAX = 1024;
    const ratio = Math.min(MAX / imgEl.width, MAX / imgEl.height, 1);
    canvas.width  = Math.round(imgEl.width  * ratio);
    canvas.height = Math.round(imgEl.height * ratio);
    canvas.getContext('2d').drawImage(imgEl, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
    // Upload — keep in user's folder so existing RLS policy accepts it
    const path = `${user.id}/chat_${Date.now()}.jpg`;
    const { error: uploadErr } = await supabase.storage
      .from('listings').upload(path, blob, { contentType: 'image/jpeg' });
    if (uploadErr) throw uploadErr;
    const { data: { publicUrl } } = supabase.storage.from('listings').getPublicUrl(path);
    await sendMessage(`__chat_img__${publicUrl}`);
  };

  // ─── AUTH ACTIONS ───────────────────────────────────

  const signInGoogle = async () => {
    const redirectTo = window.location.origin;
    if (import.meta.env.DEV) console.log('[Auth] signInWithOAuth redirectTo=', redirectTo);
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  };

  const signInEmail = async (e) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      if (authMode === 'login') {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email: authForm.email.trim(), password: authForm.password });
        if (err) {
          if (err.message === 'Invalid login credentials') setAuthError(lang === 'he' ? 'אימייל או סיסמה שגויים' : 'Invalid email or password');
          else if (err.message.includes('Email not confirmed')) setAuthError(lang === 'he' ? 'יש לאשר את האימייל קודם' : 'Please confirm your email first');
          else setAuthError(err.message);
        } else if (data?.user) {
          setView('profile'); setTab('profile'); setAuthForm({ name: '', email: '', password: '' });
          showToastMsg(lang === 'he' ? 'התחברת בהצלחה!' : 'Signed in!');
        }
      } else {
        const { data, error: err } = await supabase.auth.signUp({ email: authForm.email.trim(), password: authForm.password, options: { data: { full_name: authForm.name } } });
        if (err) setAuthError(err.message);
        else if (data?.user?.identities?.length === 0) setAuthError(lang === 'he' ? 'חשבון כבר קיים עם אימייל זה' : 'An account already exists with this email');
        else { setAuthError(null); showToastMsg(lang === 'he' ? 'נרשמת! בדוק את האימייל שלך' : 'Signed up! Check your email'); }
      }
    } catch (err) {
      console.error('Auth error:', err);
      setAuthError(lang === 'he' ? 'שגיאת חיבור' : 'Connection error');
    }
    setAuthLoading(false);
  };

  const signOut = async () => {
    // Revoke ownership FIRST — in-flight responses that resolve between the
    // cache deletes below and the auth event must already fail the ownership
    // check, or they would re-persist the data being deleted.
    currentUserIdRef.current = null;
    // Clear user-specific IDB entries so the next user on this device doesn't see stale data
    if (user) {
      await Promise.all([
        cacheDelete(`mylistings-${user.id}`),
        cacheDelete(`saved-${user.id}`),
        cacheDelete(`conv-${user.id}`),
        cacheDelete(`orders-${user.id}`),
      ]).catch(() => {});
    }
    const outgoingUserId = user?.id ?? null;
    await supabase.auth.signOut();
    // Immediate synchronous reset (nav + all user state) — no frame renders
    // User A data post-logout. The [user] effect repeats this idempotently
    // when the auth event lands; this call just wins the race for the eye.
    clearUserState({ navigate: true, outgoingUserId });
    setToasts([]); // drop any previous-account toasts before confirming
    showToastMsg(lang === 'he' ? 'התנתקת' : 'Signed out');
  };

  const sendPasswordReset = async (email) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin,
      });
      if (err) throw err;
      showToastMsg(lang === 'he' ? 'קישור לאיפוס נשלח לאימייל!' : 'Reset link sent! Check your email');
      setAuthMode('login');
    } catch (err) {
      setAuthError(lang === 'he' ? 'שליחה נכשלה. בדוק את כתובת האימייל.' : 'Failed to send. Check the email address.');
    }
    setAuthLoading(false);
  };

  const updatePassword = async (newPassword) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: newPassword });
      if (err) throw err;
      setPasswordRecovery(false);
      setAuthMode('login');
      setShowSignInModal(false);
      supabase.rpc('get_own_profile').single()
        .then(({ data }) => { if (data) setProfile(data); })
        .catch(() => {});
      setView('profile');
      setTab('profile');
      showToastMsg(lang === 'he' ? 'הסיסמה עודכנה' : 'Password updated');
    } catch {
      setAuthError(lang === 'he' ? 'עדכון נכשל. נסה שוב.' : 'Update failed. Please try again.');
    }
    setAuthLoading(false);
  };

  // Returns a fresh access_token, proactively refreshing if within 60s of expiry.
  // Avoids sending a stale token that the server will reject with SESSION_EXPIRED.
  // AUTH-001: wrapped in useCallback with EMPTY deps and kept that way
  // deliberately. It closes over nothing but the module-level `supabase`
  // client — no component state, no props — so the reference is stable and a
  // stale closure is structurally impossible. runPipeline lists it in its deps
  // on that basis; adding component state here would silently reintroduce the
  // stale-token class of bug this fix exists to remove.
  const getFreshToken = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;
      const secsLeft = (session.expires_at || 0) - Math.floor(Date.now() / 1000);
      if (secsLeft < 60) {
        const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
        if (error || !refreshed) return null;
        return refreshed.access_token;
      }
      return session.access_token;
    } catch { return null; }
  }, []);

  // ─── AVATAR UPLOAD ─────────────────────────────────
  const [avatarUploading, setAvatarUploading] = useState(false);

  const uploadAvatar = useCallback(async (file) => {
    if (!user || !file) return;
    if (!file.type.startsWith('image/')) {
      showToastMsg(lang === 'he' ? 'קובץ לא תקין' : 'Invalid file type');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToastMsg(lang === 'he' ? 'הקובץ גדול מדי (עד 10MB)' : 'File too large (max 10MB)');
      return;
    }

    const ownerId = user.id; // FRONTEND-004b ownership
    setAvatarUploading(true);
    try {
      // Read file to dataUrl
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      // Compress to 512x512
      const compressed = await compressImage(dataUrl, 512, 0.85);

      // Convert to blob
      const res = await fetch(compressed);
      const blob = await res.blob();

      const filePath = `${user.id}/avatar.jpg`;

      // Upload (upsert)
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });

      if (uploadErr) throw uploadErr;

      // Get public URL
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
      if (!urlData?.publicUrl) throw new Error('Failed to get avatar URL');
      const publicUrl = urlData.publicUrl + '?t=' + Date.now(); // cache bust

      // Update profile
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      if (updateErr) throw updateErr;

      // FRONTEND-004b: never patch a signed-out user's avatar into the next
      // session's profile state.
      if (currentUserIdRef.current !== ownerId) { setAvatarUploading(false); return; }

      // Update local state
      setProfile(prev => ({ ...prev, avatar_url: publicUrl }));
      showToastMsg(lang === 'he' ? 'התמונה עודכנה!' : 'Photo updated!');
      if (DEV) console.log('[Avatar] Uploaded:', publicUrl);

    } catch (e) {
      if (currentUserIdRef.current !== ownerId) { setAvatarUploading(false); return; }
      console.error('[Avatar] Upload failed:', e);
      showToastMsg(lang === 'he' ? 'שגיאה בהעלאת התמונה' : 'Failed to upload photo');
    }
    setAvatarUploading(false);
  }, [user, lang, showToastMsg]);

  // ─── VERIFICATION ──────────────────────────────────
  const [verificationUploading, setVerificationUploading] = useState(false);

  const requestVerification = useCallback(async (file) => {
    if (!user || !file) return;

    // ── 1. File type check ──────────────────────────────────────────────────
    const typeByMime = !!file.type && file.type.startsWith('image/');
    const typeByExt  = /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(file.name ?? '');
    const isImage    = typeByMime || typeByExt || !file.type;
    if (!isImage) {
      showToastMsg(lang === 'he' ? 'קובץ לא תקין. בחר תמונה' : 'Invalid file. Please choose an image.', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToastMsg(lang === 'he' ? 'הקובץ גדול מדי (מקסימום 10MB)' : 'File too large (max 10 MB)', 'error');
      return;
    }

    const ownerId = user.id; // FRONTEND-004b ownership
    setVerificationUploading(true);
    try {
      // ── 2. Compress to JPEG ────────────────────────────────────────────────
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(file);
      });
      const compressed = await compressImage(dataUrl, 1024, 0.85);
      const res  = await fetch(compressed);
      const blob = await res.blob();

      // ── 3. Require active session ─────────────────────────────────────────
      if (!user.id) {
        showToastMsg(lang === 'he' ? 'יש להתחבר מחדש לפני האימות' : 'Please sign in again before verifying.', 'error');
        setVerificationUploading(false);
        return;
      }
      const { data: { session: liveSession } } = await supabase.auth.getSession();
      if (!liveSession || liveSession.user.id !== user.id) {
        showToastMsg(lang === 'he' ? 'יש להתחבר מחדש לפני האימות' : 'Please sign in again before verifying.', 'error');
        setVerificationUploading(false);
        return;
      }

      // ── 4. Submit via Edge Function ───────────────────────────────────────
      // Server verifies JWT, uploads to private bucket with service role key,
      // and sets verification_status = 'pending' — bypasses Storage RLS.
      const formData = new FormData();
      formData.append('file', new File([blob], 'selfie.jpg', { type: 'image/jpeg' }));

      const { data: fnData, error: fnErr } = await supabase.functions.invoke(
        'submit-verification-selfie',
        { body: formData },
      );

      if (currentUserIdRef.current !== ownerId) { setVerificationUploading(false); return; } // FRONTEND-004b
      if (fnErr || !fnData?.ok) {
        const errMsg = fnData?.error ?? fnErr?.message
          ?? (lang === 'he' ? 'שגיאה בשליחת הסלפי' : 'Failed to submit selfie. Please try again.');
        console.error('[requestVerification] edge fn error:', fnErr, fnData);
        showToastMsg(errMsg, 'error');
        setVerificationUploading(false);
        return;
      }

      // ── 5. Sync local profile from DB ─────────────────────────────────────
      const { data: freshProfile, error: fetchErr } = await supabase.rpc('get_own_profile').single();
      if (currentUserIdRef.current !== ownerId) { setVerificationUploading(false); return; } // FRONTEND-004b
      if (fetchErr || !freshProfile) {
        console.error('[requestVerification] profile refetch failed:', fetchErr);
        // Non-fatal — patch optimistically from function response
        setProfile(prev => ({
          ...prev,
          verification_status:     fnData.verification_status,
          verification_photo_path: fnData.verification_photo_path,
        }));
        profileLastLoadRef.current = 0;
      } else {
        setProfile(freshProfile);
        profileLastLoadRef.current = Date.now();
      }

      showToastMsg(lang === 'he' ? 'הבקשה נשלחה! נבדוק בהקדם' : 'Request submitted! We\'ll review soon');

    } catch (e) {
      if (currentUserIdRef.current !== ownerId) { setVerificationUploading(false); return; } // FRONTEND-004b
      console.error('[requestVerification] unexpected error:', e);
      showToastMsg(lang === 'he' ? 'שגיאה בשליחת הסלפי' : 'Failed to submit selfie. Please try again.', 'error');
    }
    setVerificationUploading(false);
  }, [user, lang, showToastMsg]);

  // ─── ITEM ACTIONS ───────────────────────────────────

  const toggleSave = useCallback(async (item) => {
    if (!user) { setSignInAction('save'); setShowSignInModal(true); return; }
    const ownerId = user.id; // FRONTEND-004b ownership
    setHeartAnim(item.id);
    setTimeout(() => setHeartAnim(null), 800);
    // FRONTEND-009: check the write result — the DB was rejecting saved_items
    // DELETEs (42501, see migration 20260719000002) while the UI still said
    // "Removed" and un-hearted locally, resurrecting the heart on reload.
    // A failed write must say so and leave state untouched.
    if (savedIds?.has(item.id)) {
      const { error } = await supabase.from('saved_items').delete().eq('user_id', ownerId).eq('listing_id', item.id);
      if (currentUserIdRef.current !== ownerId) return;
      if (error) {
        console.error('[Saved] Remove failed:', error.message);
        showToastMsg(lang === 'he' ? 'שגיאה בהסרה — נסה שוב' : 'Remove failed — try again', 'error');
        return;
      }
      setSavedIds((prev) => { const n = new Set(prev); n.delete(item.id); return n; });
      setSavedItems((prev) => prev.filter((i) => i.id !== item.id));
      showToastMsg('Removed');
    } else {
      const { error } = await supabase.from('saved_items').insert({ user_id: ownerId, listing_id: item.id });
      if (currentUserIdRef.current !== ownerId) return;
      if (error) {
        console.error('[Saved] Save failed:', error.message);
        showToastMsg(lang === 'he' ? 'שגיאה בשמירה — נסה שוב' : 'Save failed — try again', 'error');
        return;
      }
      setSavedIds((prev) => new Set(prev).add(item.id));
      setSavedItems((prev) => [...prev, item]);
      showToastMsg('Saved!');
    }
  }, [user, savedIds, showToastMsg, lang]);

  // SELL-3: deletion order is DB-first, storage-second, and each step's
  // result is checked. The soft delete (status='deleted' — the app's intended
  // model, listings are never hard-deleted) is the authoritative mutation;
  // images are only purged AFTER it verifiably succeeded, because purging
  // first would leave a live listing with broken images marketplace-wide if
  // the update failed. Storage cleanup failure after a successful delete is
  // cleanup debt (logged/reported), never a resurrected listing.
  const deleteInFlightRef = useRef(new Set());
  const deleteListing = async (id) => {
    if (!user || !id) return false;
    if (deleteInFlightRef.current.has(id)) return false; // double-tap guard
    deleteInFlightRef.current.add(id);
    const ownerId = user.id; // FRONTEND-004b ownership
    try {
      const { data: listing } = await supabase
        .from('listings').select('images').eq('id', id).eq('seller_id', ownerId).single();
      if (currentUserIdRef.current !== ownerId) return false;

      // Authoritative mutation — .select() returns the affected rows, so an
      // RLS-filtered or failed update (0 rows) is detected, not assumed away.
      const { data: updatedRows, error: delErr } = await supabase
        .from('listings').update({ status: 'deleted' })
        .eq('id', id).eq('seller_id', ownerId).select('id');
      if (currentUserIdRef.current !== ownerId) return false;
      if (delErr || !updatedRows?.length) {
        if (DEV) console.warn('[Delete] listing update failed:', delErr?.message || '0 rows');
        showToastMsg(lang === 'he' ? 'שגיאה במחיקת המודעה' : 'Failed to delete listing', 'error');
        return false; // listing and images untouched
      }

      // DB success — now (and only now) update UI and purge images best-effort.
      loadUserData(); // refreshes myListings state + mylistings-{uid} cache
      showToastMsg(lang === 'he' ? 'המודעה נמחקה' : 'Deleted');
      if (listing?.images?.length) {
        const prefix = '/storage/v1/object/public/listings/';
        const paths = listing.images
          // Only paths inside OUR public listings bucket become remove()
          // targets — data/signed/external/malformed URLs fail the prefix
          // match and are skipped. split('?') strips any query string so a
          // cache-busted URL never yields a bogus storage object path.
          .map(url => { try { const idx = url.indexOf(prefix); return idx !== -1 ? url.slice(idx + prefix.length).split('?')[0] : null; } catch { return null; } })
          .filter(Boolean);
        if (paths.length) {
          supabase.storage.from('listings').remove(paths).then(({ error: rmErr }) => {
            if (rmErr) {
              // Cleanup debt only — the deletion itself succeeded and stands.
              console.warn('[Delete] storage cleanup failed (cleanup debt):', rmErr.message);
              reportError(rmErr, { stage: 'delete_listing_storage_cleanup', listing_id: id });
            }
          }).catch(() => {});
        }
      }
      return true;
    } finally {
      deleteInFlightRef.current.delete(id);
    }
  };

  // ── FRONTEND-006: minimal listing edit — title/description/price/condition ONLY.
  // Field whitelist is fixed here so callers can never touch images, category,
  // valuation, or serial data. Owner-scoped like deleteListing; RLS enforces
  // seller_id server-side as well.
  const updateListing = async (id, { title, description, price, condition: newCondition, titleHebrew }) => {
    const { data, error } = await supabase.from('listings')
      .update({
        title, description, price, condition: newCondition,
        // Only sent when the seller actually changed the title — keeps the
        // seller's words consistent in both languages instead of showing a
        // stale AI-generated Hebrew name over an edited title.
        ...(titleHebrew !== undefined && { title_hebrew: titleHebrew }),
      })
      .eq('id', id).eq('seller_id', user.id).select();
    if (currentUserIdRef.current !== user.id) return false; // FRONTEND-004b ownership
    if (error || !data?.length) {
      if (DEV) console.warn('[EditListing] update failed:', error?.message);
      showToastMsg(lang === 'he' ? 'שגיאה בעדכון המודעה' : 'Failed to update listing');
      return false;
    }
    const updated = data[0];
    setMyListings(prev => prev.map(l => (l.id === id ? { ...l, ...updated } : l)));
    setListings(prev => prev.map(l => (l.id === id ? { ...l, ...updated } : l)));
    setSelected(prev => (prev?.id === id ? { ...prev, ...updated } : prev));
    showToastMsg(lang === 'he' ? 'המודעה עודכנה' : 'Listing updated');
    return true;
  };

  // ═══════════════════════════════════════════════════════
  // IMAGE ANALYSIS PIPELINE
  //
  // State machine: idle → compressing → analyzing → success
  // Failure states: compress_error | analysis_error
  //
  // Features:
  //  • Client-side compression (800px max, JPEG 0.65)
  //  • Analysis API with retry (up to 2 attempts, exponential backoff)
  //  • AbortController cancellation (new image aborts old pipeline)
  //  • Instrumented dev logging
  //  • Error UI stays on analyzing screen with Retry button
  // ═══════════════════════════════════════════════════════

  // ── Fetch recognition hints (corrections) from DB for prompt injection ──
  // Queries aggregated correction patterns so Claude avoids repeat mistakes.
  // Called before every analysis. Returns top patterns by relevance.
  const fetchRecognitionHints = useCallback(async () => {
    // Perf: return cached hints if refreshed within 5 minutes
    const cache = hintsCacheRef.current;
    if (cache.data.length > 0 && (Date.now() - cache.ts < 300000)) {
      if (DEV) console.log(`[Hints] Using cache (${cache.data.length} hints, age ${Math.round((Date.now() - cache.ts) / 1000)}s)`);
      return cache.data;
    }
    try {
      const t0 = performance.now();
      const { data, error } = await supabase.rpc('get_recognition_hints', { p_limit: 15 });
      if (error) {
        if (DEV) console.warn('[Hints] Fetch failed:', error.message);
        return cache.data; // Return stale cache on error
      }
      const hints = data || [];
      hintsCacheRef.current = { data: hints, ts: Date.now() };
      if (DEV) console.log(`[Hints] Loaded ${hints.length} patterns in ${(performance.now() - t0).toFixed(0)}ms`);
      return hints;
    } catch (e) {
      if (DEV) console.warn('[Hints] Error:', e.message);
      return cache.data; // Return stale cache on error
    }
  }, []);

  // ── Store a correction pattern (user said Claude was wrong) ──
  const storeCorrection = useCallback(async (originalName, correctedName, category, brand, ocrText, modelNumber, confidence, valuationId) => {
    try {
      const { error } = await supabase.rpc('upsert_correction', {
        p_original_name: originalName,
        p_corrected_name: correctedName,
        p_category: category || null,
        p_brand: brand || null,
        p_visual_cue: ocrText ? `OCR found: "${ocrText.slice(0, 100)}"` : null,
        p_user_id: user?.id || null,
        p_valuation_id: valuationId || null,
        p_ocr_text: ocrText || null,
        p_model_number: modelNumber || null,
        p_confidence: confidence || null,
      });
      if (error) {
        if (DEV) console.warn('[Correction] Store failed:', error.message);
      } else {
        if (DEV) console.log(`[Correction] Stored: "${originalName}" → "${correctedName}"`);
      }
    } catch (e) {
      if (DEV) console.warn('[Correction] Error:', e.message);
    }
  }, [user]);

  // ── Store a confirmation (user said Claude was right) ──
  const storeConfirmation = useCallback(async (aiName, category, brand) => {
    try {
      const { error } = await supabase.rpc('upsert_confirmation', {
        p_ai_name: aiName,
        p_category: category || null,
        p_brand: brand || null,
      });
      if (error && DEV) console.warn('[Confirm] Store failed:', error.message);
      else if (DEV) console.log(`[Confirm] Stored confirmation for "${aiName}"`);
    } catch (e) {
      if (DEV) console.warn('[Confirm] Error:', e.message);
    }
  }, []);

  // ── Internal: call /api/analyze with retry + timeout ──
  // Perf: maxRetries=0 by default — no auto-retry on first scan (user can manually retry)
  // Timeout reduced 35→25s — if API hasn't responded by then, it won't
  const analyzeWithRetry = useCallback(async (compressedDataUrlOrArray, pipelineSignal, maxRetries = 0, refineModel = null, corrections = []) => {
    // Support both single image (string) and multiple images (array)
    const imageArray = Array.isArray(compressedDataUrlOrArray)
      ? compressedDataUrlOrArray
      : [compressedDataUrlOrArray];
    const base64Array = imageArray.map(img => img.split(',')[1]);
    let lastError;

    // Perf: log payload size
    if (DEV) {
      const totalKB = Math.round(base64Array.reduce((sum, b) => sum + b.length, 0) * 0.75 / 1024);
      console.log(`[Analyze] Payload: ${base64Array.length} image(s), ~${totalKB}KB total`);
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Check if user cancelled before each attempt
      if (pipelineSignal.aborted) throw new DOMException('Cancelled', 'AbortError');

      // Exponential backoff between retries (300ms, 900ms)
      if (attempt > 0) {
        const delay = 300 * Math.pow(3, attempt - 1);
        if (DEV) console.log(`[Analyze] Retry #${attempt} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        if (pipelineSignal.aborted) throw new DOMException('Cancelled', 'AbortError');
      }

      // Create a per-attempt controller that aborts on timeout OR user cancel.
      //
      // VAL-001 (D7) — INVARIANT:
      //   client_abort > BUDGET_MS + tail_reserve + cold_start_allowance
      //
      // The client clock starts BEFORE the server's: it includes request upload
      // and a possible function cold start. So an abort set equal to the
      // server's budget fires while the server is still writing its response —
      // paid Sonnet work is thrown away and, because an abort is not a
      // retryable status, it is not re-requested either.
      // Server BUDGET_MS is 50s (it was 45s when the old 50000 was chosen; the
      // comment here was never updated, which is how the margin reached zero).
      // 58s leaves ~8s for the persistence tail, upload and cold start.
      // Raising BUDGET_MS requires raising this in the same change.
      const attemptCtrl = new AbortController();
      const timeoutId = setTimeout(() => attemptCtrl.abort(), 58000);
      const onPipelineAbort = () => { clearTimeout(timeoutId); attemptCtrl.abort(); };
      pipelineSignal.addEventListener('abort', onPipelineAbort);

      const t0 = performance.now();
      try {
        // Send images[] array for multi-photo, imageData for single (backward compat)
        const body = base64Array.length > 1
          ? { images: base64Array, lang, corrections }
          : { imageData: base64Array[0], lang, corrections };
        // GW-000: correlate the whole scan lifecycle server-side.
        if (currentScanUuidRef.current) body.scan_uuid = currentScanUuidRef.current;
        if (refineModel) {
          body.refineModel = refineModel;
          console.log(`[Analyze correction] Sending refineModel="${refineModel}" to backend`);
        }

        // AUTH-001: never send an unauthenticated scan.
        //
        // This used to attach the header only `if (_accessToken)` and send the
        // request regardless — so a null token produced a POST with NO
        // Authorization header, a guaranteed 401 that burned a round trip and
        // surfaced as a generic failure. /api/analyze requires auth by design;
        // a request we already know cannot succeed should never leave the
        // client. Throwing here converts a silent 401 into a typed, recoverable
        // auth error that the pipeline's catch turns into a sign-in prompt.
        const _accessToken = await getFreshToken();
        if (!_accessToken) {
          // Booleans only — never the token, never the user id.
          console.warn('[Analyze] blocked: no access token at request time (session absent or refresh failed)');
          const authErr = new Error(lang === 'he' ? 'יש להתחבר כדי לסרוק' : 'Sign in required to scan');
          authErr.authRequired = true;
          throw authErr;
        }
        const analyzeHeaders = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${_accessToken}`,
        };

        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: analyzeHeaders,
          body: JSON.stringify(body),
          signal: attemptCtrl.signal,
        });
        clearTimeout(timeoutId);
        pipelineSignal.removeEventListener('abort', onPipelineAbort);

        if (DEV) console.log(`[Analyze] Attempt ${attempt + 1}: HTTP ${res.status} in ${(performance.now() - t0).toFixed(0)}ms`);

        if (!res.ok) {
          // Rate limited — parse structured body, surface a friendly message,
          // and carry retryAfter so the pipeline can start a cooldown.
          if (res.status === 429) {
            let errBody = {};
            try { errBody = await res.json(); } catch {}
            const secs = errBody.retryAfterSeconds
              || parseInt(res.headers.get('Retry-After') || '0', 10)
              || 30;
            const msg = errBody.message || (errBody.limitType === 'user_daily'
              ? (lang === 'he' ? 'הגעת למכסת הסריקות היומית. נסה שוב מחר.' : 'Daily scan limit reached. Try again tomorrow.')
              : (lang === 'he' ? 'יותר מדי סריקות. המתן רגע ונסה שוב.' : 'Too many scans. Please wait a moment and try again.'));
            const rlErr = new Error(msg);
            rlErr.rateLimited = true;
            rlErr.retryAfter = secs;
            rlErr.limitType = errBody.limitType || 'rate';
            throw rlErr; // not retried here (maxRetries=0) — handled in runPipeline
          }
          if (res.status === 401) {
            let errBody = {};
            try { errBody = await res.json(); } catch {}
            const msg = errBody.code === 'SESSION_EXPIRED'
              ? (lang === 'he' ? 'פג תוקף החיבור — התחבר מחדש' : 'Session expired — please sign in again')
              : (lang === 'he' ? 'יש להתחבר כדי לסרוק' : 'Sign in required to scan');
            // AUTH-001: tagged so runPipeline can leave the scanning state AND
            // offer sign-in, rather than showing a dead-end error. A 401 the
            // client could not predict (token accepted locally, rejected by the
            // server) lands here; the pre-flight check above catches the rest.
            const authErr = new Error(msg);
            authErr.authRequired = true;
            authErr.sessionExpired = errBody.code === 'SESSION_EXPIRED';
            throw authErr;
          }
          // Parse error body for retryable server errors
          if (res.status >= 500) {
            let errBody = {};
            try { errBody = await res.json(); } catch {}
            // Stage 1 timeout — explicit retry message, not a generic "server error"
            if (errBody.code === 'STAGE1_TIMEOUT' || errBody.retryable) {
              const msg = errBody.error
                || (lang === 'he' ? 'הזיהוי נכשל — אנא נסה שוב' : 'Recognition timed out — please try again');
              const retryErr = new Error(msg);
              retryErr.retryable = true;
              retryErr.code = errBody.code || 'SERVER_ERROR';
              if (attempt < maxRetries) { lastError = retryErr; continue; }
              throw retryErr;
            }
            if (attempt < maxRetries) {
              lastError = new Error(`Server error (${res.status})`);
              continue;
            }
          }
          throw new Error(lang === 'he' ? `שגיאת שרת (${res.status})` : `Server error (${res.status})`);
        }

        const data = await res.json();
        if (data.content?.[0]?.text) {
          try {
            const parsed = JSON.parse(data.content[0].text.replace(/```json\n?|\n?```/g, '').trim());
            if (DEV) console.log(`[Analyze] Success:`, parsed.name || parsed.nameHebrew);
            return parsed;
          } catch (parseErr) {
            if (DEV) console.error('[Analyze] JSON parse error:', parseErr, data.content[0].text);
            throw new Error(lang === 'he' ? 'תגובה לא תקינה מהשרת' : 'Invalid response from server');
          }
        }
        throw new Error(lang === 'he' ? 'תגובה לא תקינה מהשרת' : 'Invalid response from server');
      } catch (e) {
        clearTimeout(timeoutId);
        pipelineSignal.removeEventListener('abort', onPipelineAbort);
        lastError = e;

        // User cancelled — stop immediately
        if (pipelineSignal.aborted) throw new DOMException('Cancelled', 'AbortError');

        // Timeout — retryable
        if (e.name === 'AbortError') {
          if (attempt === maxRetries) {
            throw new Error(lang === 'he' ? 'הזמן הקצוב פג, נסה שוב' : 'Request timed out, please try again');
          }
          continue;
        }

        // Network error — retryable
        if (e.message === 'Failed to fetch' && attempt < maxRetries) continue;

        // Non-retryable error on last attempt
        if (attempt === maxRetries) throw e;
        if (DEV) console.warn(`[Analyze] Attempt ${attempt + 1} failed:`, e.message);
      }
    }
    throw lastError;
  }, [lang, getFreshToken]);

  // ── GW-000: BACKUP valuation writer (recovery path, NOT primary) ──
  // The server (record_scan) is authoritative and persists every scan. This runs
  // ONLY when the server reports persistence failed (aiResult.persisted === false).
  // It upserts on the server-decided valuation_id, so it can never duplicate the
  // row even if the server later succeeds. Retried; failures are reported.
  const backupValuation = useCallback(async (aiResult, maxAttempts = 2) => {
    if (!user || !aiResult?.valuation_id) return null;
    // UI-003 Wave 0 — mirrors the server's record_scan row (api/analyze.js).
    // This writer upserts the SAME row id, so it must persist the same
    // semantics: an unpriced scan is stored as unpriced, never as a ₪0
    // ai_estimate. See hasRealPrice / isPricedMarketValue.
    const priced = hasRealPrice(aiResult.marketValue);
    const row = {
      id: aiResult.valuation_id,                 // server-decided → idempotent
      user_id: user.id,
      scan_uuid: aiResult.scan_uuid || null,
      valuation_version: aiResult.valuation_version ?? 1,
      ai_name: aiResult.name || 'Unknown',
      ai_name_hebrew: aiResult.nameHebrew || '',
      ai_category: aiResult.category || 'Other',
      ai_confidence: aiResult.confidence || 0,
      ai_raw_response: aiResult,
      ocr_text: aiResult.recognition?.ocrText || null,
      model_number: aiResult.recognition?.modelNumber || null,
      identified_by: aiResult.recognition?.identifiedBy || 'visual',
      alternatives: aiResult.recognition?.alternatives || [],
      // NULL, not 0: zero is not a price. A 0 here is indistinguishable from an
      // item genuinely worth nothing, renders as a ₪0 valuation in history
      // (AuthProfileView gates on price_mid > 0), and drags every aggregate over
      // the column toward zero — NULL is skipped by SQL aggregates and is the
      // honest "we do not know".
      price_low: priced ? aiResult.marketValue.low : null,
      price_mid: priced ? aiResult.marketValue.mid : null,
      price_high: priced ? aiResult.marketValue.high : null,
      // Gap B: identical normalization to the server row (api/analyze.js). Both
      // writers upsert the SAME row id, so a disagreement here about whether 0
      // means "free" or "unknown" would be resolved by whichever lands first.
      new_retail: positivePriceOrNull(aiResult.marketValue?.newRetailPrice),
      // The manual-pricing state is an EXPLICIT marker in the row, not the
      // absence of a price. The server already sets this on marketValue; the
      // fallback covers a response from an older deploy.
      price_method: priced
        ? (aiResult.marketValue?.price_method || 'ai_estimate')
        : 'manual_required',
      comp_count: aiResult._pipeline?.db_matches ?? null,
      lang,
    };
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // ignoreDuplicates: if the server row already exists, do nothing (no UPDATE
        // policy needed) — the RLS insert check (user_id = auth.uid()) still applies.
        const { error } = await supabase
          .from('valuations')
          .upsert(row, { onConflict: 'id', ignoreDuplicates: true });
        if (error) throw error;
        if (DEV) console.log('[Valuation] Backup upsert ok:', row.id);
        return row.id;
      } catch (e) {
        if (attempt === maxAttempts) {
          console.warn('[Valuation] Backup failed:', e.message);
          reportError(e, { scan_uuid: row.scan_uuid, stage: 'client_backup', valuation_id: row.id });
          return null;
        }
        await new Promise(r => setTimeout(r, 200 * attempt));
      }
    }
    return null;
  }, [user, lang]);

  // ── Load user's valuation history ──
  const loadValuations = useCallback(async () => {
    if (!user) return;
    const ownerId = user.id;
    setValuationsLoading(true);
    try {
      const { data, error } = await supabase
        .from('valuations')
        .select('id, ai_name, ai_name_hebrew, ai_category, ai_confidence, price_mid, price_method, user_confirmed, user_correction, created_at')
        .eq('user_id', ownerId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      if (currentUserIdRef.current !== ownerId) return; // FRONTEND-004 ownership
      setValuations(data || []);
    } catch (e) {
      if (DEV) console.warn('[Valuations] Load error:', e.message);
    } finally {
      setValuationsLoading(false);
    }
  }, [user]);

  // ── Delete a single valuation ──
  const deleteValuation = useCallback(async (id) => {
    if (!user || !id) return;
    try {
      const { error } = await supabase.from('valuations').delete().eq('id', id).eq('user_id', user.id);
      if (error) throw error;
      setValuations(prev => prev.filter(v => v.id !== id));
      showToastMsg(lang === 'he' ? 'הסריקה נמחקה' : 'Scan deleted');
    } catch (e) {
      if (DEV) console.warn('[Valuation] Delete error:', e.message);
      showToastMsg(lang === 'he' ? 'שגיאה במחיקה' : 'Delete failed');
    }
  }, [user, lang, showToastMsg]);

  // ── Clear all valuations ──
  const clearAllValuations = useCallback(async () => {
    if (!user) return;
    try {
      const { error } = await supabase.from('valuations').delete().eq('user_id', user.id);
      if (error) throw error;
      setValuations([]);
      showToastMsg(lang === 'he' ? 'כל הסריקות נמחקו' : 'All scans cleared');
    } catch (e) {
      if (DEV) console.warn('[Valuations] Clear error:', e.message);
      showToastMsg(lang === 'he' ? 'שגיאה במחיקה' : 'Clear failed');
    }
  }, [user, lang, showToastMsg]);

  // ── Main pipeline: compress → analyze ──
  // appendMode: if true, appends new image to existing images[] and re-analyzes all
  const runPipeline = useCallback(async (rawDataUrl, appendMode = false) => {
    // ── In-flight guard — a scan is already running; ignore duplicate taps ──
    if (pipelineActiveRef.current) {
      if (DEV) console.log('[Pipeline] Ignored — a scan is already running');
      return;
    }
    // ── Cooldown guard — respect server rate-limit backoff ──
    if (Date.now() < scanCooldownUntilRef.current) {
      const secs = Math.ceil((scanCooldownUntilRef.current - Date.now()) / 1000);
      setPipelineState('analysis_error');
      setPipelineError(lang === 'he' ? `המתן ${secs} שניות לפני סריקה נוספת` : `Please wait ${secs}s before scanning again`);
      return;
    }

    // ── AUTH GUARD — /api/analyze requires a session; prove we have one ──────
    // Scanning was the ONLY user action without this check. Contact (:1229),
    // save (:1663) and list all gate on `if (!user)`; runPipeline did not, so a
    // tap while signed out — or before the session finished restoring — entered
    // the scanning state, compressed the image, and POSTed with no
    // Authorization header. The server answered 401 before Stage 1, which is
    // why no [Waterfall] line was ever emitted.
    //
    // The check is `await getFreshToken()`, NOT `if (!user)`, on purpose:
    //   - `user` is React state populated asynchronously by the auth bootstrap,
    //     so it is null during the window this bug lives in. Gating on it would
    //     still let a scan through a moment later with no token, and would
    //     reject a scan whose session is valid but whose state has not landed.
    //   - supabase.auth.getSession() resolves only AFTER the client has
    //     restored the persisted session, so awaiting it IS the
    //     "auth initialization complete" signal. No new global state needed.
    //   - It returns the very token the request will carry, so a pass here
    //     means the request cannot be headerless.
    //
    // Deliberately placed BEFORE pipelineActiveRef / any setPipelineState, so a
    // blocked scan never enters a loading state it has to be rescued from.
    const preflightToken = await getFreshToken();
    if (!preflightToken) {
      // Booleans only — no token, no user id.
      console.warn('[Pipeline] scan blocked: no valid session at scan time', {
        userStatePresent: !!currentUserIdRef.current,
        tokenPresent: false,
        at: new Date().toISOString(),
      });
      setPipelineState('idle');          // never a permanent "Scanning..."
      setPipelineError(null);
      setSignInAction('scan');
      setShowSignInModal(true);
      return;
    }

    pipelineActiveRef.current = true;

    // SCAN-2: snapshot BEFORE any state mutation — imagesBefore is what the
    // images array must be restored to for an append retry to reproduce the
    // exact same [previous..., appended] input instead of double-appending.
    lastAttemptRef.current = {
      image: rawDataUrl,
      appendMode,
      imagesBefore: imagesRef.current.slice(),
      ownerId: currentUserIdRef.current,
    };

    // GW-000: fresh scan → new lifecycle id; append → reuse the current one so
    // the whole multi-photo/refine lifecycle stays correlated under one scan_uuid.
    if (!appendMode || !currentScanUuidRef.current) {
      currentScanUuidRef.current =
        (globalThis.crypto?.randomUUID?.() || `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    }

    // Cancel any in-flight pipeline (defensive — guard above should prevent this)
    if (pipelineAbortRef.current) {
      pipelineAbortRef.current.abort();
    }
    const abortCtrl = new AbortController();
    pipelineAbortRef.current = abortCtrl;

    setPipelineError(null);
    const pipelineT0 = performance.now();

    try {
      // ── Step 1: Compress + fetch hints IN PARALLEL ──
      setPipelineState('compressing');

      // Perf: run compression and hints fetch concurrently
      const [compressed, hints] = await Promise.all([
        // 1280px / 0.82: matches new capture cap (1280px), single-pass compress preserves label text
        compressImage(rawDataUrl, 1280, 0.82),
        fetchRecognitionHints().catch(() => []),
      ]);

      const t1 = performance.now();
      if (DEV) console.log(`[Pipeline] Compress+hints: ${(t1 - pipelineT0).toFixed(0)}ms (append=${appendMode})`);

      // ── Build analysis input using ref (FIX: no setState trick) ──
      let analyzeInput;
      if (appendMode) {
        // Perf fix: read current images from ref, build array locally, then set state once
        const prev = imagesRef.current;
        const updated = [...prev, compressed].slice(-3); // keep last 3
        setImages(updated); // single state update
        analyzeInput = updated.length > 1 ? updated : compressed;
        if (DEV) console.log(`[Pipeline] Append mode: ${updated.length} image(s)`);
      } else {
        setImages([compressed]);
        analyzeInput = compressed;
      }

      if (abortCtrl.signal.aborted) return;

      // ── Step 2: Analyze (identifying) ──
      setPipelineState('identifying');

      // Perf: switch to pricing indicator after 2s (API does identify→price internally)
      const pricingTimer = setTimeout(() => setPipelineState('pricing'), 2000);

      const tApi = performance.now();
      const analysisResult = await analyzeWithRetry(analyzeInput, abortCtrl.signal, 0, null, hints);
      clearTimeout(pricingTimer);

      if (abortCtrl.signal.aborted) return;

      const t2 = performance.now();
      if (DEV) console.log(`[Pipeline] API: ${(t2 - tApi).toFixed(0)}ms | Total: ${(t2 - pipelineT0).toFixed(0)}ms`);

      // ── Success ──
      setPipelineState('success');
      setResult(analysisResult);
      setView('results');
      setAddPhotoMode(false);
      playSound('success');

      // Auto-open help modal for very low confidence
      if (analysisResult.confidence < 0.40 && !analysisResult.userConfirmed) {
        setHelpModalOpen(true);
      }

      // GW-000: server (record_scan) is authoritative and already persisted this
      // scan; analysisResult carries valuation_id / scan_uuid / persisted. Fire the
      // client backup ONLY if the server reported failure.
      if (analysisResult.persisted === false) {
        backupValuation(analysisResult).catch(err => { if (DEV) console.error('[Pipeline] backup failed:', err); });
      }

      // GW-005A: real user signal — a scan produced a valuation (ids + facts only).
      //
      // UI-003 Wave 0: `price_mid` is null (→ key omitted by cleanPayload) unless
      // the guard actually priced this scan. `price_method` carries the POSITIVE
      // manual_required marker in that case, exactly as the valuations row does
      // (backupValuation above, api/analyze.js normalizeForUI) — the unpriced
      // state is a marker in the payload, never merely the absence of one. It is
      // derived locally rather than trusted from the response, so a result cached
      // by a pre-fix deploy cannot reintroduce 'ai_estimate' over a 0 mid.
      recordObservation(OBS.VALUATION_COMPLETED, {
        category:     analysisResult.category,
        confidence:   analysisResult.confidence,
        price_mid:    observedPriceMid(analysisResult.marketValue),
        price_method: hasRealPrice(analysisResult.marketValue)
          ? (analysisResult.marketValue?.price_method || 'ai_estimate')
          : 'manual_required',
        comp_count:   analysisResult._pipeline?.db_matches,
        append:       appendMode,
        duration_ms:  Math.round(performance.now() - pipelineT0),
      }, { scanUuid: analysisResult.scan_uuid, valuationId: analysisResult.valuation_id });

      if (DEV) console.log(`[Pipeline] ✅ Done in ${(performance.now() - pipelineT0).toFixed(0)}ms`);

    } catch (e) {
      if (e.name === 'AbortError' || abortCtrl.signal.aborted) {
        if (DEV) console.log('[Pipeline] Cancelled');
        // AUTH-001: this early return left pipelineState wherever it was —
        // typically 'identifying' — so an abort that was NOT followed by a new
        // scan stranded the UI on "Scanning..." forever. clearUserState()
        // aborts the pipeline on every sign-in / sign-out / account switch, so
        // signing in mid-scan produced exactly the reported symptom.
        //
        // Only reset when THIS controller is still the active one. If a newer
        // scan replaced it, that run owns the state and has already set its
        // own — resetting here would race it back to idle.
        if (pipelineAbortRef.current === abortCtrl) {
          setPipelineState('idle');
          setPipelineError(null);
        }
        return;
      }

      // AUTH-001: an auth failure is recoverable — leave the scanning state and
      // offer sign-in instead of a dead-end error the user can only stare at.
      if (e.authRequired) {
        console.warn(`[Pipeline] scan failed auth (sessionExpired=${!!e.sessionExpired}) — prompting sign-in`);
        setPipelineState('idle');
        setPipelineError(null);
        setSignInAction('scan');
        setShowSignInModal(true);
        playSound('error');
        return;
      }

      // Rate limited — start a cooldown so scan/retry buttons disable until it passes.
      if (e.rateLimited) {
        const until = Date.now() + (e.retryAfter || 30) * 1000;
        scanCooldownUntilRef.current = until;
        setScanCooldownUntil(until);
        if (DEV) console.log(`[Pipeline] Rate limited — cooldown ${e.retryAfter}s (${e.limitType})`);
      }

      console.error('[Pipeline] Failed:', e);
      const failedAtCompress = !imagesRef.current.length || pipelineState === 'compressing';
      setPipelineState(failedAtCompress ? 'compress_error' : 'analysis_error');
      setPipelineError(e.message || (lang === 'he' ? 'שגיאה' : 'An error occurred'));
      playSound('error');
    } finally {
      // Always release the in-flight guard so legitimate retries can proceed.
      pipelineActiveRef.current = false;
    }
  }, [analyzeWithRetry, fetchRecognitionHints, backupValuation, playSound, lang, getFreshToken]);

  // ── Retry from the failed step — replays the EXACT last attempt (SCAN-2) ──
  const retryPipeline = useCallback(() => {
    const attempt = lastAttemptRef.current;
    if (!attempt?.image) return;
    // Block duplicate runs and respect cooldown (runPipeline re-checks too).
    if (pipelineActiveRef.current || Date.now() < scanCooldownUntilRef.current) return;
    // Ownership: never resend a signed-out user's images (FRONTEND-004).
    if (attempt.ownerId !== currentUserIdRef.current) return;
    // Restore the pre-attempt images array (ref synchronously — runPipeline
    // reads imagesRef before React re-renders) so an append retry reproduces
    // [previous..., appended] instead of appending the same photo twice.
    imagesRef.current = attempt.imagesBefore;
    setImages(attempt.imagesBefore);
    setView('analyzing');
    runPipeline(attempt.image, attempt.appendMode);
  }, [runPipeline]);

  // ── Cancel and go home ──
  const cancelPipeline = useCallback(() => {
    if (pipelineAbortRef.current) pipelineAbortRef.current.abort();
    lastAttemptRef.current = null; // SCAN-2: leaving the flow drops the retry snapshot
    setPipelineState('idle');
    setPipelineError(null);
    setAddPhotoMode(false);
    setHelpModalOpen(false);
    setView('home');
  }, []);

  // ── Camera release (MUST be before captureAdditionalPhoto to avoid TDZ crash) ──
  const cameraStartingRef = useRef(false);
  const releaseCamera = useCallback(() => {
    camLog(`releaseCamera called — hadStream=${!!cameraStreamRef.current} hadVideo=${!!videoRef.current}`);
    if (cameraStreamRef.current) {
      try {
        const vt = cameraStreamRef.current.getVideoTracks()[0];
        if (vt && typeof vt.applyConstraints === 'function') {
          vt.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
        }
      } catch {}
      cameraStreamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch {}
      });
      cameraStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      try { videoRef.current.srcObject = null; } catch {}
    }
    setTorchOn(false);
    setTorchSupported(false);
    cameraStartingRef.current = false;
  }, []);

  // ── Add another photo (multi-photo: append + re-analyze) ──
  const addPhoto = useCallback((source = 'camera') => {
    setAddPhotoMode(true);
    setHelpModalOpen(false);
    if (source === 'camera') {
      setView('camera');
    }
    // If source === 'file', the caller should trigger fileRef.current.click()
  }, []);

  // ── Handle the added photo from camera ──
  const captureAdditionalPhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      showToastMsg(lang === 'he' ? 'המצלמה עדיין נטענת' : 'Camera still loading');
      return;
    }

    playSound('shutter');
    setShowFlash(true);

    // Match main capture: cap at 1280px for OCR quality, 0.92 to preserve label text
    const ADD_CAP = 1280;
    const addScale = Math.min(1, ADD_CAP / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * addScale);
    canvas.height = Math.round(video.videoHeight * addScale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      const rawImg = canvas.toDataURL('image/jpeg', 0.92);
      if (rawImg && rawImg.length > 100) {
        setTimeout(() => {
          setShowFlash(false);
          setView('analyzing');
          releaseCamera();
          runPipeline(rawImg, true); // appendMode = true
        }, 50);
      } else {
        setShowFlash(false);
        showToastMsg(lang === 'he' ? 'שגיאה בצילום' : 'Capture failed');
      }
    } catch (e) {
      setShowFlash(false);
      showToastMsg(lang === 'he' ? 'שגיאה בצילום' : 'Capture error');
    }
  }, [runPipeline, playSound, releaseCamera, lang, showToastMsg]);

  // ── Handle added photo from file picker ──
  const handleAdditionalFile = useCallback((file) => {
    if (!file?.type.startsWith('image/')) return;
    playSound('tap');
    setView('analyzing');

    const reader = new FileReader();
    reader.onload = (e) => {
      runPipeline(e.target.result, true); // appendMode = true
    };
    reader.onerror = () => {
      setPipelineState('compress_error');
      setPipelineError(lang === 'he' ? 'שגיאה בקריאת הקובץ' : 'Failed to read file');
    };
    reader.readAsDataURL(file);
  }, [runPipeline, playSound, lang]);

  // ── SCAN-014 Phase 1.1A: universal identity confirmation (fire-and-forget) ──
  // Every explicit "this identification is correct" reaches Recognition Memory
  // through this endpoint, independent of the catalog-candidate flow. Only the
  // valuation_id is sent — the server derives brand/model/category from the
  // persisted valuation and the DB deduplicates retries, so this is safe to
  // call unconditionally and must never affect UX.
  const confirmIdentityRemote = useCallback(async (valuationId) => {
    if (!valuationId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return; // anonymous — server rejects anyway
      const res = await fetch('/api/confirm-identity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ valuation_id: valuationId }),
      });
      if (DEV) console.log('[ConfirmIdentity] status:', res.status);
    } catch (e) {
      if (DEV) console.warn('[ConfirmIdentity] failed:', e?.message);
      /* never throw — memory confirmation must not affect UX */
    }
  }, []);

  // ── Refine: re-analyze with a confirmed model name ──
  const refineResult = useCallback(async (modelName) => {
    if (!images[0]) return;
    try {
      setPipelineState('analyzing');
      setView('analyzing');

      const abortCtrl = new AbortController();
      if (pipelineAbortRef.current) pipelineAbortRef.current.abort();
      pipelineAbortRef.current = abortCtrl;

      const refined = await analyzeWithRetry(images[0], abortCtrl.signal, 0, modelName);

      if (abortCtrl.signal.aborted) return;

      // Mark as confirmed since user selected the model
      refined.userConfirmed = true;
      refined.needsConfirmation = false;

      setPipelineState('success');
      setResult(refined);
      setView('results');
      playSound('success');

      // Store correction on old valuation, create new one for refined result
      const oldValuationId = result?.valuation_id;
      const oldName = result?.name;
      if (oldValuationId) {
        supabase.from('valuations').update({ user_confirmed: false, user_correction: modelName })
          .eq('id', oldValuationId).then(() => {});
      }
      
      // ── LEARNING: Store correction pattern so future scans benefit ──
      if (oldName && oldName !== refined.name) {
        storeCorrection(
          oldName,                                    // what Claude said (wrong)
          refined.name,                               // what it actually is (right)
          result?.category || refined.category,       // category
          result?.details?.brand || refined.details?.brand, // brand
          result?.recognition?.ocrText,               // OCR text (visual cues)
          result?.recognition?.modelNumber,           // model number
          result?.confidence,                         // original confidence
          oldValuationId                              // link to valuation
        );
      }
      // GW-000: refine is the SAME lifecycle (scan_uuid reused); the server
      // persisted this refined valuation. Backup only on reported failure.
      if (refined.persisted === false) {
        backupValuation(refined).catch(() => {});
      }

      // GW-005A: real feedback signal — user corrected the identification.
      recordObservation(OBS.VALUATION_REFINED, {
        category:       refined.category,
        confidence:     refined.confidence,
        had_correction: Boolean(oldName && oldName !== refined.name),
        prior_confidence: result?.confidence,
      }, { scanUuid: refined.scan_uuid, valuationId: refined.valuation_id });

      // SCAN-014 Phase 1.1A: a correction IS a confirmation of the corrected
      // identity. Refined results set userConfirmed directly (confirmResult
      // never runs for them), so record the memory confirmation here — this
      // closes the audit's correction hole.
      confirmIdentityRemote(refined.valuation_id);

      if (DEV) console.log('[Refine] Complete:', refined.name);
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error('[Refine] Failed:', e);
      // Fall back to existing result instead of showing error
      setView('results');
      showToastMsg(lang === 'he' ? 'שגיאה בעדכון, מחירים מקוריים נשמרו' : 'Update failed, original prices kept');
    }
  }, [images, result, analyzeWithRetry, backupValuation, storeCorrection, playSound, lang, showToastMsg, confirmIdentityRemote]);

  // ── Confirm: user says the identification is correct ──
  const confirmResult = useCallback(() => {
    if (!result || result.userConfirmed) return; // idempotent — never double-record
    setResult(prev => ({ ...prev, userConfirmed: true, needsConfirmation: false }));
    playSound('tap');
    // Persist confirmation to valuations table
    if (result.valuation_id) {
      supabase.from('valuations').update({ user_confirmed: true, identified_by: 'user_confirmed' })
        .eq('id', result.valuation_id).then(() => {
          if (DEV) console.log('[Confirm] Stored in DB');
        });
    }
    // ── Insert into confirmations table for training / analytics ──
    const recognition = result.recognition || {};
    const identification = result.identification || {};
    const ocr = result.ocr || {};
    const confirmationRow = {
      valuation_id: result.valuation_id || null,
      detected_name: result.name || null,
      detected_brand: result.details?.brand || identification.brand || null,
      detected_model: recognition.modelNumber || identification.model || null,
      confidence: result.confidence || null,
      ocr_text: ocr.text_found?.join(', ') || recognition.ocrText || null,
      model_number: recognition.modelNumber || identification.model || null,
      user_id: user?.id || null,
    };
    if (result.product_id) confirmationRow.product_id = result.product_id;
    supabase.from('confirmations').insert(confirmationRow).then(({ error }) => {
      if (DEV) console.log('[Confirm] confirmations insert', error || 'ok');
    });
    // ── LEARNING: Store positive confirmation so we know Claude got it right ──
    storeConfirmation(
      result.name,
      result.category,
      result.details?.brand
    );

    // GW-005A: real feedback signal — user confirmed the identification was right.
    //
    // UI-003 Wave 0: this is the THIRD AI-price sink, found while fixing the two
    // named in the Phase A report. A confirmation is the strongest human signal
    // the system collects, so a ₪0 recorded here would be the most trustworthy-
    // looking bad price in the table. The identity confirmation is the point of
    // the event and survives with no price attached.
    recordObservation(OBS.VALUATION_CONFIRMED, {
      category:   result.category,
      confidence: result.confidence,
      price_mid:  observedPriceMid(result.marketValue),
      ai_priced:  hasRealPrice(result.marketValue),
    }, { scanUuid: result.scan_uuid, valuationId: result.valuation_id });

    if (DEV) console.log('[Confirm] User confirmed:', result.name);

    // ── SCAN-014 Phase 1.1A: RECOGNITION MEMORY — unconditional, BEFORE the
    // catalog branch. Fires on every explicit confirmation regardless of
    // whether the item is new to the catalog (submit-candidate is now
    // catalog-only and never writes memory).
    confirmIdentityRemote(result.valuation_id);

    // ── PRODUCT CANDIDATE: save to staging table if item was not in DB ──
    if (result.product_candidate_needed && !result.candidateSaved && result.candidate_payload) {
      saveProductCandidate(result.candidate_payload, null, result.valuation_id).then(() => {
        setResult(prev => prev ? { ...prev, candidateSaved: true } : prev);
      });
    }
  }, [result, user, playSound, storeConfirmation, confirmIdentityRemote]); // saveProductCandidate added below — safe: stable ref

  // ── Save product candidate to staging table (fire-and-forget, safe to retry) ──
  const saveProductCandidate = useCallback(async (candidatePayload, correctionText, valuationId) => {
    if (!candidatePayload) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const res = await fetch('/api/submit-candidate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          candidate:       candidatePayload,
          valuation_id:    valuationId || null,
          correction_text: correctionText || null,
        }),
      });
      const data = await res.json();
      if (DEV) console.log('[Candidate] Saved:', data.status, data.candidate_id);
      if (res.ok) {
        showToastMsg(
          lang === 'he'
            ? 'תודה — זה עוזר לשפר סריקות עתידיות!'
            : 'Thanks — this helps improve future scans!',
          'success'
        );
      }
    } catch (err) {
      if (DEV) console.warn('[Candidate] Save failed:', err.message);
    }
  }, [lang, showToastMsg]);

  // ── Correct: user types the correct model manually ──
  const correctResult = useCallback(async (userInput) => {
    if (!userInput?.trim()) return;
    await refineResult(userInput.trim());
  }, [refineResult]);

  // ── Submit brand hint from help modal (text input) ──
  const submitBrandHint = useCallback(async (brandText) => {
    if (!brandText?.trim() || !images[0]) return;
    await refineResult(brandText.trim());
    setHelpModalOpen(false);
  }, [images, refineResult]);

  // ── handleFile: user picks image from gallery ──
  const handleFile = useCallback((file) => {
    if (!file?.type.startsWith('image/')) return;
    // In-flight / cooldown guard — avoid duplicate scans (runPipeline re-checks too).
    if (pipelineActiveRef.current || Date.now() < scanCooldownUntilRef.current) return;
    playSound('tap');
    setView('analyzing');

    const reader = new FileReader();
    reader.onload = (e) => {
      const rawData = e.target.result;
      capturedImageRef.current = rawData;
      if (addPhotoMode) {
        // Multi-photo: append and re-analyze
        runPipeline(rawData, true);
      } else {
        // Normal: single image scan
        setImages([rawData]); // Show original while compressing
        runPipeline(rawData);
      }
    };
    reader.onerror = () => {
      setPipelineState('compress_error');
      setPipelineError(lang === 'he' ? 'שגיאה בקריאת הקובץ' : 'Failed to read file');
    };
    reader.readAsDataURL(file);
  }, [runPipeline, playSound, lang, addPhotoMode]);

  // ═══════════════════════════════════════════════════════
  // CAMERA + TORCH (releaseCamera moved above for TDZ safety)
  // ═══════════════════════════════════════════════════════

  // Detect torch capability on the current video track
  const detectTorch = useCallback((stream) => {
    try {
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) { setTorchSupported(false); return; }
      if (typeof videoTrack.getCapabilities === 'function') {
        const caps = videoTrack.getCapabilities();
        const hasTorch = !!(caps.torch);
        setTorchSupported(hasTorch);
        if (DEV) console.log(`[Camera] Torch supported: ${hasTorch}`);
      } else {
        setTorchSupported(false);
      }
    } catch {
      setTorchSupported(false);
    }
    setTorchOn(false);
  }, []);

  const toggleTorch = useCallback(async () => {
    if (!cameraStreamRef.current) return;
    const videoTrack = cameraStreamRef.current.getVideoTracks()[0];
    if (!videoTrack) return;
    const next = !torchOn;
    try {
      await videoTrack.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
      if (DEV) console.log(`[Camera] Torch ${next ? 'ON' : 'OFF'}`);
    } catch (e) {
      console.warn('Torch toggle failed:', e.message);
      setTorchSupported(false);
      setTorchOn(false);
    }
  }, [torchOn]);

  // ── Attach stream to video element using loadedmetadata (reliable on iOS) ──
  const attachStreamToVideo = useCallback((stream) => {
    return new Promise((resolve) => {
      let resolved = false;
      const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };

      const video = videoRef.current;
      camLog(`attachStreamToVideo — video=${!!video} stream=${!!stream} tracks=${stream?.getVideoTracks().length}`);
      if (!video) { camLog('attachStreamToVideo ABORT: no video element'); done(false); return; }

      camLog(`video el: readyState=${video.readyState} srcObject=${!!video.srcObject} w=${video.videoWidth}`);
      video.onloadedmetadata = null;
      video.srcObject = stream;
      camLog('srcObject assigned');

      video.onloadedmetadata = () => {
        camLog(`onloadedmetadata fired — ${video.videoWidth}×${video.videoHeight}`);
        video.play()
          .then(() => {
            camLog(`play() success — ${video.videoWidth}×${video.videoHeight}`);
            done(true);
          })
          .catch((e) => {
            camLog(`play() FAILED: ${e.name} ${e.message}`);
            done(false);
          });
      };

      // Fallback: if metadata doesn't fire in 3s, force play
      setTimeout(() => {
        if (!resolved) {
          camLog(`3s fallback — forcing play, readyState=${video.readyState}`);
          video.play().catch((e) => camLog(`fallback play FAILED: ${e.message}`));
          done(true);
        }
      }, 3000);
    });
  }, []);

  // ── Wait for videoRef to be mounted (React may not have rendered yet) ──
  const waitForVideoElement = useCallback(() => {
    return new Promise((resolve) => {
      if (videoRef.current) { camLog('waitForVideo: already mounted'); resolve(true); return; }
      camLog('waitForVideo: polling...');
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        if (videoRef.current) { clearInterval(poll); camLog(`waitForVideo: found at attempt ${attempts}`); resolve(true); return; }
        if (attempts > 30) { clearInterval(poll); camLog('waitForVideo: TIMEOUT — video never mounted'); resolve(false); }
      }, 50);
    });
  }, []);

  // ── Start camera — single entry point, guarded against double calls ──
  const startCamera = useCallback(async () => {
    camLog(`startCamera called — alreadyStarting=${cameraStartingRef.current}`);
    if (cameraStartingRef.current) {
      camLog('startCamera: skipped (in progress)');
      return;
    }
    cameraStartingRef.current = true;

    try {
      releaseCamera();
      cameraStartingRef.current = true; // Re-set after releaseCamera clears it

      // Check permission (not supported on all browsers)
      if (navigator.permissions?.query) {
        try {
          const permResult = await navigator.permissions.query({ name: 'camera' });
          camLog(`permission state: ${permResult.state}`);
          if (permResult.state === 'denied') {
            setCameraBlocked(true);
            cameraStartingRef.current = false;
            return;
          }
        } catch (pe) { camLog(`permission query error: ${pe.message}`); }
      }

      // Try environment camera first, fallback to user
      let stream;
      try {
        camLog('getUserMedia(environment) calling...');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        camLog(`getUserMedia(environment) SUCCESS — tracks=${stream.getVideoTracks().length}`);
      } catch (envErr) {
        camLog(`getUserMedia(environment) failed: ${envErr.name} ${envErr.message} — trying user`);
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        camLog(`getUserMedia(user) SUCCESS — tracks=${stream.getVideoTracks().length}`);
      }

      const vt = stream.getVideoTracks()[0];
      camLog(`track: label=${vt?.label} readyState=${vt?.readyState} enabled=${vt?.enabled}`);

      cameraStreamRef.current = stream;
      cameraPermissionGranted.current = true;

      camLog('setView(camera)');
      setView('camera');

      const videoMounted = await waitForVideoElement();
      if (!videoMounted) {
        camLog('ABORT: video element never mounted');
        releaseCamera();
        cameraStartingRef.current = false;
        return;
      }

      if (!cameraStreamRef.current) {
        camLog('ABORT: stream released while waiting for video');
        cameraStartingRef.current = false;
        return;
      }

      await attachStreamToVideo(stream);
      detectTorch(stream);
      camLog('startCamera COMPLETE');

    } catch (err) {
      camLog(`startCamera ERROR: ${err.name} — ${err.message}`);
      releaseCamera();
      if (err.name === 'NotAllowedError' || err.name === 'NotFoundError') {
        cameraPermissionGranted.current = false;
        setCameraBlocked(true);
      } else {
        setError(lang === 'he' ? 'שגיאה בפתיחת המצלמה' : 'Failed to open camera');
      }
    }
    cameraStartingRef.current = false;
  }, [releaseCamera, attachStreamToVideo, waitForVideoElement, detectTorch, lang, setError]);

  // ── Auto-start camera when view transitions to 'camera' without a stream ──
  // Fixes: addPhoto('camera') sets view but doesn't acquire camera hardware
  useEffect(() => {
    camLog(`view changed to: ${view} — stream=${!!cameraStreamRef.current} starting=${cameraStartingRef.current}`);
    if (view === 'camera' && !cameraStreamRef.current && !cameraStartingRef.current) {
      camLog('auto-start: triggering startCamera()');
      startCamera();
    }
  }, [view, startCamera]);

  // ── Capture — waits for video readyState, validates frame ──
  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    // In-flight / cooldown guard — block double-capture & rate-limited re-scans.
    if (pipelineActiveRef.current || Date.now() < scanCooldownUntilRef.current) return;

    // Check video is actually producing frames
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      if (DEV) console.warn('[Camera] Capture aborted: video not ready', video.readyState, video.videoWidth);
      showToastMsg(lang === 'he' ? 'המצלמה עדיין נטענת, נסה שוב' : 'Camera still loading, try again');
      return;
    }

    if (DEV) console.log(`[Camera] Capture: ${video.videoWidth}×${video.videoHeight}`);
    const captureT0 = performance.now();

    playSound('shutter');
    setShowFlash(true);

    // Cap capture resolution at 1280px — enough for label/serial OCR while keeping payload sane.
    // Previously 800px; labels on electronics were too small (~30px wide) for reliable OCR.
    const MAX_CAP = 1280;
    const capScale = Math.min(1, MAX_CAP / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * capScale);
    canvas.height = Math.round(video.videoHeight * capScale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Try toBlob first (better), fallback to toDataURL
    const processCapture = (rawImg) => {
      if (!rawImg) {
        if (DEV) console.warn('[Camera] Capture produced empty image');
        setShowFlash(false);
        showToastMsg(lang === 'he' ? 'שגיאה בצילום, נסה שוב' : 'Capture failed, try again');
        return;
      }
      capturedImageRef.current = rawImg;
      if (DEV) console.log(`[Camera] Capture success (addPhoto=${addPhotoMode})`);
      setTimeout(() => {
        setShowFlash(false);
        if (addPhotoMode) {
          // Multi-photo: append and re-analyze, then exit addPhotoMode
          setAddPhotoMode(false);
          setView('analyzing');
          releaseCamera();
          runPipeline(rawImg, true);
        } else {
          // Normal: single image scan
          setImages([rawImg]);
          setView('analyzing');
          releaseCamera();
          runPipeline(rawImg);
        }
      }, 50);
    };

    // Use toDataURL (synchronous, reliable on all browsers)
    // 0.92 quality — preserves label/serial text for Claude Vision OCR
    try {
      const rawImg = canvas.toDataURL('image/jpeg', 0.92);
      if (rawImg && rawImg.length > 100) {
        processCapture(rawImg);
      } else {
        processCapture(null);
      }
    } catch (e) {
      console.error('[Camera] Canvas toDataURL failed:', e);
      setShowFlash(false);
      showToastMsg(lang === 'he' ? 'שגיאה בצילום' : 'Capture error');
    }
  }, [runPipeline, playSound, releaseCamera, lang, showToastMsg, addPhotoMode]);

  const stopCamera = useCallback(() => {
    camLog(`stopCamera called — addPhotoMode=${addPhotoMode}`);
    releaseCamera();
    if (addPhotoMode) {
      // Was adding a photo — go back to results, keep the existing scan
      setAddPhotoMode(false);
      setView('results');
    } else {
      // Normal cancel — go home
      setAddPhotoMode(false);
      setView('home');
    }
  }, [releaseCamera, addPhotoMode]);

  // Release camera when app goes to background (iOS Safari PWA)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && cameraStreamRef.current) {
        if (DEV) console.log('[Camera] App hidden — releasing camera');
        releaseCamera();
        setView(prev => {
          if (prev === 'camera') {
            setAddPhotoMode(false);
            return addPhotoMode ? 'results' : 'home';
          }
          return prev;
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [releaseCamera, addPhotoMode]);

  // Safety: release camera on provider unmount
  useEffect(() => {
    return () => {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => { try { t.stop(); } catch {} });
        cameraStreamRef.current = null;
      }
    };
  }, []);

  // ─── PUBLISH LISTING ───

  // ═══ FRONTEND-008 (Part B): unified listing-image ingestion ════════════
  // The ONE path for photos added to a listing draft from the device
  // ("Add More Images"). Applies the SAME canonical contract the scan
  // pipeline applies to its captures: JPEG via canvas, max dimension
  // 1280px, quality 0.82, re-encode skipped under 150KB raw
  // (compressImage). Scan images arrive in `images` already compressed by
  // runPipeline with identical settings, so after this every element of
  // `images` satisfies one contract and nothing oversized or raw can reach
  // publishListing. Order: results are appended in file-selection order in
  // a single state write (the previous per-file FileReader.onload appends
  // raced — completion order isn't selection order). Corrupt/unreadable
  // files are skipped with a toast, never thrown. Ownership: a logout or
  // account switch during the async read/compress must not write into the
  // next session's draft — same FRONTEND-004 gate as every long-running op.
  const addListingImages = useCallback(async (files) => {
    if (!user) return;
    const ownerId = user.id;
    const imageFiles = (files || []).filter(f => f?.type?.startsWith('image/'));
    if (!imageFiles.length) return;
    const MAX = 6;
    const available = MAX - imagesRef.current.length;
    if (imageFiles.length > available) {
      showToastMsg(
        available > 0
          ? (lang === 'he' ? `ניתן להוסיף עוד ${available} תמונות בלבד (מקסימום 6)` : `Only ${available} photo${available !== 1 ? 's' : ''} left (max 6)`)
          : (lang === 'he' ? 'הגעת למגבלת 6 תמונות' : 'Photo limit reached (max 6)'),
        'error',
      );
      if (available <= 0) return;
    }
    const results = await Promise.all(
      imageFiles.slice(0, available).map(async (file) => {
        try {
          const dataUrl = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = (ev) => res(ev.target.result);
            reader.onerror = () => rej(new Error('File read failed'));
            reader.readAsDataURL(file);
          });
          return await compressImage(dataUrl, 1280, 0.82);
        } catch (e) {
          if (DEV) console.warn('[AddImages] file skipped:', file?.name, e?.message);
          return null; // corrupt/unsupported — skipped, reported below
        }
      })
    );
    if (currentUserIdRef.current !== ownerId) return; // FRONTEND-004: never write into another session's draft
    const processed = results.filter(Boolean);
    const failed = results.length - processed.length;
    if (processed.length) {
      setImages(prev => [...prev, ...processed].slice(0, MAX));
    }
    if (failed > 0) {
      showToastMsg(
        lang === 'he'
          ? `${failed} ${failed === 1 ? 'תמונה לא נתמכת או פגומה' : 'תמונות לא נתמכות או פגומות'}`
          : `${failed} photo${failed !== 1 ? 's' : ''} couldn't be processed`,
        'error',
      );
    }
  }, [user, lang, showToastMsg]);

  // FRONTEND-007 (SELL-7): synchronous single-flight lock for publishListing.
  // `publishing` state disables the button only after a re-render — a second
  // tap in the same frame re-enters the function and double-inserts. The ref
  // flips synchronously before the first await and is released in the same
  // finally that releases `publishing`, which runs on every exit inside the
  // try: success, upload failure, DB failure, thrown exception, and the
  // FRONTEND-004b post-logout ownership returns.
  const publishLockRef = useRef(false);

  const publishListing = async () => {
    if (publishLockRef.current) return; // second tap: no upload, no insert, no toast
    if (!user) { setError(lang === 'he' ? 'יש להתחבר תחילה' : 'Please sign in first'); return; }
    if (!listingData.title || !listingData.price || !listingData.phone || !listingData.location) {
      setError(lang === 'he' ? 'נא למלא את כל השדות' : 'Please fill all fields'); return;
    }
    publishLockRef.current = true;
    setPublishing(true);
    setError(null);
    const ownerId = user.id; // FRONTEND-004b ownership
    // FRONTEND-008 (Part C): storage paths created by THIS attempt — the only
    // paths cleanup may ever touch. Pre-existing storage URLs pass through
    // the upload map without uploading, so they can never end up here.
    const uploadedPaths = [];
    // Best-effort, fire-and-forget removal of this attempt's uploads after a
    // DEFINITE failure. Never throws, never blocks, never masks the original
    // publish error; a failed removal is logged as cleanup debt (SELL-3
    // pattern). Callers must NOT invoke this when the insert outcome is
    // unknown (network loss) — the row may exist and reference these files.
    const cleanupUploads = (reason) => {
      if (!uploadedPaths.length) return;
      supabase.storage.from('listings').remove(uploadedPaths).then(({ error: rmErr }) => {
        if (rmErr) {
          console.warn('[Publish] upload cleanup failed (cleanup debt):', rmErr.message);
          reportError(rmErr, { stage: 'publish_upload_cleanup', reason, count: uploadedPaths.length });
        }
      }).catch(() => {});
    };
    try {
      const uploadTs = Date.now();
      const uploadResults = await Promise.all(
        images.map(async (img, i) => {
          if (!img || typeof img !== 'string' || img.length < 100) return null;
          if (!img.startsWith('data:')) {
            // Only allow URLs already in our own listings storage bucket
            const storagePrefix = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/listings/`;
            return img.startsWith(storagePrefix) ? img : null;
          }
          try {
            const response = await fetch(img);
            const blob = await response.blob();
            if (blob.size < 1000) {
              if (DEV) console.warn(`[Publish] Skipping image ${i}: too small (${blob.size} bytes)`);
              return null;
            }
            if (blob.size > 5 * 1024 * 1024) {
              if (DEV) console.warn(`[Publish] Skipping image ${i}: too large (${blob.size} bytes)`);
              return null;
            }
            // FRONTEND-008 (Part C): random suffix makes the path collision-safe
            // — with upsert:false, two attempts sharing a millisecond (e.g. a
            // fast retry) previously collided and failed the second upload.
            const fileName = `${user.id}/${uploadTs}-${i}-${Math.random().toString(36).slice(2, 8)}.jpg`;
            const { error: uploadError } = await supabase.storage.from('listings').upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
            if (uploadError) {
              if (DEV) console.warn(`[Publish] Upload failed for image ${i}:`, uploadError.message);
              return null;
            }
            uploadedPaths.push(fileName);
            const { data: { publicUrl } } = supabase.storage.from('listings').getPublicUrl(fileName);
            return publicUrl;
          } catch (err) {
            if (DEV) console.warn(`[Publish] Image ${i} processing error:`, err);
            return null;
          }
        })
      );
      if (currentUserIdRef.current !== ownerId) { // FRONTEND-004b (finally still releases `publishing`)
        cleanupUploads('logout_during_publish'); // orphans from a session that ended — best-effort
        return;
      }
      const imageUrls = uploadResults.filter(Boolean);
      // FRONTEND-008 (Part A): a listing row may contain ONLY durable Storage
      // URLs (fresh uploads or the storage-prefix passthrough above). The old
      // fallback silently inserted the raw local data: URLs when every upload
      // failed — multi-MB base64 in the row, images that exist on no server.
      // Now: no durable image, no listing. The thrown error is recoverable —
      // the draft (images/fields) is untouched, finally releases the locks,
      // and tapping Publish again retries the uploads from a known state.
      if (imageUrls.length === 0) {
        throw new Error(images.length === 0
          ? (lang === 'he' ? 'נדרשת תמונה אחת לפחות' : 'At least one image is required')
          : (lang === 'he' ? 'העלאת התמונות נכשלה. בדוק את החיבור ונסה שוב.' : 'Image upload failed. Check your connection and try again.'));
      }
      const VALID_CATEGORIES = ['Electronics', 'Furniture', 'Vehicles', 'Watches', 'Clothing', 'Sports', 'Beauty', 'Books', 'Toys', 'Home', 'Tools', 'Music', 'Food', 'Other'];
      const rawCategory = (result?.category || 'Other').trim();
      const normalizedCategory = VALID_CATEGORIES.includes(rawCategory) ? rawCategory : 'Other';
      const qualityScore = computeQualityScore({
        title: listingData.title, description: listingData.desc,
        images: imageUrls, condition, price: listingData.price,
        category: normalizedCategory,
      });
      const listingRow = {
        seller_id: user.id, title: listingData.title, title_hebrew: result?.nameHebrew || '',
        description: listingData.desc || '', category: normalizedCategory,
        condition, price: listingData.price, images: imageUrls,
        location: listingData.location, contact_phone: listingData.phone, status: 'active',
        quality_score: qualityScore,
        attributes: Object.keys(answers).length > 0 ? answers : {},
        // Link to valuation system
        ...(result?.valuation_id && { valuation_id: result.valuation_id }),
        ...(result?.confidence && { ai_confidence: result.confidence }),
        // Serial/IMEI verification data (masked for public, never full serial)
        ...(serialData?.serial && {
          serial_submitted: true,
          serial_verified: serialData.verified || false,
          serial_masked: serialData.masked || null,
          serial_type: serialData.type || 'serial',
        }),
      };
      const insertResult = await supabase.from('listings').insert(listingRow).select();
      if (currentUserIdRef.current !== ownerId) { // FRONTEND-004b
        // Cleanup only if the server DEFINITELY rejected the row (postgres
        // error code present). On success the row references these files; on
        // ambiguous network loss the row may exist — leave the files alone.
        if (insertResult.error?.code) cleanupUploads('logout_after_insert_rejected');
        return;
      }
      if (insertResult.error) {
        console.error('[Publish] Insert failed:', insertResult.error.message);
        // FRONTEND-008 (Part C): a definite server-side rejection (postgres
        // error code) means no row exists — remove this attempt's uploads.
        // A network-level failure has NO code and an unknowable outcome: the
        // insert may have committed with the response lost, so deleting the
        // files could break a live listing. Those files stay (bounded orphan
        // debt); the duplicate-retry question is the Part D idempotency item.
        if (insertResult.error.code) cleanupUploads('insert_rejected');
        throw insertResult.error;
      }

      // Link valuation → listing (back-reference for feedback loop)
      const newListingId = insertResult.data?.[0]?.id;
      if (newListingId && result?.valuation_id) {
        supabase.from('valuations').update({ listing_id: newListingId })
          .eq('id', result.valuation_id).then(() => {
            if (DEV) console.log('[Publish] Valuation linked to listing:', newListingId);
          });
      }

      // GW-005A: real pricing signal — seller published at a chosen price.
      recordObservation(OBS.LISTING_CREATED, {
        listing_id:     newListingId,
        category:       normalizedCategory,
        condition,
        price:          listingRow.price,       // seller's real chosen price
        // UI-003 Wave 0: the seller's `price` above is a REAL observed signal and
        // is untouched. `ai_price_mid` is the AI's estimate, and its whole purpose
        // is the accuracy delta (real − estimate) — so a rejected valuation
        // entering as 0 would not merely add a bad row, it would score the AI as
        // maximally wrong on an item it honestly declined to price. Omitted
        // instead, with `ai_priced` as the positive marker so a consumer can tell
        // "no valuation" (has_valuation:false) from "valuation, no price".
        ai_price_mid:   observedPriceMid(result?.marketValue),
        ai_priced:      hasRealPrice(result?.marketValue),
        quality_score:  qualityScore,
        has_valuation:  Boolean(result?.valuation_id),
        ai_confidence:  result?.confidence,
      }, { valuationId: result?.valuation_id });

      await loadUserData();
      await loadListings(true);
      setListingStep(3);
      showToastMsg(t.published);
      // FRONTEND-008 (Part A): partial-upload contract — the listing publishes
      // with the photos that made it to Storage (supplementary photos should
      // not sink a sale on a flaky mobile network), but never silently: the
      // seller is told how many were dropped and can edit/re-add later.
      const dropped = images.length - imageUrls.length;
      if (dropped > 0) {
        showToastMsg(
          lang === 'he'
            ? `${dropped} ${dropped === 1 ? 'תמונה לא הועלתה' : 'תמונות לא הועלו'} — המודעה פורסמה עם ${imageUrls.length}`
            : `${dropped} photo${dropped !== 1 ? 's' : ''} failed to upload — published with ${imageUrls.length}`,
          'error',
        );
      }
      playSound('coin');
    } catch (e) {
      if (currentUserIdRef.current !== ownerId) return; // FRONTEND-004b — no error banner post-logout
      console.error('Publish error:', e);
      setError(e.message || (lang === 'he' ? 'שגיאה בפרסום, נסה שוב' : 'Failed to publish. Please try again.'));
      playSound('error');
    } finally {
      publishLockRef.current = false;
      setPublishing(false);
    }
  };

  // ─── REPORT LISTING ───
  const reportListing = async (listingId, reason) => {
    if (!user) { setSignInAction('contact'); setShowSignInModal(true); return false; }
    if (!listingId || !reason) return false;
    const ownerId = user.id; // FRONTEND-004b ownership
    try {
      const { error: rptError } = await supabase.from('reports').insert({
        listing_id: listingId, reporter_id: user.id, reason,
      });
      if (currentUserIdRef.current !== ownerId) return false;
      if (rptError) throw rptError;
      showToastMsg(lang === 'he' ? 'הדיווח נשלח, תודה!' : 'Report submitted, thank you!');
      return true;
    } catch (e) {
      if (currentUserIdRef.current !== ownerId) return false;
      console.error('Report error:', e);
      setError(lang === 'he' ? 'שגיאה בדיווח' : 'Failed to submit report');
      return false;
    }
  };

  // ─── ORDERS / CHECKOUT ─────────────────────────────

  // Load all orders for current user (as buyer or seller)
  const loadOrders = useCallback(async (force = false) => {
    if (!user) return;
    if (!force && ordersLastLoadRef.current > 0 && (Date.now() - ordersLastLoadRef.current < 30000)) return;
    const ownerId = user.id; // FRONTEND-004 ownership — see loadUserData

    // Phase 1: serve from IDB cache instantly
    const cacheKey = `orders-${ownerId}`;
    const cached = await cacheGet(cacheKey);
    if (currentUserIdRef.current !== ownerId) return;
    if (cached?.length) {
      setOrders(cached);
    } else {
      setOrdersLoading(true);
    }

    // Phase 2: background network refresh
    // Uses get_user_orders() SECURITY DEFINER RPC — UNION-based query,
    // bypasses per-row RLS evaluation, guarantees index usage.
    const t0 = performance.now();
    try {
      const { data, error: err } = await supabase.rpc('get_user_orders');
      if (DEV) console.log(`[Orders] RPC took ${Math.round(performance.now() - t0)}ms`);
      if (err) throw err;
      if (currentUserIdRef.current !== ownerId) return; // FRONTEND-004 ownership

      const newOrders = data || [];
      if (DEV) console.log(`[Orders] Loaded ${newOrders.length} orders`);
      setOrders(newOrders);
      ordersLastLoadRef.current = Date.now();
      cacheSet(cacheKey, newOrders);

      setActiveOrder(prev => {
        if (!prev) return prev;
        const fresh = newOrders.find(o => o.id === prev.id);
        return fresh || prev;
      });
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      console.error(`[Orders] Load error after ${ms}ms — code:${e?.code} msg:${e?.message}`);
    }
    setOrdersLoading(false);
  }, [user]);

  // Fetch a single order by ID (with full joins) — used to keep OrderDetail stable.
  // Uses get_order_by_id() SECURITY DEFINER RPC — same performance benefits as
  // get_user_orders(); enforces caller-is-party check inside the function.
  const fetchOrderById = useCallback(async (orderId) => {
    if (!user || !orderId) return null;
    const t0 = performance.now();
    try {
      const { data, error } = await supabase.rpc('get_order_by_id', { p_order_id: orderId });
      if (DEV) console.log(`[Orders] fetchById took ${Math.round(performance.now() - t0)}ms`);
      if (error) throw error;
      // SETOF jsonb → array of 0–1 rows; return the first element or null
      return data?.[0] ?? null;
    } catch (e) {
      console.warn(`[Orders] fetchById error — code:${e?.code} msg:${e?.message}`);
      return null;
    }
  }, [user]);

  // Create a new order (buyer initiates)
  const createOrder = useCallback(async ({ listingId, sellerId, price, deliveryMethod, shippingAddress, buyerNote }) => {
    if (!user) { setSignInAction('buy'); setShowSignInModal(true); return null; }
    if (user.id === sellerId) {
      showToastMsg(lang === 'he' ? 'אי אפשר לקנות מעצמך' : "You can't buy your own listing");
      return null;
    }
    const ownerId = user.id; // FRONTEND-004b: no post-logout navigation to orderDetail
    try {
      const { data, error: err } = await supabase.rpc('create_order', {
        p_listing_id:       listingId,
        p_seller_id:        sellerId,
        p_price:            price,
        p_delivery_method:  deliveryMethod,
        p_shipping_address: shippingAddress || null,
        p_buyer_note:       buyerNote || null,
      });

      if (err) throw err;
      if (currentUserIdRef.current !== ownerId) return null; // FRONTEND-004b

      showToastMsg(lang === 'he' ? 'ההזמנה נשלחה למוכר!' : 'Order sent to seller!');
      playSound('coin');
      setShowCheckout(false);

      // GW-005A: real buyer-intent signal — purchase initiated at an actual price.
      recordObservation(OBS.ORDER_CREATED, {
        order_id:        data?.id,
        listing_id:      listingId,
        price,
        delivery_method: deliveryMethod,
      });

      // Fetch the full order with joins BEFORE navigating
      const fullOrder = await fetchOrderById(data.id);
      if (currentUserIdRef.current !== ownerId) return null; // FRONTEND-004b
      setActiveOrder(fullOrder || data);
      setActiveOrderId(data.id);
      setView('orderDetail');

      // Also refresh orders list in the background
      loadOrders(true);

      return data;
    } catch (e) {
      if (currentUserIdRef.current !== ownerId) return null; // FRONTEND-004b
      console.error('[Orders] Create error:', e);
      const msg = e?.message || (lang === 'he' ? 'שגיאה ביצירת הזמנה' : 'Failed to create order');
      showToastMsg(lang === 'he' ? `שגיאה: ${msg}` : `Error: ${msg}`);
      return null;
    }
  }, [user, lang, showToastMsg, playSound, loadOrders, fetchOrderById]);

  // Update order status via server-side RPC (validates transitions)
  // OPTIMISTIC: updates local state FIRST, then calls backend. Rolls back on error.
  const updateOrderStatus = useCallback(async (orderId, newStatus, meta = {}) => {
    if (!user || !orderId) return false;
    const ownerId = user.id; // FRONTEND-004b ownership

    // ── Step 1: Optimistic local update (instant UI feedback) ──
    const prevOrders = [...orders];
    const prevActiveOrder = activeOrder;

    const timestamps = {};
    const now = new Date().toISOString();
    if (newStatus === 'accepted') timestamps.accepted_at = now;
    if (newStatus === 'declined') timestamps.declined_at = now;
    if (newStatus === 'shipped' || newStatus === 'ready_pickup') timestamps.shipped_at = now;
    if (newStatus === 'delivered') { timestamps.delivered_at = now; timestamps.buyer_confirmed_at = now; }
    if (newStatus === 'completed') timestamps.completed_at = now;
    if (newStatus === 'cancelled') { timestamps.cancelled_at = now; timestamps.cancelled_by = user.id; }

    // Update orders list optimistically
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus, updated_at: now, ...timestamps } : o));
    // Update activeOrder optimistically
    setActiveOrder(prev => prev?.id === orderId ? { ...prev, status: newStatus, updated_at: now, ...timestamps } : prev);

    const statusLabels = {
      accepted: lang === 'he' ? 'ההזמנה אושרה!' : 'Order accepted!',
      declined: lang === 'he' ? 'ההזמנה נדחתה' : 'Order declined',
      shipped: lang === 'he' ? 'המוצר נשלח!' : 'Item shipped!',
      ready_pickup: lang === 'he' ? 'המוצר מוכן לאיסוף!' : 'Ready for pickup!',
      delivered: lang === 'he' ? 'המוצר התקבל!' : 'Item received!',
      completed: lang === 'he' ? 'העסקה הושלמה!' : 'Transaction complete!',
      cancelled: lang === 'he' ? 'ההזמנה בוטלה' : 'Order cancelled',
    };

    // ── Step 2: Backend call ──────────────────────────────────────────────────
    try {
      const { error: rpcErr } = await supabase.rpc('transition_order', {
        p_order_id:   orderId,
        p_new_status: newStatus,
        p_meta:       meta,
      });

      if (rpcErr) throw rpcErr;
      if (currentUserIdRef.current !== ownerId) return true; // FRONTEND-004b — committed server-side, no UI

      showToastMsg(statusLabels[newStatus] || (lang === 'he' ? 'עודכן' : 'Updated'));
      playSound(newStatus === 'completed' ? 'coin' : 'tap');

      // GW-005A: real marketplace outcome — an order changed state.
      recordObservation(OBS.ORDER_TRANSITIONED, {
        order_id:  orderId,
        to_status: newStatus,
      });

      // Background refresh (non-blocking) — realtime will also sync
      loadOrders(true).catch(() => {});
      return true;
    } catch (e) {
      // FRONTEND-004b: rolling back would restore the signed-out user's
      // orders array into the cleared/next session's state.
      if (currentUserIdRef.current !== ownerId) return false;
      // ── Step 3: ROLLBACK optimistic update on any error ──
      console.error('[Orders] Transition FAILED:', e);
      setOrders(prevOrders);
      setActiveOrder(prevActiveOrder);
      loadOrders(true).catch(() => {}); // re-sync from server
      showToastMsg(lang === 'he' ? `שגיאה: ${e.message || 'עדכון נכשל'}` : `Error: ${e.message || 'Update failed'}`);
      return false;
    }
  }, [user, lang, orders, activeOrder, showToastMsg, playSound, loadOrders]);

  const cancelOrder = useCallback(async (orderId, reason) => {
    if (!user || !orderId) return false;
    return updateOrderStatus(orderId, 'cancelled', reason ? { cancel_reason: reason } : {});
  }, [user, updateOrderStatus]);

  // View an order's detail
  const viewOrder = useCallback((order) => {
    setNavDirection('push');
    setActiveOrder(order);
    setActiveOrderId(order?.id || null);
    setView('orderDetail');
  }, []);

  // ─── REVIEWS & RATINGS ─────────────────────────────

  const [sellerReviews, setSellerReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [sellerReviewsError, setSellerReviewsError] = useState(false);
  const [sellerReviewsTotal, setSellerReviewsTotal] = useState(0);

  // FRONTEND-005 (PROF-1): reviews RECEIVED by the current user — the same
  // concept as profile.rating/review_count (reviews.seller_id = reviewed
  // party). AuthProfileView read these fields before they existed; now wired
  // to the same query shape loadSellerReviews uses for public profiles.
  const [myReviews, setMyReviews] = useState([]);
  const [myReviewsLoading, setMyReviewsLoading] = useState(false);
  const [myReviewsError, setMyReviewsError] = useState(false);
  const [myReviewsTotal, setMyReviewsTotal] = useState(0);

  const loadMyReviews = useCallback(async () => {
    if (!user) return;
    const ownerId = user.id; // FRONTEND-004 ownership pattern
    setMyReviewsLoading(true);
    setMyReviewsError(false);
    try {
      // FRONTEND-008C: authoritative path — base rows first, optional
      // enrichment after. The old profiles!reviewer_id embed 400'd in
      // production (no reviews→profiles FK exists).
      const { rows, total } = await fetchReviewsFor(ownerId, { limit: 30 });
      if (currentUserIdRef.current !== ownerId) return;
      setMyReviews(rows);
      setMyReviewsTotal(total);
    } catch (e) {
      if (currentUserIdRef.current !== ownerId) return;
      if (DEV) console.warn('[MyReviews] Load error:', e.message);
      setMyReviewsError(true); // view shows error+retry, never a false "no reviews"
    } finally {
      if (currentUserIdRef.current === ownerId) setMyReviewsLoading(false);
    }
  }, [user]);

  // Submit a review for a completed order (buyer rates seller, or seller rates buyer)
  // seller_id / reviewed_user_id is derived from the order in the DB — never trusted from the caller
  const submitReview = useCallback(async (orderId, listingId, rating, comment, reviewerRole = 'buyer') => {
    if (!user) return false;
    const ownerId = user.id; // FRONTEND-004b ownership
    try {
      // Fetch order to derive the reviewed party server-side and verify completion
      const { data: orderData, error: orderErr } = await supabase
        .from('orders')
        .select('seller_id, buyer_id, status')
        .eq('id', orderId)
        .single();
      if (currentUserIdRef.current !== ownerId) return false; // FRONTEND-004b
      if (orderErr || !orderData) {
        showToastMsg(lang === 'he' ? 'שגיאה: ההזמנה לא נמצאה' : 'Error: Order not found');
        return false;
      }
      if (orderData.status !== 'completed') {
        showToastMsg(lang === 'he' ? 'ניתן לדרג רק עסקאות שהושלמו' : 'Reviews require a completed order');
        return false;
      }
      // Buyer reviews the seller; seller reviews the buyer
      const reviewedUserId = reviewerRole === 'buyer' ? orderData.seller_id : orderData.buyer_id;

      // Check if already reviewed this order in this role
      const { data: existing } = await supabase
        .from('reviews')
        .select('id')
        .eq('order_id', orderId)
        .eq('reviewer_id', user.id)
        .eq('reviewer_role', reviewerRole)
        .limit(1);
      if (existing?.length > 0) {
        showToastMsg(lang === 'he' ? 'כבר הוספת ביקורת' : 'You already reviewed this order');
        return false;
      }

      const { error: err } = await supabase.from('reviews').insert({
        order_id: orderId,
        listing_id: listingId,
        reviewer_id: user.id,
        seller_id: reviewedUserId,
        rating,
        comment: comment?.trim() || null,
        reviewer_role: reviewerRole,
      });

      if (err) throw err;
      if (currentUserIdRef.current !== ownerId) return true; // FRONTEND-004b — committed, no UI

      // GW-005A: real trust signal — rating on a completed order (never the comment text).
      recordObservation(OBS.REVIEW_SUBMITTED, {
        order_id:      orderId,
        listing_id:    listingId,
        rating,
        reviewer_role: reviewerRole,
      });

      showToastMsg(lang === 'he' ? 'הביקורת נשלחה! תודה' : 'Review submitted! Thank you');
      playSound('coin');
      return true;
    } catch (e) {
      if (currentUserIdRef.current !== ownerId) return false; // FRONTEND-004b
      // Log full Supabase error for debugging
      console.error('[Reviews] Submit error:', e?.message, e?.code, e?.details, e?.hint);
      const isDuplicate = e.message?.includes('one_review_per_order')
        || e.message?.includes('one_review_per_order_role')
        || e.code === '23505'; // Postgres unique violation
      if (isDuplicate) {
        showToastMsg(lang === 'he' ? 'כבר הוספת ביקורת להזמנה זו' : 'You already reviewed this order');
      } else {
        // Show real error in toast (readable on mobile) instead of persistent banner
        const detail = e?.message || (lang === 'he' ? 'שגיאה לא ידועה' : 'Unknown error');
        showToastMsg(lang === 'he' ? `שגיאה בשליחת הביקורת: ${detail}` : `Review failed: ${detail}`, 'error');
      }
      return false;
    }
  }, [user, lang, showToastMsg, playSound]);

  // Load reviews RECEIVED by a viewed profile (public seller profile).
  // FRONTEND-008C: authoritative path (see lib/reviews.js). A failed base
  // query sets an ERROR state — never a false "No reviews yet". A stale
  // response (user already navigated to another seller) is discarded.
  const sellerReviewsReqRef = useRef(0);
  const loadSellerReviews = useCallback(async (sellerId) => {
    if (!sellerId) return;
    const req = ++sellerReviewsReqRef.current;
    setReviewsLoading(true);
    setSellerReviewsError(false);
    try {
      const { rows, total } = await fetchReviewsFor(sellerId, { limit: 20 });
      if (sellerReviewsReqRef.current !== req) return; // stale — newer request owns the state
      setSellerReviews(rows);
      setSellerReviewsTotal(total);
    } catch (e) {
      if (sellerReviewsReqRef.current !== req) return;
      console.error('[Reviews] Load error:', e);
      setSellerReviews([]);
      setSellerReviewsTotal(0);
      setSellerReviewsError(true);
    } finally {
      if (sellerReviewsReqRef.current === req) setReviewsLoading(false);
    }
  }, []);

  // ─── NAVIGATION ────────────────────────────────────

  const reset = () => {
    // Cancel any in-flight pipeline
    if (pipelineAbortRef.current) pipelineAbortRef.current.abort();
    lastAttemptRef.current = null; // SCAN-2: new scan session — drop the retry snapshot
    setNavDirection('pop');
    setPipelineState('idle');
    setPipelineError(null);
    setAddPhotoMode(false);
    setHelpModalOpen(false);
    setImages([]); setResult(null); setView('home'); setError(null); setCameraBlocked(false);
    setCondition(null); setListingStep(0); setSelected(null);
    setActiveChat(null); capturedImageRef.current = null;
    setSellerProfile(null); setSellerListings([]);
  };

  const goTab = useCallback((newTab) => {
    setNavDirection('tab');
    setTab(newTab);
    setSelected(null);
    setActiveChat(null);
    if (newTab === 'home') setView('home');
    else if (newTab === 'browse') setView('browse');
    else if (newTab === 'sell') { setView('myListings'); loadOrders(); }
    else if (newTab === 'saved') setView('saved');
    else if (newTab === 'messages') { setView('inbox'); loadConversations(); }
    else if (newTab === 'profile') { setView(user ? 'profile' : 'auth'); if (user) refreshProfile(); }
  }, [user, loadConversations, loadOrders, refreshProfile]);

  const viewItem = useCallback((item) => { setNavDirection('push'); setSelected(item); setView('detail'); }, []);

  const contactSeller = useCallback(() => {
    if (!user) { setSignInAction('contact'); setShowSignInModal(true); return; }
    setShowContact(true);
  }, [user]);

  // ═══ FRONTEND-007 (MKT-3): auth gate at the Buy tap ═══════════════════
  // The ONE authoritative gate for opening checkout. Signed out → no form is
  // ever shown; a listing-id-only intent is stored and sign-in is requested.
  // Signed in → the same seller/availability rules that guard the server RPC
  // are pre-checked here so the sheet can't open for an unbuyable listing.
  const openCheckout = useCallback((listing) => {
    if (!listing?.id || listing.id.toString().startsWith('s')) return; // sample/demo listings
    if (!user) {
      writePendingBuy(listing.id); // survives OAuth's full-page redirect (007A)
      setSignInAction('buy');
      setShowSignInModal(true);
      return;
    }
    if (listing.seller_id === user.id) {
      showToastMsg(lang === 'he' ? 'אי אפשר לקנות מעצמך' : "You can't buy your own listing");
      return;
    }
    if (listing.status && listing.status !== 'active') {
      showToastMsg(lang === 'he' ? 'הפריט כבר לא זמין' : 'This listing is no longer available');
      return;
    }
    setShowCheckout(true);
  }, [user, lang, showToastMsg]);

  // MKT-3: cancelling sign-in must drop the buy intent too — otherwise a
  // later, unrelated sign-in would teleport the user into an abandoned
  // checkout.
  const dismissSignInModal = useCallback(() => {
    setShowSignInModal(false);
    setSignInAction(null);
    clearPendingBuy(); // cancellation drops the persisted intent too (007A)
  }, []);

  // MKT-3: after sign-in, return the user to the listing whose Buy tap
  // prompted authentication. The listing and the buyer's existing orders are
  // RE-FETCHED — the pre-auth snapshot is never trusted — so availability,
  // self-buy and duplicate-order rules are evaluated against the CURRENT
  // user and CURRENT listing state. Checkout reopens only if every gate a
  // normal signed-in Buy tap passes also passes here; otherwise the user
  // simply lands on the listing. create_order remains the final authority.
  const resumeBuyIntent = async (listingId, forUserId) => {
    try {
      const [{ data: listing }, { data: existingOrders }] = await Promise.all([
        supabase.from('listings')
          .select('*, seller:profiles(id, full_name, avatar_url, badge, is_verified, rating, review_count, total_sales, created_at)')
          .eq('id', listingId).maybeSingle(),
        supabase.from('orders').select('id')
          .eq('listing_id', listingId).eq('buyer_id', forUserId)
          .not('status', 'in', '("cancelled","completed","declined")')
          .limit(1),
      ]);
      if (currentUserIdRef.current !== forUserId) return; // FRONTEND-004 ownership
      if (!listing) return;
      setNavDirection('push');
      setSelected(listing);
      setTab('browse');
      setView('detail');
      const canBuy = listing.status === 'active'
        && listing.seller_id !== forUserId
        && !(existingOrders?.length > 0);
      if (canBuy) setShowCheckout(true);
    } catch (e) {
      if (DEV) console.warn('[Checkout] Buy-intent resume failed:', e);
    }
  };

  // VAL-001: calcPrice returns null when there is no computable price
  // (manual_required, or a missing/invalid mid). The price field is a
  // controlled input, so null becomes '' — an EMPTY box the user fills in.
  // Never 0: publishListing already blocks on a falsy price, so an empty box
  // gates publishing instead of shipping a confident ₪0.
  const suggestPrice = (c) => {
    const p = calcPrice(result?.marketValue, c, answers, result?.category);
    return p == null ? '' : p;
  };

  const startListing = () => {
    if (!user) { setSignInAction('list'); setShowSignInModal(true); return; }
    // No condition chosen yet, so this is the server's mid as-is — the delta is
    // applied on the condition step, once, by selectCondition.
    // UI-003 Wave 0: same predicate as the display and the persistence writer —
    // a degraded valuation can never prefill a listing price.
    const mv = result?.marketValue;
    const opening = hasRealPrice(mv) ? Number(mv.mid) : '';
    setListingData({ title: result?.name || '', desc: '', price: opening, phone: '', location: '' });
    setCondition(null); setAnswers({}); setListingStep(0); setSerialData(null); setNavDirection('push'); setView('listing');
  };

  const selectCondition = (c) => {
    setCondition(c);
    setListingData((prev) => ({ ...prev, price: suggestPrice(c) }));
    // Show category-specific questions for used/poor; skip for new/likeNew
    setListingStep((c === 'used' || c === 'poor') ? 1 : 2);
  };

  // ── Serial/IMEI verification: OCR a label photo and extract serial ──
  const submitSerialPhoto = useCallback(async (dataUrl) => {
    // Guard: prevent duplicate calls while already processing
    if (!dataUrl || serialLoadingRef.current) return;
    const ownerId = currentUserIdRef.current; // FRONTEND-004b ownership
    serialLoadingRef.current = true;
    setSerialLoading(true);
    const t0 = performance.now();
    try {
      // Compress the serial label photo (small, high quality for OCR)
      const compressed = await compressImage(dataUrl, 1024, 0.80);
      const base64 = compressed.split(',')[1];
      if (DEV) console.log(`[Serial] Compress: ${(performance.now() - t0).toFixed(0)}ms`);

      // Use Claude to OCR the serial label
      const tApi = performance.now();
      const _serialToken = await getFreshToken();
      const serialHeaders = { 'Content-Type': 'application/json' };
      if (_serialToken) serialHeaders['Authorization'] = `Bearer ${_serialToken}`;
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: serialHeaders,
        body: JSON.stringify({
          imageData: base64,
          lang,
          serialOCR: true, // Signal to API to do OCR-only mode
        }),
      });

      let rawText = '';
      if (res.ok) {
        if (DEV) console.log(`[Serial] API: ${(performance.now() - tApi).toFixed(0)}ms`);
        const data = await res.json();
        rawText = data.ocrText || data.raw_texts?.[0] || '';
      }

      // FRONTEND-004b: never recreate a signed-out user's serial photo/state.
      if (currentUserIdRef.current !== ownerId) {
        serialLoadingRef.current = false; setSerialLoading(false); return;
      }
      // Extract serial/IMEI from OCR text
      const extracted = extractSerialFromOCR(rawText);
      if (extracted) {
        setSerialData({
          photo: compressed,
          rawText,
          serial: extracted.value,
          masked: maskSerial(extracted.value),
          verified: extracted.verified,
          type: extracted.type,
        });
        showToastMsg(lang === 'he' ? `${extracted.type === 'imei' ? 'IMEI' : 'מספר סידורי'} נמצא ✓` : `${extracted.type === 'imei' ? 'IMEI' : 'Serial'} found ✓`);
      } else {
        // Still store that user submitted the photo even if OCR couldn't extract
        setSerialData({
          photo: compressed,
          rawText,
          serial: null,
          masked: null,
          verified: false,
          type: 'submitted',
        });
        showToastMsg(lang === 'he' ? 'תמונה נשמרה (לא נמצא מספר סידורי)' : 'Photo saved (no serial found)');
      }
    } catch (e) {
      if (currentUserIdRef.current !== ownerId) {
        serialLoadingRef.current = false; setSerialLoading(false); return;
      }
      if (DEV) console.error('[Serial] OCR failed:', e);
      showToastMsg(lang === 'he' ? 'שגיאה בקריאת המספר הסידורי' : 'Failed to read serial number');
    }
    serialLoadingRef.current = false;
    setSerialLoading(false);
  }, [lang, showToastMsg]);

  const clearSerialData = useCallback(() => setSerialData(null), []);

  const submitSerialText = useCallback((serialNumber) => {
    if (!serialNumber?.trim()) return;
    const serial = serialNumber.trim().toUpperCase().replace(/[\s-]/g, '');
    const isImei = /^\d{15}$/.test(serial) && validateIMEI(serial);
    setSerialData({
      photo: null,
      rawText: serial,
      serial,
      masked: maskSerial(serial),
      verified: isImei || serial.length >= 8,
      type: isImei ? 'imei' : 'serial',
    });
    showToastMsg(lang === 'he' ? 'מספר סידורי נוסף ✓' : 'Serial number added ✓');
  }, [lang, showToastMsg]);

  // ─── URL SYNC (Phase 3A) ─────────────────────────────────────────────────
  // Bridges view/tab state to the browser History API.
  // Android back, browser back, and URL-based refresh all work via this hook.
  useUrlSync({
    view, setView, tab, setTab,
    selected, setSelected,
    activeChat, setActiveChat,
    activeOrder, setActiveOrder,
    stopCamera, cancelPipeline,
    // MKT-3: back-press dismissal of the sign-in modal is a cancellation —
    // it must drop the pending buy intent too. urlSync only ever calls this
    // to close the modal, so the dismisser is a safe drop-in.
    showSignInModal, setShowSignInModal: dismissSignInModal,
    showCheckout, setShowCheckout,
    showContact, setShowContact,
    showNotifications, setShowNotifications,
    user,
  });

  const value = {
    lang, setLang, t, rtl,
    user, profile, loading, authMode, setAuthMode, authForm, setAuthForm, authError, setAuthError, authLoading,
    signInGoogle, signInEmail, signOut, sendPasswordReset, updatePassword, passwordRecovery,
    uploadAvatar, avatarUploading, refreshProfile,
    requestVerification, verificationUploading,
    showSignInModal, setShowSignInModal, signInAction, setSignInAction, dismissSignInModal,
    tab, setTab, view, setView, goTab, reset,
    listings, myListings, savedIds, savedItems,
    hasMore, loadingMore, loadMoreListings, loadListings,
    toggleSave, deleteListing, updateListing, viewItem, contactSeller,
    selected, setSelected, showContact, setShowContact, heartAnim,
    sellerProfile, sellerListings, loadingSeller, viewSellerProfile,
    search, setSearch, category, setCategory,
    priceRange, setPriceRange, sort, setSort,
    filterCondition, setFilterCondition,
    showFilters, setShowFilters,
    images, setImages, addListingImages, result, setResult,
    listingStep, setListingStep, condition, setCondition,
    answers, setAnswers, listingData, setListingData,
    publishing, publishListing, startListing, selectCondition,
    reportListing,
    // Serial/IMEI verification
    serialData, serialLoading, submitSerialPhoto, clearSerialData, submitSerialText,
    // Orders / Checkout
    orders, activeOrder, setActiveOrder, activeOrderId, ordersLoading,
    showCheckout, setShowCheckout, openCheckout,
    loadOrders, createOrder, updateOrderStatus, cancelOrder, viewOrder, fetchOrderById,
    // Order notifications
    orderNotifications, notifUnreadCount, notifLoading, notifError,
    showNotifications, setShowNotifications,
    loadNotifications, markNotifRead, markAllNotifsRead,
    // Reviews
    sellerReviews, reviewsLoading, sellerReviewsError, sellerReviewsTotal, submitReview, loadSellerReviews,
    myReviews, myReviewsLoading, myReviewsError, myReviewsTotal, loadMyReviews,
    // Pipeline (replaces analyzeImage)
    handleFile, startCamera, capture, stopCamera, releaseCamera,
    pipelineState, pipelineError, retryPipeline, cancelPipeline, scanCooldownUntil,
    // Multi-photo + Help modal
    addPhoto, addPhotoMode, setAddPhotoMode,
    captureAdditionalPhoto, handleAdditionalFile, submitBrandHint,
    helpModalOpen, setHelpModalOpen,
    // Recognition refinement
    refineResult, confirmResult, correctResult, saveProductCandidate,
    valuations, valuationsLoading, loadValuations, deleteValuation, clearAllValuations,
    // Torch
    torchSupported, torchOn, toggleTorch,
    showFlash, capturedImageRef,
    conversations, conversationsLoading, activeChat, setActiveChat,
    messages, setMessages, messagesLoading, newMessage, setNewMessage,
    sendingMessage, sendMessage, sendChatImageMessage, unreadCount,
    loadMessages, startConversation, loadConversations,
    messagesEndRef,
    // Notification system
    msgNotification, openNotification, dismissNotification,
    error, setError, toasts, dismissToast, showToastMsg,
    soundEnabled, setSoundEnabled, playSound,
    fileRef, videoRef, canvasRef,
    cameraBlocked, setCameraBlocked,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}