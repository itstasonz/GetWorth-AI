import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import T from '../lib/translations';
import SoundEffects from '../lib/sounds';
import { sanitizeSearch, calcPrice, computeQualityScore, PAGE_SIZE } from '../lib/utils';

const AppContext = createContext(null);
const DEV = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};

// ═══════════════════════════════════════════════════════
// Image compression — run BEFORE sending to API
// Resizes to max 1800px, JPEG quality 0.85
// Modern browsers auto-handle EXIF orientation on canvas draw
// ═══════════════════════════════════════════════════════
function compressImage(dataUrl, maxDim = 1800, quality = 0.85) {
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
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        if (DEV) {
          const origKB = Math.round(dataUrl.length * 0.75 / 1024);
          const compKB = Math.round(compressed.length * 0.75 / 1024);
          console.log(`[Compress] ${img.naturalWidth}×${img.naturalHeight} → ${w}×${h} | ${origKB}KB → ${compKB}KB (${Math.round(compKB / origKB * 100)}%)`);
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
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('home');
  const [view, setView] = useState('home');
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

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
  const [result, setResult] = useState(null);
  const [listingStep, setListingStep] = useState(0);
  const [condition, setCondition] = useState(null);
  const [answers, setAnswers] = useState({});
  const [listingData, setListingData] = useState({ title: '', desc: '', price: 0, phone: '', location: '' });
  const [publishing, setPublishing] = useState(false);
  const capturedImageRef = useRef(null);
  const [showFlash, setShowFlash] = useState(false);

  // ─── Pipeline state machine ───
  // idle → compressing → analyzing → success
  // failure states: compress_error, analysis_error
  const [pipelineState, setPipelineState] = useState('idle');
  const [pipelineError, setPipelineError] = useState(null);
  const pipelineAbortRef = useRef(null);

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

  // In-app message notification banner
  const [msgNotification, setMsgNotification] = useState(null);

  // Seller profile state
  const [sellerProfile, setSellerProfile] = useState(null);
  const [sellerListings, setSellerListings] = useState([]);
  const [loadingSeller, setLoadingSeller] = useState(false);

  // Orders state
  const [orders, setOrders] = useState([]);
  const [activeOrder, setActiveOrder] = useState(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);

  // Sound
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Camera permission
  const cameraStreamRef = useRef(null);
  const cameraPermissionGranted = useRef(false);

  // Refs
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Profile cache for notification banners
  const profileCacheRef = useRef({});

  const t = T[lang];
  const rtl = lang === 'he';

  const playSound = useCallback((soundName) => {
    if (soundEnabled && SoundEffects[soundName]) {
      SoundEffects[soundName]();
    }
  }, [soundEnabled]);

  const showToastMsg = (msg) => setToast(msg);

  // ─── Helper: get profile with in-memory cache ───
  const getCachedProfile = async (userId) => {
    if (!userId) return null;
    if (profileCacheRef.current[userId]) return profileCacheRef.current[userId];
    const { data } = await supabase.from('profiles').select('id, full_name, avatar_url').eq('id', userId).single();
    if (data) profileCacheRef.current[userId] = data;
    return data;
  };

  // ─── INIT + AUTH LISTENER ────────────────────────────
  useEffect(() => {
    let mounted = true;
    const timeout = setTimeout(() => { if (mounted) setLoading(false); }, 1500);

    const init = async () => {
      try {
        const listingsPromise = supabase
          .from('listings')
          .select('*, seller:profiles(id, full_name, avatar_url, badge, is_verified, rating)')
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE);

        const { data: { session } } = await supabase.auth.getSession();

        if (mounted && session?.user) {
          setUser(session.user);
          supabase.from('profiles').select('*').eq('id', session.user.id).single()
            .then(({ data }) => { if (mounted && data) setProfile(data); })
            .catch(() => {});
        }

        const { data: listingsData } = await listingsPromise;
        if (mounted && listingsData) {
          setListings(listingsData);
          setHasMore(listingsData.length === PAGE_SIZE);
        }
      } catch (e) { console.log('Init error:', e); }
      if (mounted) setLoading(false);
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;
      if (session?.user) {
        setUser(session.user);
        supabase.from('profiles').select('*').eq('id', session.user.id).single()
          .then(({ data }) => { if (data) setProfile(data); })
          .catch(() => {});
      } else { setUser(null); setProfile(null); }
    });

    return () => { mounted = false; clearTimeout(timeout); subscription.unsubscribe(); };
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

  // Reload listings when filters change
  useEffect(() => {
    setListingsPage(0);
    setHasMore(true);
    loadListings(true);
  }, [category, filterCondition, debouncedPriceRange.min, debouncedPriceRange.max, debouncedSearch]);

  // Load user data when auth changes
  useEffect(() => {
    if (user) loadUserData();
    else { setMyListings([]); setSavedItems([]); setSavedIds(new Set()); setConversations([]); setUnreadCount(0); }
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
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`rt-msgs-${user.id}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const newMsg = payload.new;
          if (newMsg.sender_id === user.id) return;

          let isInThisChat = false;
          setActiveChat((current) => {
            if (current && newMsg.conversation_id === current.id) {
              isInThisChat = true;
              setMessages((prev) => {
                if (prev.some((m) => m.id === newMsg.id)) return prev;
                return [...prev, newMsg];
              });
              setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
              supabase.from('messages').update({ is_read: true }).eq('id', newMsg.id).then(() => {});
            }
            return current;
          });

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
                senderName, listingTitle, content: newMsg.content,
                conversationId: newMsg.conversation_id,
                listingImage: listing?.images?.[0] || null,
                isOffer: newMsg.is_offer, offerAmount: newMsg.offer_amount,
              });
              playSound('tap');
            } catch (err) {
              console.warn('Notification enrichment failed:', err);
              setMsgNotification({
                senderName: lang === 'he' ? 'הודעה חדשה' : 'New message',
                listingTitle: '', content: newMsg.content,
                conversationId: newMsg.conversation_id,
              });
            }
          }
          loadConversations();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          const updated = payload.new;
          setMessages((prev) => prev.map((m) => m.id === updated.id ? { ...m, ...updated } : m));
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') console.log('✅ Realtime connected for', user.id);
        else if (status === 'CHANNEL_ERROR') console.error('❌ Realtime channel error');
      });

    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  // Tap notification banner → open that conversation
  const openNotification = async (notification) => {
    if (!notification?.conversationId) return;
    setMsgNotification(null);
    const conv = conversations.find((c) => c.id === notification.conversationId);
    if (conv) {
      const otherUser = conv.buyer_id === user.id ? conv.seller : conv.buyer;
      setActiveChat({ ...conv, otherUser });
      loadMessages(conv.id);
      setView('chat');
      setTab('messages');
      return;
    }
    const { data } = await supabase
      .from('conversations')
      .select(`*, listing:listings(id, title, title_hebrew, price, images), buyer:profiles!conversations_buyer_id_fkey(id, full_name, avatar_url), seller:profiles!conversations_seller_id_fkey(id, full_name, avatar_url)`)
      .eq('id', notification.conversationId)
      .single();
    if (data) {
      const otherUser = data.buyer_id === user.id ? data.seller : data.buyer;
      setActiveChat({ ...data, otherUser });
      loadMessages(data.id);
      setView('chat');
      setTab('messages');
      loadConversations();
    }
  };

  const dismissNotification = () => setMsgNotification(null);

  // ─── DATA LOADING ───────────────────────────────────

  const loadListings = async (reset = false) => {
    const page = reset ? 0 : listingsPage;
    const offset = page * PAGE_SIZE;
    let query = supabase
      .from('listings')
      .select('*, seller:profiles(id, full_name, avatar_url, badge, is_verified, rating)')
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
    if (data) {
      if (reset || page === 0) { setListings(data); } else { setListings((prev) => [...prev, ...data]); }
      setHasMore(data.length === PAGE_SIZE);
    }
  };

  const loadMoreListings = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = listingsPage + 1;
    setListingsPage(nextPage);
    const offset = nextPage * PAGE_SIZE;
    let query = supabase
      .from('listings')
      .select('*, seller:profiles(id, full_name, avatar_url, badge, is_verified, rating)')
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
    if (data) {
      setListings((prev) => [...prev, ...data]);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  };

  const loadUserData = async () => {
    if (!user) return;
    const [{ data: myData }, { data: savedData }] = await Promise.all([
      supabase.from('listings').select('*').eq('seller_id', user.id).neq('status', 'deleted').order('created_at', { ascending: false }),
      supabase.from('saved_items').select('*, listing:listings(*, seller:profiles(id, full_name, badge))').eq('user_id', user.id)
    ]);
    if (myData) setMyListings(myData);
    if (savedData) {
      setSavedItems(savedData.map((s) => s.listing).filter(Boolean));
      setSavedIds(new Set(savedData.map((s) => s.listing_id)));
    }
    loadConversations();
  };

  // ─── SELLER PROFILE ──────────────────────────────────
  const viewSellerProfile = async (sellerId) => {
    if (!sellerId) return;
    setLoadingSeller(true);
    setView('sellerProfile');
    const [{ data: profileData }, { data: listingsData }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', sellerId).single(),
      supabase.from('listings')
        .select('*, seller:profiles(id, full_name, avatar_url, badge, is_verified, rating)')
        .eq('seller_id', sellerId).eq('status', 'active')
        .order('created_at', { ascending: false })
    ]);
    if (profileData) setSellerProfile(profileData);
    if (listingsData) setSellerListings(listingsData);
    setLoadingSeller(false);
  };

  // ─── CHAT ───────────────────────────────────────────

  const loadConversations = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('conversations')
      .select(`*, listing:listings(id, title, title_hebrew, price, images), buyer:profiles!conversations_buyer_id_fkey(id, full_name, avatar_url), seller:profiles!conversations_seller_id_fkey(id, full_name, avatar_url), messages(id, content, created_at, sender_id, is_read)`)
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .order('updated_at', { ascending: false });
    if (data) {
      setConversations(data);
      const unread = data.reduce((count, conv) => {
        return count + (conv.messages?.filter((m) => !m.is_read && m.sender_id !== user.id)?.length || 0);
      }, 0);
      setUnreadCount(unread);
    }
  };

  const loadMessages = async (conversationId) => {
    const { data } = await supabase
      .from('messages').select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (data) {
      setMessages(data);
      const unreadIds = data.filter((m) => !m.is_read && m.sender_id !== user.id).map((m) => m.id);
      if (unreadIds.length > 0) {
        await supabase.from('messages').update({ is_read: true }).in('id', unreadIds);
        loadConversations();
      }
    }
  };

  // ─── START CONVERSATION ───
  const startConversation = async (item) => {
    if (!user) { setSignInAction('contact'); setShowSignInModal(true); return; }
    if (item.id?.toString().startsWith('s')) {
      setActiveChat({ id: `demo-${item.id}`, listing: item, seller: item.seller, otherUser: item.seller, isDemo: true });
      setMessages([]); setView('chat'); return;
    }
    const sellerId = item.seller_id || item.seller?.id;
    if (sellerId === user.id) {
      showToastMsg(lang === 'he' ? 'זה הפריט שלך!' : "That's your own listing!"); return;
    }
    const { data: existingList } = await supabase.from('conversations').select('*')
      .eq('listing_id', item.id)
      .or(`and(buyer_id.eq.${user.id},seller_id.eq.${sellerId}),and(buyer_id.eq.${sellerId},seller_id.eq.${user.id})`);
    const existing = existingList?.[0];
    if (existing) {
      const otherUserId = existing.buyer_id === user.id ? existing.seller_id : existing.buyer_id;
      const otherProfile = await getCachedProfile(otherUserId);
      setActiveChat({ ...existing, listing: item, seller: item.seller, otherUser: otherProfile || item.seller });
      loadMessages(existing.id); setView('chat'); return;
    }
    if (!sellerId) { setError(lang === 'he' ? 'לא ניתן ליצור שיחה' : 'Cannot start conversation'); return; }
    const { data: newConv, error: convError } = await supabase.from('conversations')
      .insert({ listing_id: item.id, buyer_id: user.id, seller_id: sellerId }).select().single();
    if (convError) {
      console.error('Conversation create error:', convError);
      const { data: retry } = await supabase.from('conversations').select('*')
        .eq('listing_id', item.id).or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`).limit(1).single();
      if (retry) {
        const otherUserId = retry.buyer_id === user.id ? retry.seller_id : retry.buyer_id;
        const otherProfile = await getCachedProfile(otherUserId);
        setActiveChat({ ...retry, listing: item, seller: item.seller, otherUser: otherProfile || item.seller });
        loadMessages(retry.id); setView('chat'); return;
      }
      setError(lang === 'he' ? 'שגיאה ביצירת שיחה' : 'Failed to start conversation'); return;
    }
    if (newConv) {
      setActiveChat({ ...newConv, listing: item, seller: item.seller, otherUser: item.seller });
      setMessages([]); setView('chat'); loadConversations();
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
    setSendingMessage(true); setNewMessage('');
    const optimisticId = `temp-${Date.now()}`;
    const optimisticMsg = { id: optimisticId, conversation_id: activeChat.id, sender_id: user.id, content: text, is_offer: isOffer, offer_amount: offerAmount, created_at: new Date().toISOString(), is_read: false };
    setMessages((prev) => [...prev, optimisticMsg]);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    try {
      const { data, error: msgError } = await supabase.from('messages')
        .insert({ conversation_id: activeChat.id, sender_id: user.id, content: text, is_offer: isOffer, offer_amount: offerAmount })
        .select().single();
      if (msgError) throw msgError;
      if (data) {
        setMessages((prev) => prev.map((m) => m.id === optimisticId ? data : m));
        await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', activeChat.id);
      }
    } catch (e) {
      console.error('Send message error:', e);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setNewMessage(text);
      setError(lang === 'he' ? 'שליחת ההודעה נכשלה' : 'Failed to send message');
    }
    setSendingMessage(false);
  };

  // ─── AUTH ACTIONS ───────────────────────────────────

  const signInGoogle = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
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
    await supabase.auth.signOut(); setTab('home'); setView('home'); showToastMsg('Signed out');
  };

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
      const publicUrl = urlData.publicUrl + '?t=' + Date.now(); // cache bust

      // Update profile
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      if (updateErr) throw updateErr;

      // Update local state
      setProfile(prev => ({ ...prev, avatar_url: publicUrl }));
      showToastMsg(lang === 'he' ? 'התמונה עודכנה!' : 'Photo updated!');
      if (DEV) console.log('[Avatar] Uploaded:', publicUrl);

    } catch (e) {
      console.error('[Avatar] Upload failed:', e);
      showToastMsg(lang === 'he' ? 'שגיאה בהעלאת התמונה' : 'Failed to upload photo');
    }
    setAvatarUploading(false);
  }, [user, lang, showToastMsg]);

  // ─── VERIFICATION ──────────────────────────────────
  const [verificationUploading, setVerificationUploading] = useState(false);

  const requestVerification = useCallback(async (file) => {
    if (!user || !file) return;
    if (!file.type.startsWith('image/')) {
      showToastMsg(lang === 'he' ? 'קובץ לא תקין' : 'Invalid file type');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToastMsg(lang === 'he' ? 'הקובץ גדול מדי (עד 10MB)' : 'File too large (max 10MB)');
      return;
    }

    setVerificationUploading(true);
    try {
      // Read + compress
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      const compressed = await compressImage(dataUrl, 1024, 0.85);
      const res = await fetch(compressed);
      const blob = await res.blob();

      const filePath = `${user.id}/selfie.jpg`;

      // Upload selfie
      const { error: uploadErr } = await supabase.storage
        .from('verification-photos')
        .upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });

      if (uploadErr) throw uploadErr;

      // Get URL (private — only admins can access)
      const { data: urlData } = supabase.storage.from('verification-photos').getPublicUrl(filePath);

      // Update profile status
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({
          verification_status: 'pending',
          verification_photo_url: urlData.publicUrl,
        })
        .eq('id', user.id);

      if (updateErr) throw updateErr;

      setProfile(prev => ({ ...prev, verification_status: 'pending' }));
      showToastMsg(lang === 'he' ? 'הבקשה נשלחה! נבדוק בהקדם' : 'Request submitted! We\'ll review soon');

    } catch (e) {
      console.error('[Verify] Upload failed:', e);
      showToastMsg(lang === 'he' ? 'שגיאה בשליחת הבקשה' : 'Failed to submit verification');
    }
    setVerificationUploading(false);
  }, [user, lang, showToastMsg]);

  // ─── ITEM ACTIONS ───────────────────────────────────

  const toggleSave = async (item) => {
    if (!user) { setSignInAction('save'); setShowSignInModal(true); return; }
    setHeartAnim(item.id);
    setTimeout(() => setHeartAnim(null), 800);
    if (savedIds.has(item.id)) {
      await supabase.from('saved_items').delete().eq('user_id', user.id).eq('listing_id', item.id);
      setSavedIds((prev) => { const n = new Set(prev); n.delete(item.id); return n; });
      setSavedItems((prev) => prev.filter((i) => i.id !== item.id));
      showToastMsg('Removed');
    } else {
      await supabase.from('saved_items').insert({ user_id: user.id, listing_id: item.id });
      setSavedIds((prev) => new Set(prev).add(item.id));
      setSavedItems((prev) => [...prev, item]);
      showToastMsg('Saved!');
    }
  };

  const deleteListing = async (id) => {
    await supabase.from('listings').update({ status: 'deleted' }).eq('id', id);
    loadUserData(); showToastMsg('Deleted');
  };

  // ═══════════════════════════════════════════════════════
  // IMAGE ANALYSIS PIPELINE
  //
  // State machine: idle → compressing → analyzing → success
  // Failure states: compress_error | analysis_error
  //
  // Features:
  //  • Client-side compression (1800px max, JPEG 0.85)
  //  • Analysis API with retry (up to 2 attempts, exponential backoff)
  //  • AbortController cancellation (new image aborts old pipeline)
  //  • Instrumented dev logging
  //  • Error UI stays on analyzing screen with Retry button
  // ═══════════════════════════════════════════════════════

  // ── Internal: call /api/analyze with retry + timeout ──
  const analyzeWithRetry = useCallback(async (compressedDataUrl, pipelineSignal, maxRetries = 1, refineModel = null) => {
    const base64 = compressedDataUrl.split(',')[1];
    let lastError;

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

      // Create a per-attempt controller that aborts on timeout OR user cancel
      const attemptCtrl = new AbortController();
      const timeoutId = setTimeout(() => attemptCtrl.abort(), 35000);
      const onPipelineAbort = () => { clearTimeout(timeoutId); attemptCtrl.abort(); };
      pipelineSignal.addEventListener('abort', onPipelineAbort);

      const t0 = performance.now();
      try {
        const body = { imageData: base64, lang };
        if (refineModel) body.refineModel = refineModel;

        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: attemptCtrl.signal,
        });
        clearTimeout(timeoutId);
        pipelineSignal.removeEventListener('abort', onPipelineAbort);

        if (DEV) console.log(`[Analyze] Attempt ${attempt + 1}: HTTP ${res.status} in ${(performance.now() - t0).toFixed(0)}ms`);

        if (!res.ok) {
          // Retry server errors, not client errors
          if (res.status >= 500 && attempt < maxRetries) {
            lastError = new Error(`Server error (${res.status})`);
            continue;
          }
          throw new Error(lang === 'he' ? `שגיאת שרת (${res.status})` : `Server error (${res.status})`);
        }

        const data = await res.json();
        if (data.content?.[0]?.text) {
          const parsed = JSON.parse(data.content[0].text.replace(/```json\n?|\n?```/g, '').trim());
          if (DEV) console.log(`[Analyze] Success:`, parsed.name || parsed.nameHebrew);
          return parsed;
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
  }, [lang]);

  // ── Main pipeline: compress → analyze ──
  const runPipeline = useCallback(async (rawDataUrl) => {
    // Cancel any in-flight pipeline
    if (pipelineAbortRef.current) {
      pipelineAbortRef.current.abort();
    }
    const abortCtrl = new AbortController();
    pipelineAbortRef.current = abortCtrl;

    setPipelineError(null);
    const pipelineT0 = performance.now();

    try {
      // ── Step 1: Compress ──
      setPipelineState('compressing');
      if (DEV) console.log('[Pipeline] Compressing...');
      const compressed = await compressImage(rawDataUrl);
      setImages([compressed]); // Show compressed version in preview

      if (abortCtrl.signal.aborted) return;

      // ── Step 2: Analyze ──
      setPipelineState('analyzing');
      if (DEV) console.log('[Pipeline] Analyzing...');
      const analysisResult = await analyzeWithRetry(compressed, abortCtrl.signal);

      if (abortCtrl.signal.aborted) return;

      // ── Success ──
      setPipelineState('success');
      setResult(analysisResult);
      setView('results');
      playSound('success');
      if (DEV) console.log(`[Pipeline] Complete in ${(performance.now() - pipelineT0).toFixed(0)}ms`);

    } catch (e) {
      // User cancelled — silent, no error UI
      if (e.name === 'AbortError' || abortCtrl.signal.aborted) {
        if (DEV) console.log('[Pipeline] Cancelled by user');
        return;
      }

      console.error('[Pipeline] Failed:', e);
      const failedAtCompress = !images.length || pipelineState === 'compressing';
      setPipelineState(failedAtCompress ? 'compress_error' : 'analysis_error');
      setPipelineError(e.message || (lang === 'he' ? 'שגיאה' : 'An error occurred'));
      playSound('error');
      // Stay on 'analyzing' view — it now shows error UI with Retry
    }
  }, [analyzeWithRetry, playSound, lang]);

  // ── Retry from the failed step ──
  const retryPipeline = useCallback(() => {
    if (!capturedImageRef.current) return;
    setView('analyzing');
    runPipeline(capturedImageRef.current);
  }, [runPipeline]);

  // ── Cancel and go home ──
  const cancelPipeline = useCallback(() => {
    if (pipelineAbortRef.current) pipelineAbortRef.current.abort();
    setPipelineState('idle');
    setPipelineError(null);
    setView('home');
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

      const refined = await analyzeWithRetry(images[0], abortCtrl.signal, 1, modelName);

      if (abortCtrl.signal.aborted) return;

      // Mark as confirmed since user selected the model
      refined.userConfirmed = true;
      refined.needsConfirmation = false;

      setPipelineState('success');
      setResult(refined);
      setView('results');
      playSound('success');
      if (DEV) console.log('[Refine] Complete:', refined.name);
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error('[Refine] Failed:', e);
      // Fall back to existing result instead of showing error
      setView('results');
      showToastMsg(lang === 'he' ? 'שגיאה בעדכון, מחירים מקוריים נשמרו' : 'Update failed, original prices kept');
    }
  }, [images, analyzeWithRetry, playSound, lang, showToastMsg]);

  // ── Confirm: user says the identification is correct ──
  const confirmResult = useCallback(() => {
    if (!result) return;
    setResult(prev => ({ ...prev, userConfirmed: true, needsConfirmation: false }));
    playSound('tap');
    if (DEV) console.log('[Confirm] User confirmed:', result.name);
  }, [result, playSound]);

  // ── Correct: user types the correct model manually ──
  const correctResult = useCallback(async (userInput) => {
    if (!userInput?.trim()) return;
    await refineResult(userInput.trim());
  }, [refineResult]);

  // ── handleFile: user picks image from gallery ──
  const handleFile = useCallback((file) => {
    if (!file?.type.startsWith('image/')) return;
    playSound('tap');
    setView('analyzing');

    const reader = new FileReader();
    reader.onload = (e) => {
      const rawData = e.target.result;
      capturedImageRef.current = rawData;
      setImages([rawData]); // Show original while compressing
      runPipeline(rawData);
    };
    reader.onerror = () => {
      setPipelineState('compress_error');
      setPipelineError(lang === 'he' ? 'שגיאה בקריאת הקובץ' : 'Failed to read file');
    };
    reader.readAsDataURL(file);
  }, [runPipeline, playSound, lang]);

  // ═══════════════════════════════════════════════════════
  // CAMERA + TORCH
  // ═══════════════════════════════════════════════════════

  const cameraStartingRef = useRef(false); // Prevent double getUserMedia

  // ── Kill all tracks, release hardware, clear video element ──
  const releaseCamera = useCallback(() => {
    if (DEV) console.log('[Camera] releaseCamera called');
    // Turn off torch first
    if (cameraStreamRef.current) {
      try {
        const vt = cameraStreamRef.current.getVideoTracks()[0];
        if (vt && typeof vt.applyConstraints === 'function') {
          vt.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
        }
      } catch {}
      // Stop every track
      cameraStreamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch {}
      });
      cameraStreamRef.current = null;
    }
    // Clear video element
    if (videoRef.current) {
      videoRef.current.pause();
      try { videoRef.current.srcObject = null; } catch {}
    }
    setTorchOn(false);
    setTorchSupported(false);
    cameraStartingRef.current = false;
  }, []);

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
      if (!video) { done(false); return; }

      video.onloadedmetadata = null;
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play()
          .then(() => {
            if (DEV) console.log(`[Camera] Video playing: ${video.videoWidth}×${video.videoHeight}`);
            done(true);
          })
          .catch((e) => {
            console.warn('[Camera] play() failed:', e.message);
            done(false);
          });
      };

      // Fallback: if metadata doesn't fire in 3s, force play
      setTimeout(() => {
        if (!resolved) {
          video.play().catch(() => {});
          done(true);
        }
      }, 3000);
    });
  }, []);

  // ── Wait for videoRef to be mounted (React may not have rendered yet) ──
  const waitForVideoElement = useCallback(() => {
    return new Promise((resolve) => {
      if (videoRef.current) { resolve(true); return; }
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        if (videoRef.current) { clearInterval(poll); resolve(true); return; }
        if (attempts > 30) { clearInterval(poll); resolve(false); } // 1.5s max
      }, 50);
    });
  }, []);

  // ── Start camera — single entry point, guarded against double calls ──
  const startCamera = useCallback(async () => {
    // Prevent double start
    if (cameraStartingRef.current) {
      if (DEV) console.log('[Camera] Start already in progress, skipping');
      return;
    }
    cameraStartingRef.current = true;

    if (DEV) console.log('[Camera] Start requested');

    try {
      // Always release previous stream first
      releaseCamera();
      cameraStartingRef.current = true; // Re-set after releaseCamera clears it

      // Check permission (not supported on all browsers)
      if (navigator.permissions?.query) {
        try {
          const permResult = await navigator.permissions.query({ name: 'camera' });
          if (permResult.state === 'denied') {
            setError(lang === 'he' ? 'הגישה למצלמה נחסמה. אנא אפשר אותה בהגדרות הדפדפן' : 'Camera access is blocked. Please enable it in browser settings.');
            cameraStartingRef.current = false;
            return;
          }
        } catch {}
      }

      // Try environment camera first, fallback to user
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (envErr) {
        if (DEV) console.log('[Camera] Environment failed, trying user camera:', envErr.message);
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      }

      // Store stream
      cameraStreamRef.current = stream;
      cameraPermissionGranted.current = true;

      // Navigate to camera view so React mounts the <video> element
      setView('camera');

      // Wait for videoRef to exist in DOM (polling, not fixed delay)
      const videoMounted = await waitForVideoElement();
      if (!videoMounted) {
        console.warn('[Camera] Video element never mounted');
        releaseCamera();
        cameraStartingRef.current = false;
        return;
      }

      // Check if stream was released while waiting (user cancelled fast)
      if (!cameraStreamRef.current) {
        cameraStartingRef.current = false;
        return;
      }

      await attachStreamToVideo(stream);
      detectTorch(stream);

      if (DEV) console.log('[Camera] Start success');

    } catch (err) {
      console.error('[Camera] Start error:', err);
      releaseCamera();
      if (err.name === 'NotAllowedError' || err.name === 'NotFoundError') {
        cameraPermissionGranted.current = false;
        setError(lang === 'he' ? 'הגישה למצלמה נדחתה' : 'Camera access denied.');
      } else {
        setError(lang === 'he' ? 'שגיאה בפתיחת המצלמה' : 'Failed to open camera');
      }
    }
    cameraStartingRef.current = false;
  }, [releaseCamera, attachStreamToVideo, waitForVideoElement, detectTorch, lang, setError]);

  // ── Capture — waits for video readyState, validates frame ──
  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // Check video is actually producing frames
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      if (DEV) console.warn('[Camera] Capture aborted: video not ready', video.readyState, video.videoWidth);
      showToastMsg(lang === 'he' ? 'המצלמה עדיין נטענת, נסה שוב' : 'Camera still loading, try again');
      return;
    }

    if (DEV) console.log(`[Camera] Capture: ${video.videoWidth}×${video.videoHeight}`);

    playSound('shutter');
    setShowFlash(true);

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // Try toBlob first (better), fallback to toDataURL
    const processCapture = (rawImg) => {
      if (!rawImg) {
        if (DEV) console.warn('[Camera] Capture produced empty image');
        setShowFlash(false);
        showToastMsg(lang === 'he' ? 'שגיאה בצילום, נסה שוב' : 'Capture failed, try again');
        return;
      }
      capturedImageRef.current = rawImg;
      if (DEV) console.log('[Camera] Capture success');
      setTimeout(() => {
        setShowFlash(false);
        setImages([rawImg]);
        setView('analyzing');
        releaseCamera();
        runPipeline(rawImg);
      }, 150);
    };

    // Use toDataURL (synchronous, reliable on all browsers)
    try {
      const rawImg = canvas.toDataURL('image/jpeg', 0.85);
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
  }, [runPipeline, playSound, releaseCamera, lang, showToastMsg]);

  const stopCamera = useCallback(() => {
    if (DEV) console.log('[Camera] Stop requested');
    releaseCamera();
    setView('home');
  }, [releaseCamera]);

  // Release camera when app goes to background (iOS Safari PWA)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && cameraStreamRef.current) {
        if (DEV) console.log('[Camera] App hidden — releasing camera');
        releaseCamera();
        setView(prev => prev === 'camera' ? 'home' : prev);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [releaseCamera]);

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

  const publishListing = async () => {
    if (!user) { setError(lang === 'he' ? 'יש להתחבר תחילה' : 'Please sign in first'); return; }
    if (!listingData.title || !listingData.price || !listingData.phone || !listingData.location) {
      setError(lang === 'he' ? 'נא למלא את כל השדות' : 'Please fill all fields'); return;
    }
    setPublishing(true);
    setError(null);
    try {
      let imageUrls = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (img.startsWith('data:')) {
          const response = await fetch(img);
          const blob = await response.blob();
          const fileName = `${user.id}/${Date.now()}-${i}.jpg`;
          try {
            const { error: uploadError } = await supabase.storage.from('listings').upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
            if (uploadError) { imageUrls.push(img); }
            else {
              const { data: { publicUrl } } = supabase.storage.from('listings').getPublicUrl(fileName);
              imageUrls.push(publicUrl);
            }
          } catch { imageUrls.push(img); }
        } else { imageUrls.push(img); }
      }
      if (imageUrls.length === 0) {
        imageUrls = images.length > 0 ? images : [];
        if (imageUrls.length === 0) throw new Error(lang === 'he' ? 'נדרשת תמונה אחת לפחות' : 'At least one image is required');
      }
      const qualityScore = computeQualityScore({
        title: listingData.title, description: listingData.desc,
        images: imageUrls, condition, price: listingData.price,
        category: result?.category,
      });
      const listingRow = {
        seller_id: user.id, title: listingData.title, title_hebrew: result?.nameHebrew || '',
        description: listingData.desc || '', category: result?.category || 'Other',
        condition, price: listingData.price, images: imageUrls,
        location: listingData.location, contact_phone: listingData.phone, status: 'active',
        quality_score: qualityScore
      };
      let insertResult = await supabase.from('listings').insert(listingRow).select();
      // Fallback: if quality_score column doesn't exist, retry without it
      if (insertResult.error && insertResult.error.message?.includes('quality_score')) {
        if (DEV) console.warn('[Publish] quality_score column missing, retrying without it');
        delete listingRow.quality_score;
        insertResult = await supabase.from('listings').insert(listingRow).select();
      }
      if (insertResult.error) throw insertResult.error;
      await loadUserData();
      await loadListings(true);
      setListingStep(3);
      showToastMsg(t.published);
      playSound('coin');
    } catch (e) {
      console.error('Publish error:', e);
      setError(e.message || (lang === 'he' ? 'שגיאה בפרסום, נסה שוב' : 'Failed to publish. Please try again.'));
      playSound('error');
    } finally {
      setPublishing(false);
    }
  };

  // ─── REPORT LISTING ───
  const reportListing = async (listingId, reason) => {
    if (!user) { setSignInAction('contact'); setShowSignInModal(true); return false; }
    if (!listingId || !reason) return false;
    try {
      const { error: rptError } = await supabase.from('reports').insert({
        listing_id: listingId, reporter_id: user.id, reason,
      });
      if (rptError) throw rptError;
      showToastMsg(lang === 'he' ? 'הדיווח נשלח, תודה!' : 'Report submitted, thank you!');
      return true;
    } catch (e) {
      console.error('Report error:', e);
      setError(lang === 'he' ? 'שגיאה בדיווח' : 'Failed to submit report');
      return false;
    }
  };

  // ─── ORDERS / CHECKOUT ─────────────────────────────

  // Load all orders for current user (as buyer or seller)
  const loadOrders = useCallback(async () => {
    if (!user) return;
    setOrdersLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('orders')
        .select('*, listing:listings(id, title, title_hebrew, price, images, location, contact_phone, seller_id), buyer:profiles!orders_buyer_id_fkey(id, full_name, avatar_url, is_verified), seller:profiles!orders_seller_id_fkey(id, full_name, avatar_url, is_verified)')
        .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
        .order('created_at', { ascending: false });
      if (err) throw err;
      setOrders(data || []);
    } catch (e) {
      console.error('[Orders] Load error:', e);
    }
    setOrdersLoading(false);
  }, [user]);

  // Create a new order (buyer initiates)
  const createOrder = useCallback(async ({ listingId, sellerId, price, deliveryMethod, shippingAddress, buyerNote }) => {
    if (!user) { setSignInAction('buy'); setShowSignInModal(true); return null; }
    if (user.id === sellerId) {
      showToastMsg(lang === 'he' ? 'אי אפשר לקנות מעצמך' : "You can't buy your own listing");
      return null;
    }
    try {
      // Check for existing active order
      const { data: existing } = await supabase
        .from('orders')
        .select('id, status')
        .eq('listing_id', listingId)
        .eq('buyer_id', user.id)
        .not('status', 'in', '("cancelled","completed")')
        .limit(1);
      if (existing?.length > 0) {
        showToastMsg(lang === 'he' ? 'כבר יש לך הזמנה פעילה למוצר הזה' : 'You already have an active order for this item');
        return null;
      }

      const { data, error: err } = await supabase.from('orders').insert({
        listing_id: listingId,
        buyer_id: user.id,
        seller_id: sellerId,
        price,
        delivery_method: deliveryMethod,
        shipping_address: shippingAddress || null,
        buyer_note: buyerNote || null,
        status: 'pending',
      }).select().single();

      if (err) throw err;

      showToastMsg(lang === 'he' ? 'ההזמנה נשלחה למוכר!' : 'Order sent to seller!');
      playSound('coin');
      setShowCheckout(false);
      await loadOrders();
      setView('orderDetail');
      setActiveOrder(data);
      return data;
    } catch (e) {
      console.error('[Orders] Create error:', e);
      setError(lang === 'he' ? 'שגיאה ביצירת הזמנה' : 'Failed to create order');
      return null;
    }
  }, [user, lang, showToastMsg, playSound, loadOrders]);

  // Update order status (seller accepts, marks shipped/ready, buyer confirms)
  const updateOrderStatus = useCallback(async (orderId, newStatus) => {
    if (!user || !orderId) return false;
    try {
      const timestamps = {};
      if (newStatus === 'accepted') timestamps.accepted_at = new Date().toISOString();
      if (newStatus === 'shipped' || newStatus === 'ready_pickup') timestamps.shipped_at = new Date().toISOString();
      if (newStatus === 'delivered') timestamps.delivered_at = new Date().toISOString();
      if (newStatus === 'completed') timestamps.completed_at = new Date().toISOString();
      if (newStatus === 'cancelled') {
        timestamps.cancelled_at = new Date().toISOString();
        timestamps.cancelled_by = user.id;
      }

      const { error: err } = await supabase
        .from('orders')
        .update({ status: newStatus, ...timestamps })
        .eq('id', orderId);

      if (err) throw err;

      // If completed, mark listing as sold
      if (newStatus === 'completed' && activeOrder) {
        await supabase.from('listings').update({
          status: 'sold',
          sold_to: activeOrder.buyer_id,
          sold_at: new Date().toISOString(),
        }).eq('id', activeOrder.listing_id);
      }

      const statusLabels = {
        accepted: lang === 'he' ? 'ההזמנה אושרה!' : 'Order accepted!',
        shipped: lang === 'he' ? 'המוצר נשלח!' : 'Item shipped!',
        ready_pickup: lang === 'he' ? 'המוצר מוכן לאיסוף!' : 'Ready for pickup!',
        delivered: lang === 'he' ? 'המוצר התקבל!' : 'Item received!',
        completed: lang === 'he' ? 'העסקה הושלמה!' : 'Transaction complete!',
        cancelled: lang === 'he' ? 'ההזמנה בוטלה' : 'Order cancelled',
      };
      showToastMsg(statusLabels[newStatus] || 'Updated');
      playSound(newStatus === 'completed' ? 'coin' : 'tap');

      // Refresh
      await loadOrders();
      // Update activeOrder in place
      setActiveOrder(prev => prev?.id === orderId ? { ...prev, status: newStatus, ...timestamps } : prev);

      return true;
    } catch (e) {
      console.error('[Orders] Update error:', e);
      setError(lang === 'he' ? 'שגיאה בעדכון ההזמנה' : 'Failed to update order');
      return false;
    }
  }, [user, lang, activeOrder, showToastMsg, playSound, loadOrders]);

  // Cancel order (either party)
  const cancelOrder = useCallback(async (orderId, reason) => {
    if (!user || !orderId) return false;
    try {
      const { error: err } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: user.id,
          cancel_reason: reason || null,
        })
        .eq('id', orderId);

      if (err) throw err;
      showToastMsg(lang === 'he' ? 'ההזמנה בוטלה' : 'Order cancelled');
      await loadOrders();
      setActiveOrder(prev => prev?.id === orderId ? { ...prev, status: 'cancelled' } : prev);
      return true;
    } catch (e) {
      console.error('[Orders] Cancel error:', e);
      setError(lang === 'he' ? 'שגיאה בביטול' : 'Failed to cancel order');
      return false;
    }
  }, [user, lang, showToastMsg, loadOrders]);

  // View an order's detail
  const viewOrder = useCallback((order) => {
    setActiveOrder(order);
    setView('orderDetail');
  }, []);

  // ─── NAVIGATION ────────────────────────────────────

  const reset = () => {
    // Cancel any in-flight pipeline
    if (pipelineAbortRef.current) pipelineAbortRef.current.abort();
    setPipelineState('idle');
    setPipelineError(null);
    setImages([]); setResult(null); setView('home'); setError(null);
    setCondition(null); setListingStep(0); setSelected(null);
    setActiveChat(null); capturedImageRef.current = null;
    setSellerProfile(null); setSellerListings([]);
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

  const startListing = () => {
    if (!user) { setSignInAction('list'); setShowSignInModal(true); return; }
    setListingData({ title: result?.name || '', desc: '', price: result?.marketValue?.mid || 0, phone: '', location: '' });
    setCondition(null); setAnswers({}); setListingStep(0); setView('listing');
  };

  const selectCondition = (c) => {
    setCondition(c);
    setListingData((prev) => ({ ...prev, price: calcPrice(result?.marketValue?.mid, c, answers) }));
    setListingStep(c === 'used' ? 1 : 2);
  };

  const value = {
    lang, setLang, t, rtl,
    user, profile, loading, authMode, setAuthMode, authForm, setAuthForm, authError, setAuthError, authLoading,
    signInGoogle, signInEmail, signOut,
    uploadAvatar, avatarUploading,
    requestVerification, verificationUploading,
    showSignInModal, setShowSignInModal, signInAction, setSignInAction,
    tab, setTab, view, setView, goTab, reset,
    listings, myListings, savedIds, savedItems,
    hasMore, loadingMore, loadMoreListings, loadListings,
    toggleSave, deleteListing, viewItem, contactSeller,
    selected, setSelected, showContact, setShowContact, heartAnim,
    sellerProfile, sellerListings, loadingSeller, viewSellerProfile,
    search, setSearch, category, setCategory,
    priceRange, setPriceRange, sort, setSort,
    filterCondition, setFilterCondition,
    showFilters, setShowFilters,
    images, setImages, result, setResult,
    listingStep, setListingStep, condition, setCondition,
    answers, setAnswers, listingData, setListingData,
    publishing, publishListing, startListing, selectCondition,
    reportListing,
    // Orders / Checkout
    orders, activeOrder, setActiveOrder, ordersLoading,
    showCheckout, setShowCheckout,
    loadOrders, createOrder, updateOrderStatus, cancelOrder, viewOrder,
    // Pipeline (replaces analyzeImage)
    handleFile, startCamera, capture, stopCamera, releaseCamera,
    pipelineState, pipelineError, retryPipeline, cancelPipeline,
    // Recognition refinement
    refineResult, confirmResult, correctResult,
    // Torch
    torchSupported, torchOn, toggleTorch,
    showFlash, capturedImageRef,
    conversations, activeChat, setActiveChat,
    messages, setMessages, newMessage, setNewMessage,
    sendingMessage, sendMessage, unreadCount,
    loadMessages, startConversation, loadConversations,
    messagesEndRef,
    // Notification system
    msgNotification, openNotification, dismissNotification,
    error, setError, toast, setToast, showToastMsg,
    soundEnabled, setSoundEnabled, playSound,
    fileRef, videoRef, canvasRef,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}