import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import T from '../lib/translations';
import SoundEffects from '../lib/sounds';
import { sanitizeSearch, calcPrice, PAGE_SIZE } from '../lib/utils';

const AppContext = createContext(null);

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};

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

  // Browse state
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [priceRange, setPriceRange] = useState({ min: '', max: '' });
  const [debouncedPriceRange, setDebouncedPriceRange] = useState({ min: '', max: '' });
  const [sort, setSort] = useState('newest');
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState(null);

  // Auth state
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

  // [FIX #3] Seller profile state
  const [sellerProfile, setSellerProfile] = useState(null);
  const [sellerListings, setSellerListings] = useState([]);
  const [loadingSeller, setLoadingSeller] = useState(false);

  // Sound
  const [soundEnabled, setSoundEnabled] = useState(true);

  // [FIX #5] Camera permission — remember if granted so we don't re-prompt
  const cameraStreamRef = useRef(null);
  const cameraPermissionGranted = useRef(false);

  // Refs
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const t = T[lang];
  const rtl = lang === 'he';

  const playSound = useCallback((soundName) => {
    if (soundEnabled && SoundEffects[soundName]) {
      SoundEffects[soundName]();
    }
  }, [soundEnabled]);

  const showToastMsg = (msg) => setToast(msg);

  // ─── AUTH ────────────────────────────────────────────
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
        if (event === 'SIGNED_IN' && view === 'auth') { setView('profile'); setTab('profile'); }
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
  }, [category, debouncedPriceRange.min, debouncedPriceRange.max, debouncedSearch]);

  // Load user data when auth changes
  useEffect(() => {
    if (user) loadUserData();
    else { setMyListings([]); setSavedItems([]); setSavedIds(new Set()); }
  }, [user]);

  // Auto-dismiss errors
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // ─── [FIX #2] REAL-TIME CHAT — Both parties see messages instantly ───
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`user-messages-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const newMsg = payload.new;
          // Append if this message belongs to the active chat and is from the other person
          if (activeChat && newMsg.conversation_id === activeChat.id && newMsg.sender_id !== user.id) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
            // Mark as read immediately
            supabase.from('messages').update({ is_read: true }).eq('id', newMsg.id).then(() => {});
          }
          // Always refresh conversations list so unread badges update
          loadConversations();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          // Update read receipts in real-time
          const updated = payload.new;
          setMessages((prev) => prev.map((m) => m.id === updated.id ? { ...m, ...updated } : m));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, activeChat?.id]);

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
    if (debouncedPriceRange.min) query = query.gte('price', parseInt(debouncedPriceRange.min));
    if (debouncedPriceRange.max) query = query.lte('price', parseInt(debouncedPriceRange.max));

    if (debouncedSearch) {
      const safe = sanitizeSearch(debouncedSearch);
      if (safe) {
        query = query.or(`title.ilike.%${safe}%,title_hebrew.ilike.%${safe}%`);
      }
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
    if (debouncedPriceRange.min) query = query.gte('price', parseInt(debouncedPriceRange.min));
    if (debouncedPriceRange.max) query = query.lte('price', parseInt(debouncedPriceRange.max));
    if (debouncedSearch) {
      const safe = sanitizeSearch(debouncedSearch);
      if (safe) query = query.or(`title.ilike.%${safe}%,title_hebrew.ilike.%${safe}%`);
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

  // ─── [FIX #3] SELLER PROFILE ──────────────────────────
  const viewSellerProfile = async (sellerId) => {
    if (!sellerId) return;
    setLoadingSeller(true);
    setView('sellerProfile');

    const [{ data: profileData }, { data: listingsData }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', sellerId).single(),
      supabase.from('listings')
        .select('*, seller:profiles(id, full_name, avatar_url, badge, is_verified, rating)')
        .eq('seller_id', sellerId)
        .eq('status', 'active')
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
      .from('messages')
      .select('*')
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

  // [FIX #2] Start conversation — works for real users, create if doesn't exist
  const startConversation = async (item) => {
    if (!user) { setSignInAction('contact'); setShowSignInModal(true); return; }

    // Demo items
    if (item.id?.toString().startsWith('s')) {
      setActiveChat({ id: `demo-${item.id}`, listing: item, seller: item.seller, otherUser: item.seller, isDemo: true });
      setMessages([]);
      setView('chat');
      return;
    }

    // Check if conversation already exists
    const { data: existing } = await supabase
      .from('conversations').select('*').eq('listing_id', item.id).eq('buyer_id', user.id).single();

    if (existing) {
      const otherUser = existing.seller_id === user.id ? item.buyer : item.seller;
      setActiveChat({ ...existing, listing: item, seller: item.seller, otherUser: otherUser || item.seller });
      loadMessages(existing.id);
      setView('chat');
      return;
    }

    // Create new conversation
    const sellerId = item.seller_id || item.seller?.id;
    if (!sellerId) { setError(lang === 'he' ? 'לא ניתן ליצור שיחה' : 'Cannot start conversation'); return; }

    const { data: newConv, error: convError } = await supabase
      .from('conversations')
      .insert({ listing_id: item.id, buyer_id: user.id, seller_id: sellerId })
      .select().single();

    if (convError) {
      console.error('Conversation error:', convError);
      setError(lang === 'he' ? 'שגיאה ביצירת שיחה' : 'Failed to start conversation');
      return;
    }

    if (newConv) {
      setActiveChat({ ...newConv, listing: item, seller: item.seller, otherUser: item.seller });
      setMessages([]);
      setView('chat');
      loadConversations();
    }
  };

  // [FIX #2] Send message — works for real users with proper error handling
  const sendMessage = async (content, isOffer = false, offerAmount = null) => {
    if (!content.trim() || !activeChat || sendingMessage) return;

    // Demo mode
    if (activeChat.isDemo) {
      const demoMsg = {
        id: `demo-msg-${Date.now()}`, sender_id: user.id, content: content.trim(),
        is_offer: isOffer, offer_amount: offerAmount, created_at: new Date().toISOString(), is_read: true
      };
      setMessages((prev) => [...prev, demoMsg]);
      setNewMessage('');

      setTimeout(() => {
        const responses = lang === 'he'
          ? ['מעניין! בוא נדבר', 'אני זמין, איפה נוח לך להיפגש?', 'אשמח לשמוע עוד', 'בוא ניצור קשר בווטסאפ']
          : ["Interesting! Let's talk", "I'm available, where would you like to meet?", "I'd love to hear more", "Let's connect on WhatsApp"];
        setMessages((prev) => [...prev, {
          id: `demo-reply-${Date.now()}`, sender_id: 'seller',
          content: responses[Math.floor(Math.random() * responses.length)],
          created_at: new Date().toISOString(), is_read: false
        }]);
      }, 1500);

      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      return;
    }

    // Real message to real user
    setSendingMessage(true);
    try {
      const { data, error: msgError } = await supabase
        .from('messages')
        .insert({
          conversation_id: activeChat.id,
          sender_id: user.id,
          content: content.trim(),
          is_offer: isOffer,
          offer_amount: offerAmount
        })
        .select().single();

      if (msgError) throw msgError;

      if (data) {
        setMessages((prev) => [...prev, data]);
        setNewMessage('');
        // Update conversation timestamp so it floats to top
        await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', activeChat.id);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      }
    } catch (e) {
      console.error('Send message error:', e);
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
    const { error: err } = authMode === 'login'
      ? await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password })
      : await supabase.auth.signUp({ email: authForm.email, password: authForm.password, options: { data: { full_name: authForm.name } } });
    if (err) setAuthError(err.message);
    else if (authMode === 'signup') setAuthError('Check your email!');
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setTab('home');
    setView('home');
    showToastMsg('Signed out');
  };

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
    loadUserData();
    showToastMsg('Deleted');
  };

  // ─── ANALYZE ────────────────────────────────────────

  const analyzeImage = useCallback(async (imgData) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
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
      if (e.name === 'AbortError') throw new Error(lang === 'he' ? 'הזמן הקצוב פג, נסה שוב' : 'Request timed out, please try again');
      throw e;
    }
  }, [lang]);

  const handleFile = useCallback((file) => {
    if (!file?.type.startsWith('image/')) return;
    playSound('tap');
    setView('analyzing');
    const reader = new FileReader();
    reader.onload = async (e) => {
      const imageData = e.target.result;
      setImages([imageData]);
      try {
        const r = await analyzeImage(imageData);
        setResult(r);
        setView('results');
        playSound('success');
      } catch {
        setError(t.failed);
        setView('home');
        playSound('error');
      }
    };
    reader.readAsDataURL(file);
  }, [analyzeImage, playSound, t.failed]);

  // ─── [FIX #5] CAMERA — Request permission once, reuse stream ───

  const startCamera = async () => {
    try {
      // Check if we already have a live stream we can reuse
      if (cameraStreamRef.current) {
        const tracks = cameraStreamRef.current.getTracks();
        const hasLive = tracks.some((t) => t.readyState === 'live');
        if (hasLive) {
          setView('camera');
          requestAnimationFrame(() => {
            if (videoRef.current) {
              videoRef.current.srcObject = cameraStreamRef.current;
              videoRef.current.play().catch(() => {});
            }
          });
          return;
        }
      }

      // Check permission state first (avoids re-prompting on supported browsers)
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const permResult = await navigator.permissions.query({ name: 'camera' });
          // If denied, show error immediately without triggering browser prompt
          if (permResult.state === 'denied') {
            setError(lang === 'he' ? 'הגישה למצלמה נחסמה. אנא אפשר אותה בהגדרות הדפדפן' : 'Camera access is blocked. Please enable it in browser settings.');
            return;
          }
        } catch { /* permissions.query not supported for camera — continue normally */ }
      }

      // Request new stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });

      cameraStreamRef.current = stream;
      cameraPermissionGranted.current = true;

      setView('camera');
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      console.error('Camera error:', err);
      if (err.name === 'NotAllowedError') {
        setError(lang === 'he' ? 'הגישה למצלמה נדחתה. אנא אפשר אותה בהגדרות הדפדפן' : 'Camera access denied. Please allow it in browser settings.');
      } else {
        setError(t.cameraDenied || (lang === 'he' ? 'שגיאה בפתיחת המצלמה' : 'Failed to open camera'));
      }
    }
  };

  const capture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    playSound('shutter');
    setShowFlash(true);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const img = canvas.toDataURL('image/jpeg', 0.85);
    capturedImageRef.current = img;

    setTimeout(() => {
      setShowFlash(false);
      setImages([img]);
      setView('analyzing');
      // [FIX #5] Don't stop the stream — just pause the video element
      // This way we can reuse the stream next time without re-prompting
      if (videoRef.current) {
        videoRef.current.pause();
      }
      analyzeImage(img)
        .then((r) => { setResult(r); setView('results'); playSound('success'); })
        .catch(() => { setError(t.failed); setView('home'); playSound('error'); });
    }, 150);
  }, [analyzeImage, playSound, t.failed]);

  const stopCamera = () => {
    // [FIX #5] Only pause — don't kill the stream so we can reuse it
    if (videoRef.current) {
      videoRef.current.pause();
    }
    setView('home');
  };

  // Cleanup camera stream on unmount (app close)
  useEffect(() => {
    return () => {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current = null;
      }
    };
  }, []);

  // ─── [FIX #4] PUBLISH LISTING — Storage upload with base64 fallback ───

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
            const { error: uploadError } = await supabase.storage
              .from('listings')
              .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });

            if (uploadError) {
              console.warn('Storage upload failed, using base64 fallback:', uploadError.message);
              // [FIX #4] Fallback to base64 if storage isn't set up
              // This ensures the feature works even if Supabase Storage bucket doesn't exist
              imageUrls.push(img);
            } else {
              const { data: { publicUrl } } = supabase.storage.from('listings').getPublicUrl(fileName);
              imageUrls.push(publicUrl);
            }
          } catch (storageErr) {
            console.warn('Storage exception, using base64 fallback:', storageErr);
            imageUrls.push(img);
          }
        } else {
          imageUrls.push(img);
        }
      }

      if (imageUrls.length === 0) {
        imageUrls = images.length > 0 ? images : [];
        if (imageUrls.length === 0) throw new Error(lang === 'he' ? 'נדרשת תמונה אחת לפחות' : 'At least one image is required');
      }

      const { error: insertError } = await supabase.from('listings').insert({
        seller_id: user.id, title: listingData.title, title_hebrew: result?.nameHebrew || '',
        description: listingData.desc || '', category: result?.category || 'Other',
        condition, price: listingData.price, images: imageUrls,
        location: listingData.location, contact_phone: listingData.phone, status: 'active'
      }).select();

      if (insertError) throw insertError;

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

  // ─── NAVIGATION ────────────────────────────────────

  const reset = () => {
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

  const value = {
    lang, setLang, t, rtl,
    user, profile, loading, authMode, setAuthMode, authForm, setAuthForm, authError, setAuthError,
    signInGoogle, signInEmail, signOut,
    showSignInModal, setShowSignInModal, signInAction, setSignInAction,
    tab, setTab, view, setView, goTab, reset,
    listings, myListings, savedIds, savedItems,
    hasMore, loadingMore, loadMoreListings, loadListings,
    toggleSave, deleteListing, viewItem, contactSeller,
    selected, setSelected, showContact, setShowContact, heartAnim,
    // [FIX #3] Seller profile
    sellerProfile, sellerListings, loadingSeller, viewSellerProfile,
    search, setSearch, category, setCategory,
    priceRange, setPriceRange, sort, setSort,
    showFilters, setShowFilters,
    images, setImages, result, setResult,
    listingStep, setListingStep, condition, setCondition,
    answers, setAnswers, listingData, setListingData,
    publishing, publishListing, startListing, selectCondition,
    analyzeImage, handleFile, startCamera, capture, stopCamera,
    showFlash, capturedImageRef,
    conversations, activeChat, setActiveChat,
    messages, setMessages, newMessage, setNewMessage,
    sendingMessage, sendMessage, unreadCount,
    loadMessages, startConversation, loadConversations,
    messagesEndRef,
    error, setError, toast, setToast, showToastMsg,
    soundEnabled, setSoundEnabled, playSound,
    fileRef, videoRef, canvasRef,
  };

  // ─── LISTING FLOW HELPERS ──────────────────────────

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

  // Re-assign to value after defining
  value.startListing = startListing;
  value.selectCondition = selectCondition;

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
