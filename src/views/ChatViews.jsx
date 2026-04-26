import React from 'react';
import { MessageCircle, ChevronRight, ChevronLeft, DollarSign, Loader2 } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { Card, Btn, FadeIn } from '../components/ui';
import { formatPrice, formatMessageTime } from '../lib/utils';

export function InboxView() {
  const { t, lang, rtl, user, conversations, conversationsLoading, setActiveChat, loadMessages, setView, goTab, unreadCount } = useApp();

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
        /* Loading skeleton — shown only on first load, not on refresh */
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
            const lastMessage = (conv.messages || []).reduce((latest, m) => !latest || m.created_at > latest.created_at ? m : latest, null);
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

export function ChatView() {
  const { lang, rtl, user, activeChat, setActiveChat, setView, setSelected, messages, messagesLoading, newMessage, setNewMessage, sendMessage, sendingMessage, messagesEndRef } = useApp();

  if (!activeChat) return null;

  // Navigate to listing detail page
  const goToListing = () => {
    if (activeChat.listing) {
      setSelected(activeChat.listing);
      setView('detail');
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-180px)] -mx-5">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/10 flex items-center gap-3">
        <button onClick={() => { setActiveChat(null); setView('inbox'); }} className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
          {rtl ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
        {/* Thumbnail — tapping opens the listing detail */}
        <button
          type="button"
          aria-label="Open listing"
          onClick={goToListing}
          className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 cursor-pointer active:scale-95 transition-transform"
        >
          <img src={activeChat.listing?.images?.[0]} alt="" className="w-full h-full object-cover" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{activeChat.otherUser?.full_name || activeChat.seller?.full_name || (lang === 'he' ? 'משתמש' : 'User')}</p>
          <p className="text-xs text-slate-400 truncate">{activeChat.listing?.title}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-green-400">{formatPrice(activeChat.listing?.price)}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messagesLoading && messages.length === 0 ? (
          /* Loading skeleton — only when no cached messages */
          <div className="space-y-3 py-4">
            {[0, 1, 2].map(i => (
              <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                <div className={`rounded-2xl px-4 py-3 animate-pulse ${i % 2 === 0 ? 'bg-white/5 w-2/3' : 'w-1/2'}`} style={i % 2 !== 0 ? { background: 'rgba(111,238,225,0.08)' } : {}}>
                  <div className="h-3 bg-white/10 rounded w-full mb-2" />
                  <div className="h-3 bg-white/10 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8"><p className="text-slate-500 text-sm">{lang === 'he' ? 'התחל את השיחה' : 'Start the conversation'}</p></div>
        ) : null}
        {messages.map((msg) => {
          const isMe = msg.sender_id === user.id;
          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${isMe ? 'rounded-br-sm' : 'bg-white/10 rounded-bl-sm'}`}
                style={isMe ? { background: 'rgba(111,238,225,0.18)', border: '1px solid rgba(111,238,225,0.35)' } : {}}
              >
                {msg.is_offer && <div className={`text-xs mb-1 ${isMe ? 'text-[#6FEEE1]/80' : 'text-slate-400'}`}>💰 {lang === 'he' ? 'הצעת מחיר' : 'Price Offer'}</div>}
                {msg.is_offer && msg.offer_amount && <p className="text-xl font-bold text-green-400 mb-1">₪{msg.offer_amount.toLocaleString()}</p>}
                <p className="text-sm">{msg.content}</p>
                <p className={`text-[10px] mt-1 ${isMe ? 'text-[#6FEEE1]/70' : 'text-slate-500'}`}>
                  {formatMessageTime(msg.created_at, lang)}
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
          <button key={i} onClick={() => sendMessage(quick.text)}
            className="flex-shrink-0 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs hover:bg-white/10 transition-all">
            {quick.icon} {quick.text}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="px-5 py-3 border-t border-white/10">
        <div className="flex gap-2">
          <button onClick={() => {
            const amount = prompt(lang === 'he' ? 'הכנס הצעת מחיר:' : 'Enter your offer:');
            if (amount && !isNaN(amount)) sendMessage(`${lang === 'he' ? 'אני מציע' : 'I offer'} ₪${amount}`, true, parseInt(amount, 10));
          }} className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center text-green-400 hover:bg-green-500/30 transition-all">
            <DollarSign className="w-5 h-5" />
          </button>
          <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage(newMessage)}
            placeholder={lang === 'he' ? 'כתוב הודעה...' : 'Type a message...'}
            className="flex-1 px-4 py-3 rounded-xl bg-white/5 border border-white/10 focus:outline-none focus:border-[#6FEEE1]/50"
            dir={rtl ? 'rtl' : 'ltr'} />
          <button onClick={() => sendMessage(newMessage)} disabled={!newMessage.trim() || sendingMessage}
            className="w-12 h-12 rounded-xl flex items-center justify-center disabled:opacity-50 transition-all"
            style={{ background: '#6FEEE1', color: '#003733' }}>
            {sendingMessage ? <Loader2 className="w-5 h-5 animate-spin" /> : <ChevronRight className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}