import React, { useEffect, useRef, useState } from 'react';
import {
  MessageCircle, ChevronRight, ChevronLeft,
  DollarSign, Loader2, Send, Check, CheckCheck,
  X, ArrowDown, Shield, Search,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Btn, FadeIn, SlideUp } from '../components/ui';
import { formatPrice, formatMessageTime } from '../lib/utils';

// ─── Stitch design tokens (from design system) ────────────────────────────────
// surface-container-low: #1c1b1b  — row/item backgrounds
// surface-container:      #201f1f  — card containers
// surface-container-high: #2a2a2a  — hover / active states
// primary (teal):         #6FEEE1
// primary-container:      #4FD1C5
// on-primary:             #003733  — text on teal
// on-surface:             #e5e2e1
// on-surface-variant:     #bbc9c7  — secondary text
// outline-variant:        #3c4947  — subtle borders

const C = {
  surfaceLow:   '#1c1b1b',
  surface:      '#201f1f',
  surfaceHigh:  '#2a2a2a',
  primary:      '#6FEEE1',
  primaryCont:  '#4FD1C5',
  onPrimary:    '#003733',
  onSurface:    '#e5e2e1',
  onSurfaceVar: '#bbc9c7',
  outline:      '#3c4947',
};

// ─── UserAvatar ───────────────────────────────────────────────────────────────
// photo → rounded avatar; fallback → teal initials circle
// size: 'sm' (32px) | 'md' (40px) | 'lg' (48px)
function UserAvatar({ profile, size = 'md', className = '' }) {
  const sizeMap = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base' };
  const sz = sizeMap[size] || sizeMap.md;
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
      style={{ background: `linear-gradient(135deg,${C.primary} 0%,${C.primaryCont} 100%)`, color: C.onPrimary }}
    >
      {initials}
    </div>
  );
}

