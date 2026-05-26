import React, { useEffect, useRef, useState } from 'react';
import {
  MessageCircle, ChevronRight, ChevronLeft,
  DollarSign, Loader2, Send, Check, CheckCheck, X, ArrowDown, Shield,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Btn, FadeIn, SlideUp } from '../components/ui';
import { formatPrice, formatMessageTime } from '../lib/utils';

const DEV = import.meta.env.DEV;

// ─── Offer Bottom Sheet ──────────────────────────────────────────────────────
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
          className="bg-gradient-to-b from-[#151d30] to-[#0a1020] rounded-t-[2rem] p-6 space-y-5"
          dir={rtl ? 'rtl' : 'ltr'}
        >
          <div className="w-12 h-1 bg-white/20 rounded-full mx-auto" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5" style={{ color: '#6FEEE1' }} />
              <h3 className="text-lg font-bold">
                {lang === 'he' ? 'שלח הצעת מחיר' : 'Make an Offer'}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          {listing && (
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/5 border border-white/10">
              {listing.images?.[0] && (
                <img src={listing.images[0]} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate">
                  {lang === 'he' && listing.title_hebrew ? listing.title_hebrew : listing.title}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {lang === 'he' ? 'מחיר מבוקש: ' : 'Listed at '}
                  <span className="font-semibold text-green-400">{formatPrice(listing.price)}</span>
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">
              {lang === 'he' ? 'הצעה שלך' : 'Your offer'}
            </label>
            <div className="relative flex items-center">
              <span
                className="absolute text-xl font-bold text-slate-400 pointer-events-none"
                style={{ [rtl ? 'right' : 'left']: '16px' }}
              >
                ₪
              </span>
              <input
                ref={inputRef}
                type="number"
                inputMode="numeric"
                value={amount}
                onChange={e => { setAmount(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="0"
                min="1"
                className={`w-full py-4 ${rtl ? 'pr-10 pl-4' : 'pl-10 pr-4'} rounded-2xl bg-white/5 border border-white/10 text-2xl font-bold focus:outline-none focus:border-[#6FEEE1]/60 transition-colors text-center`}
                style={{ color: amount && parseInt(amount, 10) > 0 ? '#6FEEE1' : undefined }}
                dir="ltr"
              />
            </div>
            {error && <p className="text-red-400 text-xs px-1">{error}</p>}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-3.5 rounded-xl bg-white/5 border border-white/10 text-sm font-medium text-slate-300 hover:bg-white/10 transition-all active:scale-[0.97]"
            >
              {lang === 'he' ? 'ביטול' : 'Cancel'}
            </button>
            <button
              onClick={handleSend}
              disabled={!amount || parseInt(amount, 10) <= 0}
              className="flex-1 py-3.5 rounded-xl text-sm font-bold transition-all active:scale-[0.97] disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #6FEEE1 0%, #4FD1C5 100%)', color: '#003733' }}
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

// ─── Inbox View ──────────────────────────────────────────────────────────────
export function InboxView() {
  const {
    t, lang, rtl, user, conversations, conversationsLoading,
    setActiveChat, loadMessages, setView, goTab, unreadCount,
  } = useApp();

  const mountedAt    = useRef(DEV ? performance.now() : 0);
  const prevCountRef = useRef(0);

  useEffect(() => { if (DEV) console.log('[Chat] InboxView mounted'); }, []);
  useEffect(() => {
    if (!DEV) return;
    if (conversations.length > 0 && prevCountRef.current === 0)
      console.log(`[Chat] First visible UI: ${conversations.length} convs after ${(performance.now() - mountedAt.current).toFixed(0)}ms`);
    prevCountRef.current = conversations.length;
  }, [conversations.length]);

  if (!user) {
    return (
      <div className="space-y-4">
        <FadeIn><h2 className="text-2xl font-bold">{lang === 'he' ? 'הודעות' : 'Messages'}</h2></FadeIn>
        <FadeIn className="text-center py-16">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(111,238,225,0.08)' }}>
            <MessageCircle className="w-10 h-10" style={{ color: '#6FEEE1' }} />
          </div>
          <p className="text-slate-400 mb-5">{lang === 'he' ? 'התחבר כדי לראות הודעות' : 'Sign in to see messages'}</p>
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

  return (
    <div className="space-y-4">
      <FadeIn><h2 className="text-2xl font-bold">{lang === 'he' ? 'הודעות' : 'Messages'}</h2></FadeIn>

      {conversationsLoading && conversations.length === 0 ? (
        /* Loading skeleton */
        <div className="rounded-2xl overflow-hidden border border-white/[0.07]">
          {[0, 1, 2].map(i => (
            <div key={i} className={`flex items-center gap-3 px-4 py-3 animate-pulse ${i > 0 ? 'border-t border-white/[0.05]' : ''}`}>
              <div className="w-14 h-14 rounded-xl bg-white/[0.06] flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-white/[0.06] rounded w-1/3" />
                <div className="h-3 bg-white/[0.06] rounded w-1/2" />
                <div className="h-3 bg-white/[0.06] rounded w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : conversations.length === 0 ? (
        <FadeIn className="text-center py-16">
          <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mx-auto mb-4">
            <MessageCircle className="w-10 h-10 text-slate-600" />
          </div>
          <p className="text-slate-300 font-semibold mb-2">
            {lang === 'he' ? 'אין הודעות עדיין' : 'No messages yet'}
          </p>
          <p className="text-slate-500 text-sm mb-5">
            {lang === 'he' ? 'התחל שיחה עם מוכר' : 'Start a conversation with a seller'}
          </p>
          <Btn primary onClick={() => goTab('browse')}>
            {lang === 'he' ? 'חפש פריטים' : 'Browse Items'}
          </Btn>
        </FadeIn>
      ) : (
        /* Conversation list — clean bordered list, no heavy Card shadow per row */
        <div className="rounded-2xl overflow-hidden border border-white/[0.07]">
          {conversations.map((conv, i) => {
            const otherUser  = conv.buyer_id === user.id ? conv.seller : conv.buyer;
            const lastMsg    = conv.messages?.[0] ?? null;
            const convUnread = conv.messages?.filter(m => !m.is_read && m.sender_id !== user.id).length || 0;
            const lastText   = lastMsg?.is_offer
              ? `💰 ${lang === 'he' ? 'הצעת מחיר' : 'Price offer'}: ₪${lastMsg.offer_amount}`
              : lastMsg?.content || (lang === 'he' ? 'שיחה חדשה' : 'New conversation');

            return (
              <button
                key={conv.id}
                onClick={() => openConv(conv)}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04] active:bg-white/[0.07] ${i > 0 ? 'border-t border-white/[0.05]' : ''}`}
              >
                {/* Listing thumbnail */}
                <div className="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-white/[0.05]">
                  {conv.listing?.images?.[0]
                    ? <img src={conv.listing.images[0]} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center"><MessageCircle className="w-5 h-5 text-slate-600" /></div>
                  }
                </div>

                {/* Text content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`font-semibold text-sm truncate ${convUnread > 0 ? 'text-white' : 'text-slate-200'}`}>
                      {otherUser?.full_name || (lang === 'he' ? 'משתמש' : 'User')}
                    </span>
                    <span className="text-[10px] text-slate-500 flex-shrink-0 ml-2">
                      {lastMsg ? formatMessageTime(lastMsg.created_at, lang) : ''}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 truncate mb-0.5">
                    {lang === 'he' && conv.listing?.title_hebrew ? conv.listing.title_hebrew : conv.listing?.title}
                  </p>
                  <p className={`text-xs truncate ${convUnread > 0 ? 'text-slate-300 font-medium' : 'text-slate-500'}`}>
                    {lastText}
                  </p>
                </div>

                {/* Unread count — teal badge, right side, does NOT overlap thumbnail */}
                {convUnread > 0 ? (
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ background: '#6FEEE1', color: '#003733' }}
                  >
                    {convUnread > 9 ? '9+' : convUnread}
                  </div>
                ) : (
                  <div className="w-5 flex-shrink-0" /> /* spacer keeps layout stable */
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Chat View ───────────────────────────────────────────────────────────────
export function ChatView() {
  const {
    lang, rtl, user, activeChat, setActiveChat, setView, setSelected,
    messages, messagesLoading, newMessage, setNewMessage,
    sendMessage, sendingMessage, messagesEndRef,
  } = useApp();

  const [showOfferSheet,    setShowOfferSheet]    = useState(false);
  const [showNewMsgBanner,  setShowNewMsgBanner]  = useState(false);

  const containerRef   = useRef(null);
  const scrollRef      = useRef(null);
  const nearBottomRef  = useRef(true);
  const prevMsgCount   = useRef(0);

  // ── Keyboard-safe height (iOS visualViewport) ────────────────────────────
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
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // ── Smart scroll tracking ────────────────────────────────────────────────
  const onScrollMessages = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = dist < 80;
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
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
      return;
    }
    if (!hasNew) return;

    const latest = messages[count - 1];
    const fromMe = latest?.sender_id === user?.id;

    if (nearBottomRef.current || fromMe) {
      messagesEndRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } else {
      setShowNewMsgBanner(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  if (!activeChat) return null;

  const otherUser      = activeChat.otherUser ?? activeChat.seller ?? null;
  const listing        = activeChat.listing ?? null;
  const listingTitle   = lang === 'he' && listing?.title_hebrew ? listing.title_hebrew : listing?.title;

  const goToListing = () => {
    if (listing) { setSelected(listing); setView('detail'); }
  };

  const handleSendMessage = () => {
    if (!newMessage.trim() || sendingMessage) return;
    if (navigator.vibrate) navigator.vibrate(10);
    sendMessage(newMessage);
  };

  const handleOfferSend = (amount) => {
    sendMessage(
      lang === 'he' ? `אני מציע ₪${amount.toLocaleString()}` : `I offer ₪${amount.toLocaleString()}`,
      true,
      amount,
    );
    setShowOfferSheet(false);
  };

  // ── Message grouping ─────────────────────────────────────────────────────
  const grouped = messages.map((msg, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    return {
      ...msg,
      isStart: prev?.sender_id !== msg.sender_id,
      isEnd:   next?.sender_id !== msg.sender_id,
    };
  });

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

      {/* ── Header ──────────────────────────────────────────────────────── */}
      {/* Clean 2-row layout: no floating price box. Price lives in subtitle. */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 border-b border-white/[0.08]"
        style={{
          paddingTop:    'max(env(safe-area-inset-top), 12px)',
          paddingBottom: '12px',
          background:    'rgba(17,17,17,0.92)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
      >
        {/* Back */}
        <button
          onClick={() => { setActiveChat(null); setView('inbox'); }}
          className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0 active:scale-90 transition-all"
        >
          {rtl ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>

        {/* Listing thumbnail — tappable, opens listing */}
        <button
          type="button"
          aria-label="Open listing"
          onClick={goToListing}
          className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 active:scale-95 transition-transform bg-white/[0.05]"
        >
          {listing?.images?.[0]
            ? <img src={listing.images[0]} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-white/[0.08]" />
          }
        </button>

        {/* Name + subtitle (listing title · price) */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="font-semibold text-[15px] truncate leading-tight">
              {otherUser?.full_name || (lang === 'he' ? 'משתמש' : 'User')}
            </p>
            {otherUser?.is_verified && (
              <Shield className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#6FEEE1' }} />
            )}
          </div>
          <p className="text-xs text-slate-400 truncate mt-0.5">
            {listingTitle}
            {listing?.price ? <span className="text-slate-500"> · {formatPrice(listing.price)}</span> : null}
            {otherUser?.rating > 0 && (
              <span className="text-yellow-400/80"> · ★{otherUser.rating}</span>
            )}
          </p>
        </div>
      </div>

      {/* ── Messages ─────────────────────────────────────────────────────── */}
      <div className="relative flex-1 min-h-0">
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
                { align: 'start', w: '60%' },
                { align: 'end',   w: '45%' },
                { align: 'start', w: '70%' },
                { align: 'start', w: '50%' },
                { align: 'end',   w: '55%' },
              ].map((s, i) => (
                <div key={i} className={`flex ${s.align === 'end' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="rounded-2xl px-4 py-3 space-y-2 animate-pulse"
                    style={{
                      width: s.w, minWidth: '80px',
                      background: s.align === 'end' ? 'rgba(111,238,225,0.07)' : 'rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="h-3 bg-white/10 rounded w-full" />
                    {i % 2 === 0 && <div className="h-3 bg-white/10 rounded w-3/5" />}
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center min-h-[280px] text-center py-10">
              <div className="w-16 h-16 rounded-2xl bg-white/[0.05] flex items-center justify-center mb-3">
                <MessageCircle className="w-8 h-8 text-slate-600" />
              </div>
              <p className="text-slate-300 font-semibold text-sm mb-1.5">
                {lang === 'he' ? 'התחל את השיחה' : 'Start the conversation'}
              </p>
              <p className="text-slate-500 text-xs max-w-[200px] leading-relaxed mb-4">
                {lang === 'he'
                  ? 'שאל על זמינות, מצב הפריט, או שלח הצעת מחיר.'
                  : 'Ask about availability, condition, or make an offer.'}
              </p>
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(111,238,225,0.06)', border: '1px solid rgba(111,238,225,0.14)' }}
              >
                <Shield className="w-3 h-3 flex-shrink-0" style={{ color: '#6FEEE1' }} />
                <p className="text-[10px] text-slate-400">
                  {lang === 'he' ? 'שלם רק לאחר קבלת הפריט' : 'Pay only after receiving the item'}
                </p>
              </div>
            </div>
          ) : null}

          {/* Bubbles */}
          <div>
            {grouped.map((msg) => {
              const isMe    = msg.sender_id === user.id;
              const isOffer = msg.is_offer && msg.offer_amount;

              // Bubble border-radius: taper the corner on the "sender" side for grouped messages.
              // Alignment is always sender-based (not language-based) so this is correct for RTL too.
              let radius = 'rounded-2xl';
              if (!isOffer) {
                if (isMe) {
                  if (!msg.isStart && !msg.isEnd) radius = 'rounded-2xl rounded-tr-[6px] rounded-br-[6px]';
                  else if (!msg.isStart)          radius = 'rounded-2xl rounded-tr-[6px]';
                  else if (!msg.isEnd)            radius = 'rounded-2xl rounded-br-[6px]';
                } else {
                  if (!msg.isStart && !msg.isEnd) radius = 'rounded-2xl rounded-tl-[6px] rounded-bl-[6px]';
                  else if (!msg.isStart)          radius = 'rounded-2xl rounded-tl-[6px]';
                  else if (!msg.isEnd)            radius = 'rounded-2xl rounded-bl-[6px]';
                }
              }

              return (
                <div
                  key={msg.id}
                  className={`flex ${isMe ? 'justify-end' : 'justify-start'} ${msg.isStart ? 'mt-3' : 'mt-[3px]'}`}
                >
                  <div
                    className={`max-w-[75%] ${isOffer ? '' : `px-3.5 py-2.5 ${radius}`}`}
                    style={isOffer
                      ? {
                          borderRadius: 16,
                          border: '1.5px solid rgba(251,191,36,0.40)',
                          background: isMe ? 'rgba(251,191,36,0.09)' : 'rgba(251,191,36,0.06)',
                          overflow: 'hidden',
                        }
                      : isMe
                        ? { background: 'rgba(111,238,225,0.16)', border: '1px solid rgba(111,238,225,0.28)' }
                        : { background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.07)' }
                    }
                  >
                    {isOffer ? (
                      /* Offer card */
                      <div className="px-4 pt-3.5 pb-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <span className="text-xs">💰</span>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                            {lang === 'he' ? 'הצעת מחיר' : 'Price Offer'}
                          </span>
                        </div>
                        <p className="text-2xl font-bold text-amber-300 leading-none mb-1">
                          ₪{msg.offer_amount.toLocaleString()}
                        </p>
                        {msg.content && (
                          <p className="text-xs text-slate-400 leading-relaxed mt-1.5" dir="auto">
                            {msg.content}
                          </p>
                        )}
                        {/* Timestamp row */}
                        <div className={`flex items-center gap-1 mt-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
                          <span className="text-[10px] text-slate-500">
                            {formatMessageTime(msg.created_at, lang)}
                          </span>
                          {isMe && (
                            msg.is_read
                              ? <CheckCheck className="w-3.5 h-3.5" style={{ color: '#6FEEE1' }} />
                              : <Check className="w-3.5 h-3.5 text-white/25" />
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* dir="auto" lets browser detect Hebrew vs English per-bubble */}
                        <p className="text-sm leading-relaxed" dir="auto">{msg.content}</p>

                        {/* Timestamp + read receipt — only at group end */}
                        {msg.isEnd && (
                          <div className={`flex items-center gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                            <span className={`text-[10px] ${isMe ? 'text-[#6FEEE1]/55' : 'text-slate-500'}`}>
                              {formatMessageTime(msg.created_at, lang)}
                            </span>
                            {isMe && (
                              msg.is_read
                                ? <CheckCheck className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#6FEEE1' }} />
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

        {/* "New message" jump banner */}
        {showNewMsgBanner && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-3 z-10 pointer-events-none">
            <button
              className="pointer-events-auto flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold shadow-lg active:scale-95 transition-all"
              style={{ background: 'linear-gradient(135deg, #6FEEE1 0%, #4FD1C5 100%)', color: '#003733' }}
              onClick={() => {
                messagesEndRef?.current?.scrollIntoView({ behavior: 'smooth' });
                setShowNewMsgBanner(false);
              }}
            >
              <ArrowDown className="w-3.5 h-3.5" />
              {lang === 'he' ? 'הודעה חדשה' : 'New message'}
            </button>
          </div>
        )}
      </div>

      {/* ── Quick actions ────────────────────────────────────────────────── */}
      {/* Visible background strip anchors chips above composer. */}
      <div
        className="flex-shrink-0 flex gap-2 px-4 py-2.5 overflow-x-auto border-t"
        style={{
          background: 'rgba(13,13,13,0.95)',
          borderColor: 'rgba(255,255,255,0.07)',
          scrollbarWidth: 'none',
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
            className="flex-shrink-0 px-3 py-1.5 rounded-full bg-white/[0.07] border border-white/[0.10] text-xs text-slate-300 hover:bg-white/[0.11] active:scale-95 transition-all whitespace-nowrap"
          >
            {q.icon} {q.text}
          </button>
        ))}
      </div>

      {/* ── Composer ─────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 border-t"
        style={{
          background: 'rgba(13,13,13,0.98)',
          borderColor: 'rgba(255,255,255,0.07)',
          padding: '10px 16px',
          paddingBottom: 'max(env(safe-area-inset-bottom), 12px)',
        }}
      >
        <div className="flex items-center gap-2">
          {/* Offer trigger — secondary, smaller */}
          <button
            onClick={() => setShowOfferSheet(true)}
            className="w-10 h-10 flex-shrink-0 rounded-full bg-white/[0.07] border border-white/[0.10] flex items-center justify-center text-slate-400 hover:text-[#6FEEE1] hover:border-[#6FEEE1]/30 active:scale-90 transition-all"
            aria-label={lang === 'he' ? 'הצעת מחיר' : 'Make offer'}
          >
            <DollarSign className="w-4 h-4" />
          </button>

          {/* Text input */}
          <input
            type="text"
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
            placeholder={lang === 'he' ? 'כתוב הודעה...' : 'Type a message...'}
            className="flex-1 h-[44px] px-4 rounded-full bg-white/[0.07] border border-white/[0.10] focus:outline-none focus:border-[#6FEEE1]/40 focus:bg-white/[0.09] text-sm transition-colors placeholder:text-slate-500"
            dir={rtl ? 'rtl' : 'ltr'}
          />

          {/* Send button */}
          <button
            onClick={handleSendMessage}
            disabled={!newMessage.trim() || sendingMessage}
            className="w-10 h-10 flex-shrink-0 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-35"
            style={{
              background: newMessage.trim() && !sendingMessage
                ? 'linear-gradient(135deg, #6FEEE1 0%, #4FD1C5 100%)'
                : 'rgba(255,255,255,0.06)',
              color: newMessage.trim() && !sendingMessage ? '#003733' : '#64748b',
            }}
            aria-label={lang === 'he' ? 'שלח' : 'Send'}
          >
            {sendingMessage
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Send className="w-4 h-4" />
            }
          </button>
        </div>
      </div>

      {/* Offer sheet */}
      {showOfferSheet && (
        <OfferSheet
          listing={listing}
          lang={lang}
          rtl={rtl}
          onClose={() => setShowOfferSheet(false)}
          onSend={handleOfferSend}
        />
      )}
    </div>
  );
}
