import React, { useEffect, useRef, useState } from 'react';
import {
  MessageCircle, ChevronRight, ChevronLeft,
  DollarSign, Loader2, Send, Check, CheckCheck,
  X, ArrowDown, Shield, Search, PlusCircle,
  Video, Phone, MoreVertical, Camera,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Btn, FadeIn, SlideUp } from '../components/ui';
import { formatPrice, formatMessageTime } from '../lib/utils';

// ─── Stitch design tokens ─────────────────────────────────────────────────────
// surface-dim:             #131313  — page / inbox background
// surface-container-low:  #1c1b1b  — selected inbox row, cards
// surface-container:       #201f1f  — mid-level containers
// surface-container-high:  #2a2a2a  — incoming bubbles, hover states
// surface-container-lowest:#0e0e0e  — messages area background, composer bg
// primary:                 #6FEEE1  — teal accent
// primary-container:       #4FD1C5  — gradient end
// on-primary:              #003733  — text on teal (dark green)
// on-surface:              #e5e2e1  — primary text
// on-surface-variant:      #bbc9c7  — secondary text
// outline-variant:         #3c4947  — borders

const C = {
  surfaceDim:     '#131313',
  surfaceLow:     '#1c1b1b',
  surface:        '#201f1f',
  surfaceHigh:    '#2a2a2a',
  surfaceLowest:  '#0e0e0e',
  primary:        '#6FEEE1',
  primaryCont:    '#4FD1C5',
  onPrimary:      '#003733',
  onSurface:      '#e5e2e1',
  onSurfaceVar:   '#bbc9c7',
  outline:        '#3c4947',
};

// liquid-gradient: Stitch's signature outgoing bubble — bright teal
const LIQUID_GRADIENT = `linear-gradient(135deg, ${C.primary} 0%, ${C.primaryCont} 100%)`;

