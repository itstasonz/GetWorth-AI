import React, { useEffect, useRef, useState } from 'react';
import {
  MessageCircle, ChevronRight, ChevronLeft,
  DollarSign, Loader2, Send, Check, CheckCheck, X, ArrowDown,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, FadeIn, SlideUp } from '../components/ui';
import { formatPrice, formatMessageTime } from '../lib/utils';

const DEV = import.meta.env.DEV;

// ─── Offer Bottom Sheet ──────────────────────────────────
function OfferSheet({ listing, lang, rtl, onClose, onSend }) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
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
              className="flex-1 py-3.5 rounded-xl bg-white/5 border border-white/10 text-sm font-medium text-slate-300 hover:bg-white/10 transition-all"
            >
              {lang === 'he' ? 'ביטול' : 'Cancel'}
            </button>
            <button
              onClick={handleSend}
              disabled={!amount || parseInt(amount, 10) <= 0}
              className="flex-1 py-3.5 rounded-xl text-sm font-bold transition-all active:scale-[0.97] disabled:opacity-40 flex items-center justify-center gap-2"
              style={{
                background: 'linear-gradient(135deg, #6FEEE1 0%, #4FD1C5 100%)',
                color: '#003733',
              }}
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

// ─── Inbox View ──────────────────────────────────────────
export function InboxView() {
  const { t, lang, rtl, user, conversations, conversationsLoading, setActiveChat, loadMessages, setView, goTab, unreadCount } = useApp();

  // Timing instrumentation — DEV only
  const mountedAt = useRef(DEV ? performance.now() : 0);
  useEffect(() => {
    if (DEV) console.log(`[Chat] InboxView mounted`);
  }, []);
  const prevCountRef = useRef(0);
  useEffect(() => {
    if (!DEV) return;
    if (conversations.length > 0 && prevCountRef.current === 0) {
      console.log(`[Chat] First visible UI: ${conversations.length} convs after ${(performance.now() - mountedAt.current).toFixed(0)}ms from mount`);
    }
    prevCountRef.current = conversations.length;
  }, [conversations.length]);

  if (!user) {
    return (
      <div className="space-y-4">
        <FadeIn><h2 className="text-2xl font-bold">{lang === 'he' ? 'הודעות' : 'Messages'}</h2></FadeIn>
        <FadeIn className="text-center py-16">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-4" style={{ background: 'rgba(111,238,225,0.08)' }}><MessageCircle className="w-10 h-10" style={{ color: '#6FEEE1' }} /></div>
          <p className="text-slate-400 mb-5">{lang === 'he' ? 'התחבר כדי לראות הודעות' : 'Sign in to see messages'}</p>
          <Btn primary onClick={() => goTab('profile')}>{t.signIn}</Btn>
        </FadeIn>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FadeIn><h2 className="text-2xl font-bold">{lang === 'he' ? 'הודעות' : 'Messages'}</h2></FadeIn>

      {conversationsLoading && conversations.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="p-4 rounded-3xl bg-white/[0.03] border border-white/5 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl bg-white/5" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-white/5 rounded w-1/3" />
                  <div className="h-3 bg-white/5 rounded w-2/3" />
                  <div className="h-3 bg-white/5 rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : conversations.length === 0 ? (
        <FadeIn className="text-center py-16">
          <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mx-auto mb-4"><MessageCircle className="w-10 h-10 text-slate-600" /></div>
          <p className="text-slate-400 mb-2">{lang === 'he' ? 'אין הודעות עדיין' : 'No messages yet'}</p>
          <p className="text-slate-500 text-sm mb-5">{lang === 'he' ? 'התחל שיחה עם מוכר' : 'Start a conversation with a seller'}</p>
          <Btn primary onClick={() => goTab('browse')}>{lang === 'he' ? 'חפש פריטים' : 'Browse Items'}</Btn>
        </FadeIn>
      ) : (
        <div className="space-y-3">
          {conversations.map((conv, i) => {
            const otherUser = conv.buyer_id === user.id ? conv.seller : conv.buyer;
            const lastMessage = conv.messages?.[0] ?? null;
            const convUnread = conv.messages?.filter((m) => !m.is_read && m.sender_id !== user.id).length || 0;

            return (
              <FadeIn key={conv.id} delay={i * 50}>
                <Card className="p-4 cursor-pointer" onClick={() => { setActiveChat({ ...conv, otherUser }); loadMessages(conv.id); setView('chat'); }}>
                  <div className="flex items-center gap-4">
                    <div className="relative w-16 h-16 rounded-xl overflow-hidden flex-shrink-0">
                      {conv.listing?.images?.[0]
                        ? <img src={conv.listing.images[0]} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full bg-white/5 flex items-center justify-center"><MessageCircle className="w-6 h-6 text-slate-500" /></div>
                      }
                      {convUnread > 0 && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-[10px] font-bold flex items-center justify-center">{convUnread}</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold truncate">{otherUser?.full_name || 'User'}</span>
                        <span className="text-[10px] text-slate-500">{lastMessage ? formatMessageTime(lastMessage.created_at, lang) : ''}</span>
                      </div>
                      <p className="text-sm text-slate-400 truncate">{conv.listing?.title}</p>
                      <p className={`text-xs truncate mt-1 ${convUnread > 0 ? 'text-white font-medium' : 'text-slate-500'}`}>
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
  );
}

// ─── Chat View ───────────────────────────────────────────
export function ChatView() {
  const {
    lang, rtl, user, activeChat, setActiveChat, setView, setSelected,
    messages, messagesLoading, newMessage, setNewMessage,
    sendMessage, sendingMessage, messagesEndRef,
  } = useApp();

  const [showOfferSheet, setShowOfferSheet] = useState(false);
  const [showNewMsgBanner, setShowNewMsgBanner] = useState(false);

  const containerRef = useRef(null);   // outer fixed container
  const scrollRef    = useRef(null);   // inner scrollable messages div
  const nearBottomRef     = useRef(true);
  const prevMsgCountRef   = useRef(0);

  // ── Fix 1: dynamic height via visualViewport (keyboard-safe) ─────────────
  // CSS sets height: 100dvh as primary. visualViewport fires on every keyboard
  // open/close and corrects height + top-offset for iOS < 15.4 & Android edge cases.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      el.style.height = `${vv.height}px`;
      // vv.offsetTop > 0 on iOS when page scrolls up with keyboard
      el.style.top = `${vv.offsetTop}px`;
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // ── Fix 2: track near-bottom for smart auto-scroll ───────────────────────
  const onScrollMessages = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = dist < 80;
    if (nearBottomRef.current) setShowNewMsgBanner(false);
  };

  // ── Fix 3: auto-scroll on new messages ───────────────────────────────────
  useEffect(() => {
    const count = messages.length;
    if (count === 0) { prevMsgCountRef.current = 0; return; }

    const isInitial = prevMsgCountRef.current === 0;
    const hasNew    = count > prevMsgCountRef.current;
    prevMsgCountRef.current = count;

    if (isInitial) {
      // Jump instantly on conversation open — no animation flicker
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
      return;
    }

    if (!hasNew) return;

    const latest  = messages[count - 1];
    const fromMe  = latest?.sender_id === user?.id;

    if (nearBottomRef.current || fromMe) {
      messagesEndRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } else {
      // User is reading history — show banner, don't hijack scroll
      setShowNewMsgBanner(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  if (!activeChat) return null;

  const goToListing = () => {
    if (activeChat.listing) {
      setSelected(activeChat.listing);
      setView('detail');
    }
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
  // Consecutive messages from the same sender form a visual "group":
  // tighter vertical spacing, tapered bubble corners, timestamp only at group end.
  const grouped = messages.map((msg, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const samePrev = prev?.sender_id === msg.sender_id;
    const sameNext = next?.sender_id === msg.sender_id;
    return { ...msg, isStart: !samePrev, isEnd: !sameNext };
  });

  return (
    // Full-screen fixed overlay: z-[45] sits above the bottom nav (z-40) but below modals (z-50).
    // height: 100dvh shrinks with keyboard on iOS 15.4+; visualViewport listener handles older browsers.
    <div
      ref={containerRef}
      className="fixed left-0 right-0 z-[45] flex flex-col animate-slideUp"
      style={{
        top: 0,
        height: '100dvh',
        background: '#131313',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >

      {/* ── Header ── */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-5 border-b border-white/10"
        style={{
          paddingTop: 'max(env(safe-area-inset-top), 12px)',
          paddingBottom: '12px',
          background: 'rgba(19, 19, 19, 0.85)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
      >
        <button
          onClick={() => { setActiveChat(null); setView('inbox'); }}
          className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0 active:scale-90 transition-all"
        >
          {rtl ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>

        <button
          type="button"
          aria-label="Open listing"
          onClick={goToListing}
          className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 active:scale-95 transition-transform"
        >
          {activeChat.listing?.images?.[0]
            ? <img src={activeChat.listing.images[0]} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-white/10" />
          }
        </button>

        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">
            {activeChat.otherUser?.full_name || activeChat.seller?.full_name || (lang === 'he' ? 'משתמש' : 'User')}
          </p>
          <p className="text-xs text-slate-400 truncate">{activeChat.listing?.title}</p>
        </div>

        <div className="flex-shrink-0 text-right">
          <p className="text-lg font-bold text-green-400">{formatPrice(activeChat.listing?.price)}</p>
        </div>
      </div>

      {/* ── Messages (relative wrapper for the floating banner) ── */}
      <div className="relative flex-1 min-h-0">

        <div
          ref={scrollRef}
          onScroll={onScrollMessages}
          className="absolute inset-0 overflow-y-auto px-5 py-4"
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
                      width: s.w,
                      minWidth: '80px',
                      background: s.align === 'end' ? 'rgba(111,238,225,0.08)' : 'rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="h-3 bg-white/10 rounded w-full" />
                    {i % 2 === 0 && <div className="h-3 bg-white/10 rounded w-3/5" />}
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            /* Premium empty state */
            <div className="flex flex-col items-center justify-center min-h-[280px] text-center py-12">
              <div className="w-20 h-20 rounded-3xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                <MessageCircle className="w-10 h-10 text-slate-600" />
              </div>
              <p className="text-slate-300 font-semibold mb-2">
                {lang === 'he' ? 'התחל את השיחה' : 'Start the conversation'}
              </p>
              <p className="text-slate-500 text-sm max-w-[220px] leading-relaxed">
                {lang === 'he'
                  ? 'שאל על זמינות, מצב הפריט, או שלח הצעת מחיר.'
                  : 'Ask about availability, condition, or make an offer.'}
              </p>
            </div>
          ) : null}

          {/* Message bubbles */}
          <div>
            {grouped.map((msg) => {
              const isMe = msg.sender_id === user.id;

              // Tapered corners: the "sender side" corner of grouped middle/end bubbles is small
              let radius = '';
              if (isMe) {
                if (msg.isStart && msg.isEnd)  radius = 'rounded-2xl';
                else if (msg.isStart)           radius = 'rounded-2xl rounded-br-sm';
                else if (msg.isEnd)             radius = 'rounded-2xl rounded-tr-sm rounded-br-sm';
                else                            radius = 'rounded-2xl rounded-r-sm';
              } else {
                if (msg.isStart && msg.isEnd)  radius = 'rounded-2xl';
                else if (msg.isStart)           radius = 'rounded-2xl rounded-bl-sm';
                else if (msg.isEnd)             radius = 'rounded-2xl rounded-tl-sm rounded-bl-sm';
                else                            radius = 'rounded-2xl rounded-l-sm';
              }

              return (
                <div
                  key={msg.id}
                  className={`flex ${isMe ? 'justify-end' : 'justify-start'} ${msg.isStart ? 'mt-3' : 'mt-0.5'}`}
                >
                  <div
                    className={`max-w-[80%] px-4 py-2.5 ${radius}`}
                    style={isMe
                      ? { background: 'rgba(111,238,225,0.18)', border: '1px solid rgba(111,238,225,0.35)' }
                      : { background: 'rgba(255,255,255,0.10)' }
                    }
                  >
                    {msg.is_offer && (
                      <div className={`text-xs mb-1 ${isMe ? 'text-[#6FEEE1]/80' : 'text-slate-400'}`}>
                        💰 {lang === 'he' ? 'הצעת מחיר' : 'Price Offer'}
                      </div>
                    )}
                    {msg.is_offer && msg.offer_amount && (
                      <p className="text-xl font-bold text-green-400 mb-1">₪{msg.offer_amount.toLocaleString()}</p>
                    )}
                    <p className="text-sm leading-relaxed">{msg.content}</p>

                    {/* Timestamp + read receipt — only on last bubble in a group */}
                    {msg.isEnd && (
                      <div className={`flex items-center gap-1 mt-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <span className={`text-[10px] ${isMe ? 'text-[#6FEEE1]/70' : 'text-slate-500'}`}>
                          {formatMessageTime(msg.created_at, lang)}
                        </span>
                        {isMe && (
                          msg.is_read
                            ? <CheckCheck className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#6FEEE1' }} />
                            : <Check className="w-3.5 h-3.5 flex-shrink-0 text-white/30" />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div ref={messagesEndRef} className="h-1" />
        </div>

        {/* ── Floating "new message" banner ── */}
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

      {/* ── Quick Actions ── */}
      <div className="flex-shrink-0 px-5 py-2 flex gap-2 overflow-x-auto scrollbar-hide border-t border-white/5">
        {[
          { text: lang === 'he' ? 'עדיין זמין?' : 'Still available?', icon: '❓' },
          { text: lang === 'he' ? 'מחיר סופי?' : 'Best price?',      icon: '💰' },
          { text: lang === 'he' ? 'איפה למסור?' : 'Where to meet?',   icon: '📍' },
        ].map((quick, i) => (
          <button
            key={i}
            onClick={() => {
              if (navigator.vibrate) navigator.vibrate(10);
              sendMessage(quick.text);
            }}
            className="flex-shrink-0 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs hover:bg-white/10 active:scale-95 transition-all"
          >
            {quick.icon} {quick.text}
          </button>
        ))}
      </div>

      {/* ── Composer ── */}
      <div
        className="flex-shrink-0 px-4 pt-3 border-t border-white/10"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
      >
        <div className="flex items-center gap-2">
          {/* Offer button */}
          <button
            onClick={() => setShowOfferSheet(true)}
            className="w-12 h-12 flex-shrink-0 rounded-2xl bg-green-500/15 border border-green-500/20 flex items-center justify-center text-green-400 hover:bg-green-500/25 active:scale-90 transition-all"
            aria-label={lang === 'he' ? 'הצעת מחיר' : 'Make offer'}
          >
            <DollarSign className="w-5 h-5" />
          </button>

          {/* Text input */}
          <input
            type="text"
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
            placeholder={lang === 'he' ? 'כתוב הודעה...' : 'Type a message...'}
            className="flex-1 min-h-[48px] px-4 py-3 rounded-2xl bg-white/5 border border-white/10 focus:outline-none focus:border-[#6FEEE1]/50 text-sm transition-colors placeholder:text-slate-500"
            dir={rtl ? 'rtl' : 'ltr'}
          />

          {/* Send button */}
          <button
            onClick={handleSendMessage}
            disabled={!newMessage.trim() || sendingMessage}
            className="w-12 h-12 flex-shrink-0 rounded-2xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-40"
            style={{
              background: newMessage.trim() && !sendingMessage
                ? 'linear-gradient(135deg, #6FEEE1 0%, #4FD1C5 100%)'
                : 'rgba(255,255,255,0.05)',
              color: newMessage.trim() && !sendingMessage ? '#003733' : '#64748b',
              border: !newMessage.trim() ? '1px solid rgba(255,255,255,0.08)' : 'none',
            }}
            aria-label={lang === 'he' ? 'שלח' : 'Send'}
          >
            {sendingMessage
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <Send className="w-5 h-5" />
            }
          </button>
        </div>
      </div>

      {/* ── Offer Sheet ── */}
      {showOfferSheet && (
        <OfferSheet
          listing={activeChat.listing}
          lang={lang}
          rtl={rtl}
          onClose={() => setShowOfferSheet(false)}
          onSend={handleOfferSend}
        />
      )}
    </div>
  );
}