// ─── ListingContextCard ───────────────────────────────────────────────────────
// Thin tappable strip below chat header — thumbnail · title · price
function ListingContextCard({ listing, lang, onClick }) {
  if (!listing) return null;
  const title = lang === 'he' && listing.title_hebrew ? listing.title_hebrew : listing.title;
  return (
    <button
      onClick={onClick}
      className="w-full flex-shrink-0 flex items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-white/[0.04]"
      style={{
        background: C.surface,
        borderBottom: `1px solid ${C.outline}`,
      }}
    >
      {listing.images?.[0] && (
        <img src={listing.images[0]} alt="" className="w-9 h-9 rounded-xl object-cover flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate leading-tight" style={{ color: C.onSurface }}>
          {title}
        </p>
        {listing.price && (
          <p className="text-[11px] font-bold mt-0.5" style={{ color: C.primary }}>
            {formatPrice(listing.price)}
          </p>
        )}
      </div>
      <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.onSurfaceVar }} />
    </button>
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
          style={{ background: `linear-gradient(180deg, ${C.surfaceLow} 0%, #0a1020 100%)` }}
          dir={rtl ? 'rtl' : 'ltr'}
        >
          <div className="w-12 h-1 bg-white/20 rounded-full mx-auto" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" style={{ color: C.primary }} />
              <h3
                className="text-lg font-bold"
                style={{ fontFamily: 'Manrope, sans-serif', color: C.onSurface }}
              >
                {lang === 'he' ? 'שלח הצעת מחיר' : 'Make an Offer'}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
              style={{ background: C.surfaceHigh }}
            >
              <X className="w-4 h-4" style={{ color: C.onSurfaceVar }} />
            </button>
          </div>

          {listing && (
            <div
              className="flex items-center gap-3 p-3 rounded-2xl"
              style={{ background: C.surface, border: `1px solid ${C.outline}` }}
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
                className={`w-full py-4 ${rtl ? 'pr-10 pl-4' : 'pl-10 pr-4'} rounded-2xl text-2xl font-bold focus:outline-none transition-colors text-center`}
                style={{
                  background: C.surface,
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
              style={{ background: `linear-gradient(135deg,${C.primary} 0%,${C.primaryCont} 100%)`, color: C.onPrimary }}
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
          <h2
            className="text-2xl font-extrabold"
            style={{ fontFamily: 'Manrope, sans-serif', color: C.onSurface }}
          >
            {lang === 'he' ? 'הודעות' : 'Messages'}
          </h2>
        </FadeIn>
        <FadeIn className="text-center py-16">
          <div
            className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4"
            style={{ background: `rgba(111,238,225,0.08)` }}
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

  // Client-side search — name or listing title
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
    <div className="space-y-4">
      <FadeIn>
        <h2
          className="text-2xl font-extrabold"
          style={{ fontFamily: 'Manrope, sans-serif', color: C.onSurface }}
        >
          {lang === 'he' ? 'הודעות' : 'Messages'}
        </h2>
      </FadeIn>

      {/* Search — shown when there are conversations worth searching */}
      {conversations.length > 2 && (
        <FadeIn>
          <div className="relative">
            <Search
              className={`absolute top-1/2 -translate-y-1/2 ${rtl ? 'right-3.5' : 'left-3.5'} w-4 h-4 pointer-events-none`}
              style={{ color: C.onSurfaceVar }}
            />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={lang === 'he' ? 'חפש שיחות...' : 'Search conversations...'}
              className={`w-full h-10 ${rtl ? 'pr-10 pl-4' : 'pl-10 pr-4'} rounded-full text-sm focus:outline-none transition-colors`}
              style={{
                background: C.surfaceLow,
                border: `1px solid ${C.outline}`,
                color: C.onSurface,
              }}
              dir={rtl ? 'rtl' : 'ltr'}
            />
          </div>
        </FadeIn>
      )}

      {conversationsLoading && conversations.length === 0 ? (
        /* Loading skeleton */
        <div className="rounded-2xl overflow-hidden" style={{ background: C.surfaceLow }}>
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-4 animate-pulse ${i > 0 ? 'border-t' : ''}`}
              style={{ borderColor: C.outline }}
            >
              <div className="w-10 h-10 rounded-full flex-shrink-0" style={{ background: C.surfaceHigh }} />
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
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4"
              style={{ background: C.surfaceLow }}
            >
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
        <div className="rounded-2xl overflow-hidden" style={{ background: C.surfaceLow }}>
          {filtered.map((conv, i) => {
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
                className={`w-full text-left flex items-center gap-3 px-4 py-4 transition-colors active:scale-[0.99] ${i > 0 ? 'border-t' : ''}`}
                style={{
                  borderColor: C.outline,
                  background: convUnread > 0 ? 'rgba(111,238,225,0.03)' : 'transparent',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = C.surfaceHigh)}
                onMouseLeave={e => (e.currentTarget.style.background = convUnread > 0 ? 'rgba(111,238,225,0.03)' : 'transparent')}
              >
                {/* Avatar */}
                <UserAvatar profile={otherUser} size="md" />

                {/* Text content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span
                      className="font-semibold text-sm truncate"
                      style={{
                        fontFamily: 'Manrope, sans-serif',
                        color: convUnread > 0 ? '#fff' : C.onSurface,
                      }}
                    >
                      {otherUser?.full_name || (lang === 'he' ? 'משתמש' : 'User')}
                    </span>
                    <span className="text-[10px] flex-shrink-0 ml-2" style={{ color: C.onSurfaceVar }}>
                      {lastMsg ? formatMessageTime(lastMsg.created_at, lang) : ''}
                    </span>
                  </div>
                  {listingTitle && (
                    <p className="text-[11px] truncate mb-0.5" style={{ color: C.onSurfaceVar }}>
                      {listingTitle}
                    </p>
                  )}
                  <p
                    className="text-xs truncate"
                    style={{
                      color: convUnread > 0 ? C.onSurface : C.onSurfaceVar,
                      fontWeight: convUnread > 0 ? 500 : 400,
                    }}
                  >
                    {lastText}
                  </p>
                </div>

                {/* Unread badge */}
                <div className="flex-shrink-0 w-5 flex items-center justify-center">
                  {convUnread > 0 && (
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                      style={{ background: C.primary, color: C.onPrimary }}
                    >
                      {convUnread > 9 ? '9+' : convUnread}
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
    sendMessage, sendingMessage, messagesEndRef,
  } = useApp();

  const [showOfferSheet,   setShowOfferSheet]   = useState(false);
  const [showNewMsgBanner, setShowNewMsgBanner] = useState(false);

  const containerRef  = useRef(null);
  const scrollRef     = useRef(null);
  const nearBottomRef = useRef(true);
  const prevMsgCount  = useRef(0);

  // ── iOS keyboard-safe height (visualViewport) ────────────────────────────
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      el.style.height = `${vv.height}px`;
      el.style.top    = `${vv.offsetTop}px`;
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);

  // ── Scroll tracking ──────────────────────────────────────────────────────
  const onScrollMessages = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottomRef.current) setShowNewMsgBanner(false);
  };

  // ── Auto-scroll on new messages ──────────────────────────────────────────
  useEffect(() => {
    const count = messages.length;
    if (count === 0) { prevMsgCount.current = 0; return; }
    const isInitial = prevMsgCount.current === 0;
    const hasNew    = count > prevMsgCount.current;
    prevMsgCount.current = count;
    if (isInitial) {
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
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

  const otherUser    = activeChat.otherUser ?? activeChat.seller ?? null;
  const listing      = activeChat.listing ?? null;
  const listingTitle = lang === 'he' && listing?.title_hebrew ? listing.title_hebrew : listing?.title;

  const goToListing = () => { if (listing) { setSelected(listing); setView('detail'); } };

  const handleSend = () => {
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

  // ── Message grouping ─────────────────────────────────────────────────────
  const grouped = messages.map((msg, i) => ({
    ...msg,
    isStart: messages[i - 1]?.sender_id !== msg.sender_id,
    isEnd:   messages[i + 1]?.sender_id !== msg.sender_id,
  }));

  // ── Bubble corner shaping ────────────────────────────────────────────────
  const getBubbleRadius = (msg, isMe) => {
    if (msg.is_offer) return '';
    if (isMe) {
      if (!msg.isStart && !msg.isEnd) return 'rounded-2xl rounded-tr-[5px] rounded-br-[5px]';
      if (!msg.isStart)               return 'rounded-2xl rounded-tr-[5px]';
      if (!msg.isEnd)                 return 'rounded-2xl rounded-br-[5px]';
    } else {
      if (!msg.isStart && !msg.isEnd) return 'rounded-2xl rounded-tl-[5px] rounded-bl-[5px]';
      if (!msg.isStart)               return 'rounded-2xl rounded-tl-[5px]';
      if (!msg.isEnd)                 return 'rounded-2xl rounded-bl-[5px]';
    }
    return 'rounded-2xl';
  };

  return (
    <div
      ref={containerRef}
      className="fixed left-0 right-0 z-[45] flex flex-col animate-slideInRight"
      style={{
        top: 0,
        height: '100dvh',
        background: '#111',
        paddingLeft:  'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >

      {/* ── Header ── */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 border-b"
        style={{
          paddingTop: 'max(env(safe-area-inset-top),12px)',
          paddingBottom: '12px',
          background: 'rgba(13,13,13,0.98)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderColor: C.outline,
        }}
      >
        {/* Back */}
        <button
          onClick={() => { setActiveChat(null); setView('inbox'); }}
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
          style={{ background: C.surfaceHigh }}
        >
          {rtl ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>

        {/* Avatar */}
        <UserAvatar profile={otherUser} size="md" />

        {/* Name + secondary info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p
              className="font-bold text-[15px] truncate leading-tight"
              style={{ fontFamily: 'Manrope, sans-serif', color: C.onSurface }}
            >
              {otherUser?.full_name || (lang === 'he' ? 'משתמש' : 'User')}
            </p>
            {otherUser?.is_verified && (
              <Shield className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.primary }} />
            )}
          </div>
          {/* Show listing title OR rating as subtitle — pick first available */}
          {listingTitle ? (
            <p className="text-[11px] truncate mt-0.5" style={{ color: C.onSurfaceVar }}>
              {listingTitle}
              {listing?.price && (
                <span style={{ color: C.primary }}> · {formatPrice(listing.price)}</span>
              )}
            </p>
          ) : otherUser?.rating > 0 ? (
            <p className="text-[11px] mt-0.5" style={{ color: C.onSurfaceVar }}>
              ★ {otherUser.rating}
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Listing context card (separate strip, only when listing exists) ── */}
      <ListingContextCard listing={listing} lang={lang} onClick={goToListing} />

      {/* ── Messages ── */}
      <div className="relative flex-1 min-h-0" style={{ background: '#131313' }}>
        <div
          ref={scrollRef}
          onScroll={onScrollMessages}
          className="absolute inset-0 overflow-y-auto px-4 py-3"
          style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
        >
          {/* Loading skeleton */}
          {messagesLoading && messages.length === 0 ? (
            <div className="space-y-3 py-4">
              {[
                { a: 'start', w: '60%' }, { a: 'end', w: '45%' },
                { a: 'start', w: '70%' }, { a: 'start', w: '50%' }, { a: 'end', w: '55%' },
              ].map((s, i) => (
                <div key={i} className={`flex ${s.a === 'end' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="rounded-2xl px-4 py-3 space-y-2 animate-pulse"
                    style={{
                      width: s.w, minWidth: '80px',
                      background: s.a === 'end' ? 'rgba(0,87,80,0.3)' : C.surfaceLow,
                    }}
                  >
                    <div className="h-3 rounded w-full" style={{ background: C.surfaceHigh }} />
                    {i % 2 === 0 && <div className="h-3 rounded w-3/5" style={{ background: C.surfaceHigh }} />}
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center min-h-[260px] text-center py-8">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
                style={{ background: C.surfaceLow }}
              >
                <MessageCircle className="w-7 h-7" style={{ color: C.surfaceHigh }} />
              </div>
              <p className="font-semibold text-sm mb-1" style={{ color: C.onSurface }}>
                {lang === 'he' ? 'התחל את השיחה' : 'Start the conversation'}
              </p>
              <p className="text-xs max-w-[190px] leading-relaxed mb-4" style={{ color: C.onSurfaceVar }}>
                {lang === 'he'
                  ? 'שאל על זמינות, מצב הפריט, או שלח הצעת מחיר.'
                  : 'Ask about availability, condition, or make an offer.'}
              </p>
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(111,238,225,0.06)', border: `1px solid rgba(111,238,225,0.16)` }}
              >
                <Shield className="w-3 h-3 flex-shrink-0" style={{ color: C.primary }} />
                <p className="text-[10px]" style={{ color: C.onSurfaceVar }}>
                  {lang === 'he' ? 'שלם רק לאחר קבלת הפריט' : 'Pay only after receiving the item'}
                </p>
              </div>
            </div>
          ) : null}

          {/* Message bubbles */}
          <div>
            {grouped.map((msg) => {
              const isMe    = msg.sender_id === user.id;
              const isOffer = !!(msg.is_offer && msg.offer_amount);
              const radius  = getBubbleRadius(msg, isMe);

              // Bubble styles — Stitch design language
              const bubbleStyle = isOffer
                ? {
                    borderRadius: 16, overflow: 'hidden',
                    border: '1.5px solid rgba(251,191,36,0.38)',
                    background: isMe ? 'rgba(251,191,36,0.09)' : 'rgba(251,191,36,0.06)',
                  }
                : isMe
                  ? {
                      // Outgoing: dark teal — "liquid gradient" from the Stitch palette
                      background: 'linear-gradient(145deg, #004a46 0%, #003733 100%)',
                      border: `1px solid rgba(111,238,225,0.2)`,
                    }
                  : {
                      // Incoming: surface-container-low (#1c1b1b) — solid dark surface
                      background: C.surfaceLow,
                      border: `1px solid ${C.outline}`,
                    };

              return (
                <div
                  key={msg.id}
                  className={`flex ${isMe ? 'justify-end' : 'justify-start'} ${msg.isStart ? 'mt-3' : 'mt-[3px]'}`}
                >
                  <div
                    className={`max-w-[75%] ${isOffer ? '' : `px-3.5 py-2.5 ${radius}`}`}
                    style={bubbleStyle}
                  >
                    {isOffer ? (
                      <div className="px-4 pt-3.5 pb-3">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="text-xs">💰</span>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                            {lang === 'he' ? 'הצעת מחיר' : 'Price Offer'}
                          </span>
                        </div>
                        <p className="text-2xl font-bold text-amber-300 leading-none">
                          ₪{msg.offer_amount.toLocaleString()}
                        </p>
                        {msg.content && (
                          <p className="text-xs leading-relaxed mt-1.5 dir-auto" dir="auto"
                            style={{ color: C.onSurfaceVar }}>{msg.content}</p>
                        )}
                        <div className={`flex items-center gap-1 mt-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
                          <span className="text-[10px]" style={{ color: C.onSurfaceVar }}>
                            {formatMessageTime(msg.created_at, lang)}
                          </span>
                          {isMe && (msg.is_read
                            ? <CheckCheck className="w-3.5 h-3.5" style={{ color: C.primary }} />
                            : <Check className="w-3.5 h-3.5 text-white/25" />
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* dir=auto: browser detects Hebrew vs English per bubble */}
                        <p
                          className="text-sm leading-relaxed"
                          dir="auto"
                          style={{ color: C.onSurface }}
                        >
                          {msg.content}
                        </p>
                        {msg.isEnd && (
                          <div className={`flex items-center gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                            <span
                              className="text-[10px]"
                              style={{ color: isMe ? 'rgba(111,238,225,0.55)' : C.onSurfaceVar }}
                            >
                              {formatMessageTime(msg.created_at, lang)}
                            </span>
                            {isMe && (msg.is_read
                              ? <CheckCheck className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.primary }} />
                              : <Check className="w-3.5 h-3.5 flex-shrink-0 text-white/25" />
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div ref={messagesEndRef} className="h-1" />
        </div>

        {/* "New message" jump pill */}
        {showNewMsgBanner && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-3 z-10">
            <button
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold shadow-lg active:scale-95 transition-all"
              style={{ background: `linear-gradient(135deg,${C.primary} 0%,${C.primaryCont} 100%)`, color: C.onPrimary }}
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
        className="flex-shrink-0 flex gap-2 px-4 py-2.5 border-t overflow-x-auto"
        style={{
          background: C.surfaceLow,
          borderColor: C.outline,
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {[
          { text: lang === 'he' ? 'עדיין זמין?' : 'Still available?', icon: '❓' },
          { text: lang === 'he' ? 'מחיר סופי?'  : 'Best price?',      icon: '💰' },
          { text: lang === 'he' ? 'איפה למסור?' : 'Where to meet?',   icon: '📍' },
        ].map((q, i) => (
          <button
            key={i}
            onClick={() => { if (navigator.vibrate) navigator.vibrate(10); sendMessage(q.text); }}
            className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs whitespace-nowrap active:scale-95 transition-all"
            style={{
              background: C.surface,
              border: `1px solid ${C.outline}`,
              color: C.onSurfaceVar,
            }}
          >
            {q.icon} {q.text}
          </button>
        ))}
      </div>

      {/* ── Composer ── */}
      <div
        className="flex-shrink-0 border-t"
        style={{
          background: C.surfaceLow,
          borderColor: C.outline,
          padding: '10px 16px',
          paddingBottom: 'max(env(safe-area-inset-bottom),12px)',
        }}
      >
        <div className="flex items-center gap-2">

          {/* Offer button */}
          <button
            onClick={() => setShowOfferSheet(true)}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-all"
            style={{
              background: C.surface,
              border: `1px solid ${C.outline}`,
              color: C.onSurfaceVar,
            }}
            aria-label={lang === 'he' ? 'הצעת מחיר' : 'Make offer'}
          >
            <DollarSign className="w-4 h-4" />
          </button>

          {/* Text input */}
          <input
            type="text"
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder={lang === 'he' ? 'כתוב הודעה...' : 'Type a message...'}
            className="flex-1 h-[44px] px-4 rounded-full text-sm focus:outline-none transition-colors"
            style={{
              background: C.surface,
              border: `1px solid ${C.outline}`,
              color: C.onSurface,
            }}
            dir={rtl ? 'rtl' : 'ltr'}
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!newMessage.trim() || sendingMessage}
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 active:scale-90 transition-all disabled:opacity-35"
            style={{
              background: newMessage.trim() && !sendingMessage
                ? `linear-gradient(135deg,${C.primary} 0%,${C.primaryCont} 100%)`
                : C.surfaceHigh,
              color: newMessage.trim() && !sendingMessage ? C.onPrimary : C.onSurfaceVar,
            }}
            aria-label={lang === 'he' ? 'שלח' : 'Send'}
          >
            {sendingMessage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {showOfferSheet && (
        <OfferSheet
          listing={listing} lang={lang} rtl={rtl}
          onClose={() => setShowOfferSheet(false)}
          onSend={handleOfferSend}
        />
      )}
    </div>
  );
}