// ─── UserAvatar ───────────────────────────────────────────────────────────────
function UserAvatar({ profile, size = 'md', className = '' }) {
  const sizes = { xs: 'w-8 h-8 text-xs', sm: 'w-9 h-9 text-xs', md: 'w-12 h-12 text-sm', lg: 'w-14 h-14 text-base' };
  const sz = sizes[size] || sizes.md;
  const initials = (profile?.full_name || '?')
    .split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  if (profile?.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        alt={profile.full_name || ''}
        className={`${sz} rounded-full object-cover flex-shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      className={`${sz} rounded-full flex items-center justify-center font-bold flex-shrink-0 ${className}`}
      style={{ background: LIQUID_GRADIENT, color: C.onPrimary }}
    >
      {initials}
    </div>
  );
}

// ─── OfferSheet ───────────────────────────────────────────────────────────────
function OfferSheet({ listing, lang, rtl, onClose, onSend }) {
  const [amount, setAmount] = useState('');
  const [error, setError]   = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  const handleSend = () => {
    const parsed = parseInt(amount.replace(/[^0-9]/g, ''), 10);
    if (!parsed || parsed <= 0) {
      setError(lang === 'he' ? 'נא הכנס סכום תקין' : 'Please enter a valid amount');
      return;
    }
    if (navigator.vibrate) navigator.vibrate(10);
    onSend(parsed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <SlideUp className="w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div
          className="rounded-t-[2rem] p-6 space-y-5"
          style={{ background: `linear-gradient(180deg,${C.surfaceLow} 0%,${C.surfaceLowest} 100%)` }}
          dir={rtl ? 'rtl' : 'ltr'}
        >
          <div className="w-12 h-1 rounded-full mx-auto" style={{ background: C.surfaceHigh }} />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" style={{ color: C.primary }} />
              <h3 className="text-lg font-bold" style={{ fontFamily: 'Manrope,sans-serif', color: C.onSurface }}>
                {lang === 'he' ? 'שלח הצעת מחיר' : 'Make an Offer'}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: C.surfaceHigh }}
            >
              <X className="w-4 h-4" style={{ color: C.onSurfaceVar }} />
            </button>
          </div>

          {listing && (
            <div
              className="flex items-center gap-3 p-3 rounded-2xl"
              style={{ background: C.surfaceHigh, border: `1px solid ${C.outline}` }}
            >
              {listing.images?.[0] && (
                <img src={listing.images[0]} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate" style={{ color: C.onSurface }}>
                  {lang === 'he' && listing.title_hebrew ? listing.title_hebrew : listing.title}
                </p>
                <p className="text-xs mt-0.5" style={{ color: C.onSurfaceVar }}>
                  {lang === 'he' ? 'מחיר מבוקש: ' : 'Listed at '}
                  <span className="font-semibold text-green-400">{formatPrice(listing.price)}</span>
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium" style={{ color: C.onSurfaceVar }}>
              {lang === 'he' ? 'הצעה שלך' : 'Your offer'}
            </label>
            <div className="relative flex items-center">
              <span
                className="absolute text-xl font-bold pointer-events-none"
                style={{ [rtl ? 'right' : 'left']: '16px', color: C.onSurfaceVar }}
              >₪</span>
              <input
                ref={inputRef}
                type="number" inputMode="numeric"
                value={amount}
                onChange={e => { setAmount(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="0" min="1"
                className={`w-full py-4 ${rtl ? 'pr-10 pl-4' : 'pl-10 pr-4'} rounded-2xl text-2xl font-bold text-center focus:outline-none transition-colors`}
                style={{
                  background: C.surfaceHigh,
                  border: `1px solid ${C.outline}`,
                  color: amount && parseInt(amount, 10) > 0 ? C.primary : C.onSurface,
                }}
                dir="ltr"
              />
            </div>
            {error && <p className="text-red-400 text-xs px-1">{error}</p>}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-3.5 rounded-xl text-sm font-medium transition-all active:scale-[0.97]"
              style={{ background: C.surfaceHigh, color: C.onSurfaceVar }}
            >
              {lang === 'he' ? 'ביטול' : 'Cancel'}
            </button>
            <button
              onClick={handleSend}
              disabled={!amount || parseInt(amount, 10) <= 0}
              className="flex-1 py-3.5 rounded-xl text-sm font-bold transition-all active:scale-[0.97] disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: LIQUID_GRADIENT, color: C.onPrimary }}
            >
              <DollarSign className="w-4 h-4" />
              {lang === 'he' ? 'שלח הצעה' : 'Send Offer'}
            </button>
          </div>
        </div>
      </SlideUp>
    </div>
  );
}

// ─── Image message marker ─────────────────────────────────────────────────────
// Messages sent with an attached photo are stored as `__chat_img__<url>`.
// ChatView detects this prefix and renders an image bubble instead of text.
const IMG_PREFIX = '__chat_img__';

// ─── CallStubModal ────────────────────────────────────────────────────────────
// Architecture stub for future WebRTC integration.
// handleStartVideoCall / handleStartVoiceCall are prepared in ChatView;
// this modal confirms the feature is recognised but not yet wired.
function CallStubModal({ type, lang, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-6 p-7 rounded-3xl text-center w-full max-w-[320px]"
        style={{ background: C.surfaceLow, boxShadow: '0 20px 60px rgba(0,0,0,0.55)' }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
          style={{ background: 'rgba(111,238,225,0.08)' }}
        >
          {type === 'video'
            ? <Video className="w-8 h-8" style={{ color: C.primary }} />
            : <Phone className="w-8 h-8" style={{ color: C.primary }} />
          }
        </div>
        <h3
          className="font-bold text-lg mb-2"
          style={{ fontFamily: 'Manrope,sans-serif', color: C.onSurface }}
        >
          {type === 'video'
            ? (lang === 'he' ? 'שיחת וידאו' : 'Video Call')
            : (lang === 'he' ? 'שיחת קול' : 'Voice Call')
          }
        </h3>
        <p className="text-sm mb-5" style={{ color: C.onSurfaceVar }}>
          {lang === 'he' ? 'תכונה זו תגיע בקרוב' : 'This feature is coming soon.'}
        </p>
        <button
          onClick={onClose}
          className="w-full py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98]"
          style={{ background: C.surfaceHigh, color: C.onSurfaceVar }}
        >
          {lang === 'he' ? 'סגור' : 'Close'}
        </button>
      </div>
    </div>
  );
}

// ─── DateSeparator ────────────────────────────────────────────────────────────
function DateSeparator({ date, lang }) {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  let label;
  if (d.toDateString() === today.toDateString()) {
    label = lang === 'he' ? 'היום' : 'Today';
  } else if (d.toDateString() === yesterday.toDateString()) {
    label = lang === 'he' ? 'אתמול' : 'Yesterday';
  } else {
    label = d.toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', { month: 'short', day: 'numeric' });
  }
  return (
    <div className="flex justify-center my-5">
      <span
        className="px-4 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full"
        style={{ background: C.surfaceHigh, color: C.onSurfaceVar }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── InboxView ────────────────────────────────────────────────────────────────
export function InboxView() {
  const {
    t, lang, rtl, user, conversations, conversationsLoading,
    setActiveChat, loadMessages, setView, goTab,
  } = useApp();

  const [search, setSearch] = useState('');

  if (!user) {
    return (
      <div className="space-y-4">
        <FadeIn>
          <h2 className="text-2xl font-extrabold" style={{ fontFamily: 'Manrope,sans-serif', color: C.onSurface }}>
            {lang === 'he' ? 'הודעות' : 'Messages'}
          </h2>
        </FadeIn>
        <FadeIn className="text-center py-16">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'rgba(111,238,225,0.08)' }}
          >
            <MessageCircle className="w-10 h-10" style={{ color: C.primary }} />
          </div>
          <p className="mb-5" style={{ color: C.onSurfaceVar }}>
            {lang === 'he' ? 'התחבר כדי לראות הודעות' : 'Sign in to see messages'}
          </p>
          <Btn primary onClick={() => goTab('profile')}>{t.signIn}</Btn>
        </FadeIn>
      </div>
    );
  }

  const openConv = (conv) => {
    const otherUser = conv.buyer_id === user.id ? conv.seller : conv.buyer;
    setActiveChat({ ...conv, otherUser });
    loadMessages(conv.id);
    setView('chat');
  };

  const filtered = search.trim()
    ? conversations.filter(conv => {
        const q = search.toLowerCase();
        const other = conv.buyer_id === user.id ? conv.seller : conv.buyer;
        return (
          other?.full_name?.toLowerCase().includes(q) ||
          conv.listing?.title?.toLowerCase().includes(q) ||
          conv.listing?.title_hebrew?.toLowerCase().includes(q)
        );
      })
    : conversations;

  return (
    <div className="space-y-6">
      <FadeIn>
        <h2 className="text-2xl font-extrabold" style={{ fontFamily: 'Manrope,sans-serif', color: C.onSurface }}>
          {lang === 'he' ? 'הודעות' : 'Messages'}
        </h2>
      </FadeIn>

      {/* Search — shown when enough conversations to search */}
      {conversations.length > 2 && (
        <FadeIn>
          <div className="relative">
            <Search
              className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'right-4' : 'left-4'} w-5 h-5 pointer-events-none`}
              style={{ color: C.onSurfaceVar }}
            />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={lang === 'he' ? 'חפש שיחות...' : 'Search conversations...'}
              className={`w-full py-3 ${rtl ? 'pr-12 pl-4' : 'pl-12 pr-4'} rounded-xl text-sm focus:outline-none transition-all`}
              style={{
                background: C.surfaceLowest,
                color: C.onSurface,
                border: 'none',
              }}
              dir={rtl ? 'rtl' : 'ltr'}
            />
          </div>
        </FadeIn>
      )}

      {/* Skeleton */}
      {conversationsLoading && conversations.length === 0 ? (
        <div className="space-y-1">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="flex items-center gap-4 p-4 rounded-2xl animate-pulse"
              style={{ background: C.surfaceLow }}
            >
              <div className="w-12 h-12 rounded-full flex-shrink-0" style={{ background: C.surfaceHigh }} />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 rounded w-1/3" style={{ background: C.surfaceHigh }} />
                <div className="h-3 rounded w-2/3" style={{ background: C.surfaceHigh }} />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        search ? (
          <FadeIn className="text-center py-10">
            <p className="text-sm" style={{ color: C.onSurfaceVar }}>
              {lang === 'he' ? 'לא נמצאו שיחות' : 'No conversations found'}
            </p>
          </FadeIn>
        ) : (
          <FadeIn className="text-center py-16">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4" style={{ background: C.surfaceLow }}>
              <MessageCircle className="w-10 h-10" style={{ color: C.surfaceHigh }} />
            </div>
            <p className="font-semibold mb-2" style={{ color: C.onSurface }}>
              {lang === 'he' ? 'אין הודעות עדיין' : 'No messages yet'}
            </p>
            <p className="text-sm mb-5" style={{ color: C.onSurfaceVar }}>
              {lang === 'he' ? 'התחל שיחה עם מוכר' : 'Start a conversation with a seller'}
            </p>
            <Btn primary onClick={() => goTab('browse')}>
              {lang === 'he' ? 'חפש פריטים' : 'Browse Items'}
            </Btn>
          </FadeIn>
        )
      ) : (
        /* Conversation list */
        <div className="space-y-1">
          {filtered.map(conv => {
            const otherUser  = conv.buyer_id === user.id ? conv.seller : conv.buyer;
            const lastMsg    = conv.messages?.[0] ?? null;
            const convUnread = conv.messages?.filter(m => !m.is_read && m.sender_id !== user.id).length || 0;
            const lastText   = lastMsg?.is_offer
              ? `💰 ₪${lastMsg.offer_amount}`
              : lastMsg?.content || (lang === 'he' ? 'שיחה חדשה' : 'New conversation');
            const listingTitle = lang === 'he' && conv.listing?.title_hebrew
              ? conv.listing.title_hebrew : conv.listing?.title;

            return (
              <button
                key={conv.id}
                onClick={() => openConv(conv)}
                className="w-full text-left flex items-center gap-4 p-4 rounded-2xl transition-all active:scale-[0.99]"
                style={{ background: convUnread > 0 ? C.surfaceLow : 'transparent' }}
                onMouseEnter={e => (e.currentTarget.style.background = C.surfaceLow)}
                onMouseLeave={e => (e.currentTarget.style.background = convUnread > 0 ? C.surfaceLow : 'transparent')}
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <UserAvatar profile={otherUser} size="md" />
                  {/* Online dot — styled same as Stitch */}
                  <div
                    className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2"
                    style={{
                      background: convUnread > 0 ? C.primary : C.surfaceHigh,
                      borderColor: C.surfaceDim,
                    }}
                  />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <span
                      className="font-semibold truncate text-sm"
                      style={{
                        fontFamily: 'Manrope,sans-serif',
                        color: convUnread > 0 ? C.onSurface : C.onSurfaceVar,
                      }}
                    >
                      {otherUser?.full_name || (lang === 'he' ? 'משתמש' : 'User')}
                    </span>
                    <span
                      className="text-[10px] uppercase tracking-wider flex-shrink-0 ml-2"
                      style={{ color: C.onSurfaceVar }}
                    >
                      {lastMsg ? formatMessageTime(lastMsg.created_at, lang) : ''}
                    </span>
                  </div>
                  {listingTitle && (
                    <p className="text-[11px] truncate mt-0.5" style={{ color: C.onSurfaceVar }}>
                      {listingTitle}
                    </p>
                  )}
                  <p
                    className="text-sm truncate mt-0.5"
                    style={{ color: convUnread > 0 ? C.primary : `${C.onSurfaceVar}cc` }}
                  >
                    {lastText}
                  </p>
                  {/* Status pill */}
                  {convUnread > 0 && (
                    <div className="flex gap-2 mt-2">
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{ background: `${C.primary}1a`, color: C.primary }}
                      >
                        {convUnread} {lang === 'he' ? 'חדשות' : 'new'}
                      </span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── ChatView ─────────────────────────────────────────────────────────────────
export function ChatView() {
  const {
    lang, rtl, user, activeChat, setActiveChat, setView, setSelected,
    messages, messagesLoading, newMessage, setNewMessage,
    sendMessage, sendingMessage, sendChatImageMessage, messagesEndRef,
  } = useApp();

  const [showOfferSheet,   setShowOfferSheet]   = useState(false);
  const [showNewMsgBanner, setShowNewMsgBanner] = useState(false);
  const [callModal,        setCallModal]        = useState(null);   // 'video' | 'voice' | null
  const [imgPreview,       setImgPreview]       = useState(null);   // { file, dataUrl }
  const [uploadingImage,   setUploadingImage]   = useState(false);

  const containerRef  = useRef(null);
  const scrollRef     = useRef(null);
  const nearBottomRef = useRef(true);
  const prevMsgCount  = useRef(0);
  const fileInputRef  = useRef(null);
  const textareaRef   = useRef(null);

  // ── iOS keyboard-safe height — body-lock + height-only strategy ─────────
  //
  // Root cause of the "lift" bug:
  //   When the keyboard opens, iOS auto-scrolls the layout viewport to show
  //   the focused input. This makes vv.offsetTop > 0 each animation frame as
  //   the keyboard slides up. The previous handler set el.style.top = vv.offsetTop
  //   on every frame — causing the entire container to jitter/jump.
  //
  // Fix:
  //   1. Lock body scroll (position:fixed + overflow:hidden) so iOS cannot shift
  //      vv.offsetTop in the first place. Body stays at y=0 the entire time.
  //   2. Only track vv.height — the container shrinks from the bottom as the
  //      keyboard rises. Composer naturally moves up; header stays pinned at top:0.
  //   3. Never set el.style.top — position:fixed;top:0 already anchors the
  //      container to the visual viewport top when body cannot scroll.
  //   4. Remove the vv 'scroll' listener — no longer relevant with body locked.
  //
  // Debug logs (DEV only): vv.height, window.innerHeight, keyboard height estimate.
  useEffect(() => {
    // Save existing body inline styles so we can restore on unmount
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      width:    document.body.style.width,
      top:      document.body.style.top,
    };
    // Capture current scroll so restore doesn't jump the page
    const scrollY = window.scrollY;

    // Apply scroll lock
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width    = '100%';
    document.body.style.top      = `-${scrollY}px`;

    const vv = window.visualViewport;

    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      // vv.height = visual viewport height excluding keyboard.
      // Falls back to window.innerHeight on browsers without visualViewport.
      const h = vv ? vv.height : window.innerHeight;
      el.style.height = `${h}px`;
      // NEVER touch el.style.top — container stays at top:0.

      if (import.meta.env.DEV) {
        const kb = Math.round(window.innerHeight - h);
        console.log(
          `[Chat/KB] vv.h=${Math.round(h)}  win.h=${window.innerHeight}` +
          `  vv.offsetTop=${vv ? Math.round(vv.offsetTop) : 'n/a'}` +
          `  keyboard≈${kb}px  chat=${activeChat ? 'open' : 'closed'}`
        );
      }
    };

    update();
    // Only listen for resize (keyboard open/close). Scroll never fires now.
    if (vv) vv.addEventListener('resize', update);
    else    window.addEventListener('resize', update);

    return () => {
      // Detach listener
      if (vv) vv.removeEventListener('resize', update);
      else    window.removeEventListener('resize', update);

      // Restore body to its original state and scroll back to where we were
      document.body.style.overflow = prev.overflow;
      document.body.style.position = prev.position;
      document.body.style.width    = prev.width;
      document.body.style.top      = prev.top;
      if (scrollY) window.scrollTo(0, scrollY);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scroll tracking ──────────────────────────────────────────────────────
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottomRef.current) setShowNewMsgBanner(false);
  };

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    const count = messages.length;
    if (count === 0) { prevMsgCount.current = 0; return; }
    const isInitial = prevMsgCount.current === 0;
    const hasNew    = count > prevMsgCount.current;
    prevMsgCount.current = count;
    if (isInitial) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
      return;
    }
    if (!hasNew) return;
    const fromMe = messages[count - 1]?.sender_id === user?.id;
    if (nearBottomRef.current || fromMe) {
      messagesEndRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } else {
      setShowNewMsgBanner(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  if (!activeChat) return null;

  const otherUser = activeChat.otherUser ?? activeChat.seller ?? null;
  const listing   = activeChat.listing ?? null;

  const goToListing = () => { if (listing) { setSelected(listing); setView('detail'); } };

  // ── Send handlers ────────────────────────────────────────────────────────
  const handleSend = () => {
    if (imgPreview) { handleImageSend(); return; }
    if (!newMessage.trim() || sendingMessage) return;
    if (navigator.vibrate) navigator.vibrate(10);
    sendMessage(newMessage);
  };

  const handleOfferSend = (amount) => {
    sendMessage(
      lang === 'he' ? `אני מציע ₪${amount.toLocaleString()}` : `I offer ₪${amount.toLocaleString()}`,
      true, amount,
    );
    setShowOfferSheet(false);
  };

  // ── Image upload ─────────────────────────────────────────────────────────
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setImgPreview({ file, dataUrl: ev.target.result });
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleImageSend = async () => {
    if (!imgPreview || uploadingImage) return;
    setUploadingImage(true);
    try {
      await sendChatImageMessage(imgPreview.file);
      setImgPreview(null);
    } catch (err) {
      console.error('[Chat] Image send failed:', err);
    }
    setUploadingImage(false);
  };

  // ── Textarea focus — freeze message list scroll position ─────────────────
  // When the textarea is focused on iOS, the browser may call scrollIntoView
  // internally, which can jerk the message list. We snapshot the current
  // scrollTop and restore it in the next frame so it stays put.
  const handleTextareaFocus = () => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = top; });
  };

  // ── Call stubs (future WebRTC integration) ────────────────────────────────
  const handleStartVideoCall = () => setCallModal('video');
  const handleStartVoiceCall = () => setCallModal('voice');

  // ── Textarea auto-grow ───────────────────────────────────────────────────
  const handleTextareaInput = (e) => {
    setNewMessage(e.target.value);
    e.target.style.height = '';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  // ── Message grouping + date separators ───────────────────────────────────
  const grouped = messages.map((msg, i) => ({
    ...msg,
    isStart: messages[i - 1]?.sender_id !== msg.sender_id,
    isEnd:   messages[i + 1]?.sender_id !== msg.sender_id,
  }));

  const groupedWithDates = [];
  let lastDateStr = null;
  grouped.forEach(msg => {
    const dateStr = new Date(msg.created_at).toDateString();
    if (dateStr !== lastDateStr) {
      groupedWithDates.push({ _type: 'date', date: msg.created_at, _key: `date-${msg.created_at}` });
      lastDateStr = dateStr;
    }
    groupedWithDates.push({ _type: 'msg', ...msg });
  });

  const canSend = !uploadingImage && !sendingMessage && (!!imgPreview || !!newMessage.trim());

  return (
    <div
      ref={containerRef}
      className="fixed left-0 right-0 z-[45] flex flex-col"
      style={{
        top: 0,
        height: '100dvh',   // JS overrides this with vv.height when keyboard opens
        background: C.surfaceDim,
        paddingLeft:  'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        // Prevent the container itself from becoming a scroll origin on iOS.
        // The message list has its own overflow-y-auto; nothing else should scroll.
        touchAction: 'pan-y',
        overscrollBehavior: 'none',
      }}
    >

      {/* ── Chat Header — glass, avatar + online dot, name, call stubs ── */}
      <div
        className="flex-shrink-0 flex items-center gap-2 px-3"
        style={{
          paddingTop: 'max(env(safe-area-inset-top),12px)',
          paddingBottom: '12px',
          background: 'rgba(19,19,19,0.92)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: `1px solid rgba(60,73,71,0.28)`,
          boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        }}
      >
        {/* Back */}
        <button
          onClick={() => { setActiveChat(null); setView('inbox'); }}
          className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform"
          style={{ color: C.onSurfaceVar }}
          aria-label={lang === 'he' ? 'חזור' : 'Back'}
        >
          {rtl ? <ChevronRight className="w-6 h-6" /> : <ChevronLeft className="w-6 h-6" />}
        </button>

        {/* Avatar + online indicator */}
        <div className="relative flex-shrink-0">
          <UserAvatar profile={otherUser} size="sm" />
          <div
            className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2"
            style={{ background: C.primary, borderColor: C.surfaceDim }}
          />
        </div>

        {/* Name + active status */}
        <div className="flex-1 min-w-0 px-1">
          <div className="flex items-center gap-1.5">
            <p
              className="font-bold text-[15px] truncate leading-tight"
              style={{ fontFamily: 'Manrope,sans-serif', color: C.onSurface }}
            >
              {otherUser?.full_name || (lang === 'he' ? 'משתמש' : 'User')}
            </p>
            {otherUser?.is_verified && (
              <Shield className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.primary }} />
            )}
          </div>
          <p className="text-[11px] font-medium" style={{ color: C.primary }}>
            {lang === 'he' ? 'פעיל עכשיו' : 'Active now'}
          </p>
        </div>

        {/* Call stub buttons + overflow */}
        <div className="flex items-center gap-0 flex-shrink-0">
          <button
            onClick={handleStartVideoCall}
            className="w-10 h-10 flex items-center justify-center rounded-full transition-colors active:scale-90"
            style={{ color: C.primary }}
            aria-label={lang === 'he' ? 'שיחת וידאו' : 'Video call'}
          >
            <Video className="w-5 h-5" />
          </button>
          <button
            onClick={handleStartVoiceCall}
            className="w-10 h-10 flex items-center justify-center rounded-full transition-colors active:scale-90"
            style={{ color: C.primary }}
            aria-label={lang === 'he' ? 'שיחת קול' : 'Voice call'}
          >
            <Phone className="w-5 h-5" />
          </button>
          <button
            className="w-10 h-10 flex items-center justify-center rounded-full transition-colors active:scale-90"
            style={{ color: C.onSurfaceVar }}
            aria-label={lang === 'he' ? 'אפשרויות' : 'More options'}
          >
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── Listing context strip ── */}
      {listing && (
        <button
          onClick={goToListing}
          className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-white/[0.02]"
          style={{
            background: C.surfaceLow,
            borderBottom: `1px solid rgba(60,73,71,0.22)`,
          }}
        >
          {listing.images?.[0] && (
            <img src={listing.images[0]} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: `${C.onSurfaceVar}88` }}>
              {lang === 'he' ? 'פריט בשיחה' : 'Item in thread'}
            </p>
            <p className="text-sm font-semibold truncate" style={{ fontFamily: 'Manrope,sans-serif', color: C.onSurface }}>
              {lang === 'he' && listing.title_hebrew ? listing.title_hebrew : listing.title}
            </p>
            {listing.price && (
              <p className="text-[11px] font-bold" style={{ color: C.primary }}>
                {formatPrice(listing.price)}
              </p>
            )}
          </div>
          <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: C.onSurfaceVar }} />
        </button>
      )}

      {/* ── Messages area ── */}
      <div className="relative flex-1 min-h-0" style={{ background: C.surfaceLowest }}>
        {/* Radial dot pattern — "Intelligent Void" texture */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle, rgba(111,238,225,0.055) 1px, transparent 1px)`,
            backgroundSize: '28px 28px',
          }}
        />
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="absolute inset-0 overflow-y-auto py-4"
          style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
        >
          {/* Loading skeleton */}
          {messagesLoading && messages.length === 0 ? (
            <div className="space-y-4 px-4">
              {[{ a: 'start', w: '62%' }, { a: 'end', w: '48%' }, { a: 'start', w: '72%' }, { a: 'end', w: '52%' }].map((s, i) => (
                <div key={i} className={`flex items-end gap-3 ${s.a === 'end' ? 'justify-end' : 'justify-start'}`}>
                  {s.a === 'start' && <div className="w-8 h-8 rounded-full animate-pulse flex-shrink-0" style={{ background: C.surfaceHigh }} />}
                  <div
                    className="rounded-2xl px-5 py-4 space-y-2 animate-pulse"
                    style={{ width: s.w, minWidth: '80px', background: s.a === 'end' ? 'rgba(79,209,197,0.15)' : C.surfaceHigh }}
                  >
                    <div className="h-3 rounded w-full" style={{ background: C.surfaceLow }} />
                    {i % 2 === 0 && <div className="h-3 rounded w-3/5" style={{ background: C.surfaceLow }} />}
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center min-h-[280px] text-center py-10 px-6">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: C.surfaceLow }}
              >
                <MessageCircle className="w-8 h-8" style={{ color: C.surfaceHigh }} />
              </div>
              <p className="font-semibold text-sm mb-2" style={{ color: C.onSurface }}>
                {lang === 'he' ? 'התחל את השיחה' : 'Start the conversation'}
              </p>
              <p className="text-xs leading-relaxed mb-5 max-w-[200px]" style={{ color: C.onSurfaceVar }}>
                {lang === 'he'
                  ? 'שאל על זמינות, מצב הפריט, או שלח הצעת מחיר.'
                  : 'Ask about availability, condition, or make an offer.'}
              </p>
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(111,238,225,0.06)', border: '1px solid rgba(111,238,225,0.16)' }}
              >
                <Shield className="w-3 h-3 flex-shrink-0" style={{ color: C.primary }} />
                <p className="text-[10px]" style={{ color: C.onSurfaceVar }}>
                  {lang === 'he' ? 'שלם רק לאחר קבלת הפריט' : 'Pay only after receiving the item'}
                </p>
              </div>
            </div>
          ) : null}

          {/* Message bubbles with date separators */}
          <div className="space-y-[3px] px-3">
            {groupedWithDates.map((item, idx) => {
              // Date separator row
              if (item._type === 'date') {
                return <DateSeparator key={item._key || `date-${idx}`} date={item.date} lang={lang} />;
              }

              const msg     = item;
              const isMe    = msg.sender_id === user.id;
              const isOffer = !!(msg.is_offer && msg.offer_amount);
              const isImage = typeof msg.content === 'string' && msg.content.startsWith(IMG_PREFIX);

              // ── Offer bubble ──
              if (isOffer) {
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start items-end gap-2.5'} ${msg.isStart ? 'mt-5' : 'mt-[3px]'}`}>
                    {!isMe && <div className="w-8 h-8 flex-shrink-0" />}
                    <div
                      className="max-w-[72%] rounded-2xl overflow-hidden"
                      style={{
                        border: '1.5px solid rgba(251,191,36,0.38)',
                        background: isMe ? 'rgba(251,191,36,0.09)' : 'rgba(251,191,36,0.06)',
                      }}
                    >
                      <div className="px-4 pt-3.5 pb-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-xs">💰</span>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                            {lang === 'he' ? 'הצעת מחיר' : 'Price Offer'}
                          </span>
                        </div>
                        <p className="text-2xl font-bold text-amber-300 leading-none">
                          ₪{msg.offer_amount.toLocaleString()}
                        </p>
                        {msg.content && !msg.content.startsWith('אני מציע') && !msg.content.startsWith('I offer') && (
                          <p className="text-xs leading-relaxed mt-1.5" dir="auto" style={{ color: C.onSurfaceVar }}>
                            {msg.content}
                          </p>
                        )}
                        <div className={`flex items-center gap-1 mt-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
                          <span className="text-[10px]" style={{ color: C.onSurfaceVar }}>
                            {formatMessageTime(msg.created_at, lang)}
                          </span>
                          {isMe && (msg.is_read
                            ? <CheckCheck className="w-3 h-3" style={{ color: C.primary }} />
                            : <Check className="w-3 h-3 text-white/25" />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              // ── Image bubble ──
              if (isImage) {
                const imageUrl = msg.content.slice(IMG_PREFIX.length);
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isMe ? 'justify-end' : 'justify-start items-end gap-2.5'} ${msg.isStart ? 'mt-5' : 'mt-[3px]'}`}
                  >
                    {!isMe && (
                      msg.isEnd
                        ? <UserAvatar profile={otherUser} size="xs" />
                        : <div className="w-8 h-8 flex-shrink-0" />
                    )}
                    <div
                      className={`max-w-[68%] overflow-hidden ${
                        isMe
                          ? `rounded-2xl ${msg.isEnd ? 'rounded-br-[4px]' : ''}`
                          : `rounded-2xl ${msg.isEnd ? 'rounded-bl-[4px]' : ''}`
                      }`}
                      style={{
                        border: '1px solid rgba(111,238,225,0.12)',
                        boxShadow: isMe ? '0 4px 20px rgba(111,238,225,0.10)' : 'none',
                      }}
                    >
                      <img
                        src={imageUrl}
                        alt={lang === 'he' ? 'תמונה' : 'Photo'}
                        className="w-full block object-cover"
                        style={{ maxHeight: '240px' }}
                        onError={e => { e.currentTarget.style.display = 'none'; }}
                      />
                      {msg.isEnd && (
                        <div
                          className={`flex items-center gap-1 px-3 py-1.5 ${isMe ? 'justify-end' : 'justify-start'}`}
                          style={{ background: isMe ? 'rgba(111,238,225,0.14)' : C.surfaceHigh }}
                        >
                          <span className="text-[10px]" style={{ color: isMe ? `${C.onPrimary}99` : C.onSurfaceVar }}>
                            {formatMessageTime(msg.created_at, lang)}
                          </span>
                          {isMe && (msg.is_read
                            ? <CheckCheck className="w-3 h-3" style={{ color: C.primary }} />
                            : <Check className="w-3 h-3" style={{ color: `${C.onPrimary}60` }} />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              // ── Text bubble ──
              const isIncomingEnd = !isMe && msg.isEnd;

              return (
                <div
                  key={msg.id}
                  className={`flex ${isMe ? 'justify-end' : 'justify-start items-end gap-2.5'} ${msg.isStart ? 'mt-5' : 'mt-[3px]'}`}
                >
                  {!isMe && (
                    isIncomingEnd
                      ? <UserAvatar profile={otherUser} size="xs" />
                      : <div className="w-8 h-8 flex-shrink-0" />
                  )}

                  {/* Bubble */}
                  <div
                    className={`max-w-[75%] px-4 py-3 ${
                      isMe
                        ? `rounded-2xl ${msg.isEnd ? 'rounded-br-[4px]' : ''}`
                        : `rounded-2xl ${msg.isEnd ? 'rounded-bl-[4px]' : ''}`
                    }`}
                    style={
                      isMe
                        ? {
                            background: LIQUID_GRADIENT,
                            color: C.onPrimary,
                            boxShadow: `0 4px 20px rgba(111,238,225,0.15)`,
                          }
                        : {
                            background: C.surfaceHigh,
                            color: C.onSurface,
                          }
                    }
                  >
                    {/* dir=auto: browser auto-detects Hebrew vs English */}
                    <p className="text-[15px] leading-relaxed" dir="auto">{msg.content}</p>
                    {msg.isEnd && (
                      <div className={`flex items-center gap-1 mt-1.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <span
                          className="text-[10px]"
                          style={{ color: isMe ? `${C.onPrimary}99` : C.onSurfaceVar }}
                        >
                          {formatMessageTime(msg.created_at, lang)}
                        </span>
                        {isMe && (msg.is_read
                          ? <CheckCheck className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.onPrimary }} />
                          : <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color: `${C.onPrimary}70` }} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div ref={messagesEndRef} className="h-2" />
        </div>

        {/* "New message" jump pill */}
        {showNewMsgBanner && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-3 z-10">
            <button
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold shadow-lg active:scale-95 transition-all"
              style={{ background: LIQUID_GRADIENT, color: C.onPrimary }}
              onClick={() => { messagesEndRef?.current?.scrollIntoView({ behavior: 'smooth' }); setShowNewMsgBanner(false); }}
            >
              <ArrowDown className="w-3.5 h-3.5" />
              {lang === 'he' ? 'הודעה חדשה' : 'New message'}
            </button>
          </div>
        )}
      </div>

      {/* ── Quick-reply chips ── */}
      <div
        className="flex-shrink-0 flex gap-2 px-4 py-2.5 overflow-x-auto"
        style={{
          background: C.surfaceLow,
          borderTop: `1px solid rgba(60,73,71,0.22)`,
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {[
          { text: lang === 'he' ? 'עדיין זמין?' : 'Still available?', icon: '❓' },
          { text: lang === 'he' ? 'מחיר סופי?'  : 'Best price?',     icon: '💰' },
          { text: lang === 'he' ? 'איפה למסור?' : 'Where to meet?',  icon: '📍' },
        ].map((q, i) => (
          <button
            key={i}
            onClick={() => { if (navigator.vibrate) navigator.vibrate(10); sendMessage(q.text); }}
            className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs whitespace-nowrap active:scale-95 transition-all"
            style={{ background: C.surfaceHigh, color: C.onSurfaceVar }}
          >
            {q.icon} {q.text}
          </button>
        ))}
      </div>

      {/* ── Image preview strip (shown above composer when photo selected) ── */}
      {imgPreview && (
        <div
          className="flex-shrink-0 flex items-center gap-3 px-4 py-2.5"
          style={{
            background: C.surfaceLow,
            borderTop: `1px solid rgba(60,73,71,0.22)`,
          }}
        >
          <img src={imgPreview.dataUrl} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold" style={{ color: C.onSurface }}>
              {lang === 'he' ? 'תמונה מוכנה' : 'Photo ready'}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: C.onSurfaceVar }}>
              {lang === 'he' ? 'לחץ שלח לשיתוף' : 'Tap send to share'}
            </p>
          </div>
          <button
            onClick={() => setImgPreview(null)}
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: C.surfaceHigh }}
            aria-label={lang === 'he' ? 'בטל תמונה' : 'Cancel photo'}
          >
            <X className="w-3.5 h-3.5" style={{ color: C.onSurfaceVar }} />
          </button>
        </div>
      )}

      {/* ── Composer ── glass surface, textarea + camera, rounded send ── */}
      <div
        className="flex-shrink-0 px-3 flex items-end gap-2"
        style={{
          paddingTop: '10px',
          paddingBottom: 'max(env(safe-area-inset-bottom),10px)',
          background: 'rgba(28,27,27,0.97)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderTop: `1px solid rgba(60,73,71,0.18)`,
        }}
      >
        {/* + button → offer sheet */}
        <button
          onClick={() => setShowOfferSheet(true)}
          className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full transition-all active:scale-90"
          style={{ background: C.surfaceHigh, color: C.primary }}
          aria-label={lang === 'he' ? 'הצעת מחיר' : 'Make offer'}
        >
          <PlusCircle className="w-5 h-5" />
        </button>

        {/* Textarea + camera wrapper */}
        <div
          className="flex-1 flex items-end rounded-2xl transition-all"
          style={{
            background: C.surfaceLowest,
            border: '1px solid rgba(255,255,255,0.04)',
            padding: '6px 8px 6px 14px',
          }}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            value={newMessage}
            onChange={handleTextareaInput}
            onFocus={handleTextareaFocus}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder={lang === 'he' ? 'כתוב הודעה...' : 'Message…'}
            className="flex-1 bg-transparent border-none text-[15px] focus:outline-none focus:ring-0 py-1.5 resize-none overflow-hidden"
            style={{ color: C.onSurface, maxHeight: '120px', lineHeight: '1.45' }}
            dir={rtl ? 'rtl' : 'ltr'}
          />
          {/* Camera / gallery button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-colors active:scale-90 mb-0.5"
            style={{ color: imgPreview ? C.primary : C.onSurfaceVar }}
            aria-label={lang === 'he' ? 'שלח תמונה' : 'Send photo'}
          >
            <Camera className="w-5 h-5" />
          </button>
        </div>

        {/* Send button — round, gradient glow when active */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 disabled:opacity-30"
          style={{
            background: canSend ? LIQUID_GRADIENT : C.surfaceHigh,
            color:      canSend ? C.onPrimary     : C.onSurfaceVar,
            boxShadow:  canSend ? '0 4px 20px rgba(111,238,225,0.30)' : 'none',
          }}
          aria-label={lang === 'he' ? 'שלח' : 'Send'}
        >
          {uploadingImage || sendingMessage
            ? <Loader2 className="w-5 h-5 animate-spin" />
            : <Send className="w-5 h-5" style={{ transform: rtl ? 'scaleX(-1)' : 'none' }} />
          }
        </button>

        {/* Hidden file input for image picker */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* ── Modals ── */}
      {showOfferSheet && (
        <OfferSheet
          listing={listing} lang={lang} rtl={rtl}
          onClose={() => setShowOfferSheet(false)}
          onSend={handleOfferSend}
        />
      )}
      {callModal && (
        <CallStubModal
          type={callModal}
          lang={lang}
          onClose={() => setCallModal(null)}
        />
      )}
    </div>
  );
}
