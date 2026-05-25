/**
 * urlSync.js — Phase 3A
 *
 * Bridges AppContext's view/tab state machine to the browser History API.
 * Enables Android hardware back, browser back, and URL-based refresh restore.
 *
 * Design principles:
 *  - NO cold fetch (Phase 3B). Deep links without in-memory state fall back to parent.
 *  - Ephemeral views (camera / analyzing / results / listing flow) never pollute the back stack;
 *    they DO push a sentinel entry so Android back doesn't exit the app.
 *  - Modal/sheet back interception: any open modal absorbs the back press before view navigation.
 *  - Uses pushState for forward navigation, replaceState for tab switches / in-app back.
 *
 * Push vs Replace decision tree:
 *  1. Tab changed                   → replaceState  (switching tab never adds back-stack entry)
 *  2. Leaving an ephemeral view     → replaceState  (scan flow cleanup)
 *  3. Object cleared (detail close) → replaceState  (in-app back button)
 *  4. Object opened (detail open)   → pushState     (should be back-navigable)
 *  5. Moving to deeper view level   → pushState
 *  6. Everything else               → replaceState
 */

import { useEffect, useRef } from 'react';

// ── View hierarchy depth ──────────────────────────────────────────────────────
// -1 ephemeral: never own a real URL entry; push a same-URL sentinel instead
//  0 app root
//  1 tab root views
//  2 sub-views within a tab
const VIEW_DEPTH = {
  home:          0,
  browse:        1, myListings: 1, inbox: 1, orders: 1,
  profile:       1, auth:       1, saved: 1,
  detail:        2, sellerProfile: 2, chat:  2, orderDetail: 2,
  admin:         2, notifications: 2, analytics: 2,
  // Ephemeral scan flow
  camera: -1, analyzing: -1, results: -1, listing: -1,
};

const EPHEMERAL = new Set(['camera', 'analyzing', 'results', 'listing']);

// ── URL builder ───────────────────────────────────────────────────────────────
// Returns null for ephemeral views (caller skips URL mutation).
export function buildUrlFromState({ view, selected, activeChat, activeOrder }) {
  switch (view) {
    case 'home':          return '/';
    case 'browse':        return '/browse';
    case 'detail':        return selected?.id   ? `/listing/${selected.id}`        : '/browse';
    case 'sellerProfile': return selected?.id   ? `/listing/${selected.id}`        : '/browse';
    case 'auth':          return '/profile';
    case 'profile':       return '/profile';
    case 'saved':         return '/saved';
    case 'inbox':         return '/inbox';
    case 'chat':          return activeChat?.id  ? `/inbox/${activeChat.id}`       : '/inbox';
    case 'myListings':    return '/sell';
    case 'orders':        return '/orders';
    case 'orderDetail':   return activeOrder?.id ? `/orders/${activeOrder.id}`     : '/orders';
    case 'notifications': return '/orders';
    case 'analytics':     return '/profile';
    case 'admin':         return '/admin';
    default:              return null; // ephemeral views
  }
}

// ── URL parser ────────────────────────────────────────────────────────────────
// Phase 3A: no cold fetch. Deep links without in-memory state fall back to parent.
// `_fallback: true` signals the caller to redirect to the parent without error.
export function parseUrlToState(pathname) {
  const p = pathname.replace(/\/$/, '') || '/';

  if (p === '/')        return { view: 'home',       tab: 'home' };
  if (p === '/browse')  return { view: 'browse',     tab: 'browse' };
  if (p === '/sell')    return { view: 'myListings', tab: 'sell' };
  if (p === '/orders')  return { view: 'orders',     tab: 'sell' };
  if (p === '/inbox')   return { view: 'inbox',      tab: 'messages' };
  if (p === '/profile') return { view: 'profile',    tab: 'profile' };
  if (p === '/admin')   return { view: 'admin',      tab: 'profile' };
  if (p === '/saved')   return { view: 'saved',      tab: 'profile' };

  // Deep links — fall back to parent (Phase 3B adds cold fetch here)
  if (p.startsWith('/listing/')) return { view: 'browse', tab: 'browse',   _fallback: true };
  if (p.startsWith('/orders/'))  return { view: 'orders', tab: 'sell',     _fallback: true };
  if (p.startsWith('/inbox/'))   return { view: 'inbox',  tab: 'messages', _fallback: true };

  return { view: 'home', tab: 'home' };
}

// ── Modal priority helper ─────────────────────────────────────────────────────
function getTopModal({ showSignInModal, showCheckout, showContact }) {
  if (showSignInModal) return 'signIn';
  if (showCheckout)    return 'checkout';
  if (showContact)     return 'contact';
  return null;
}

// ── Main hook ─────────────────────────────────────────────────────────────────
export function useUrlSync({
  view,   setView,
  tab,    setTab,
  selected,    setSelected,
  activeChat,  setActiveChat,
  activeOrder, setActiveOrder,
  stopCamera,
  cancelPipeline,
  showSignInModal, setShowSignInModal,
  showCheckout,    setShowCheckout,
  showContact,     setShowContact,
  user,
}) {
  // Guards & previous-value tracking
  const handlingPopRef  = useRef(false);
  const lastUrlRef      = useRef(null);
  const prevViewRef     = useRef(view);
  const prevTabRef      = useRef(tab);
  const prevSelRef      = useRef(selected);
  const prevChatRef     = useRef(activeChat);
  const prevOrderRef    = useRef(activeOrder);

  // ── 1. Mount: initialise URL from current pathname ───────────────────────
  useEffect(() => {
    const { view: iv, tab: it } = parseUrlToState(window.location.pathname);
    // If profile but no user, show auth instead
    const rv = iv === 'profile' && !user ? 'auth' : iv;
    const url = buildUrlFromState({ view: rv, selected: null, activeChat: null, activeOrder: null }) ?? '/';

    history.replaceState({ view: rv, tab: it }, '', url);
    lastUrlRef.current  = url;
    prevViewRef.current = rv;
    prevTabRef.current  = it;

    // Only set state if we're not already at home (avoids unnecessary re-render)
    if (rv !== 'home' || it !== 'home') {
      setTab(it);
      setView(rv);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  // ── 2. State → URL ───────────────────────────────────────────────────────
  useEffect(() => {
    if (handlingPopRef.current) return; // Popstate is driving — don't push again

    // ── Ephemeral views: sentinel history entry ──────────────────────────
    // Gives Android back "something to pop" without a visible URL change.
    // IMPORTANT: only ONE sentinel per scan session — transitions within the
    // ephemeral flow (camera→analyzing→results→listing) use replaceState so
    // we don't accumulate 4 back-presses worth of stale sentinels.
    if (EPHEMERAL.has(view)) {
      if (prevViewRef.current !== view) {
        const prevWasEphemeral = EPHEMERAL.has(prevViewRef.current);
        if (prevWasEphemeral) {
          // Already inside the ephemeral flow — replace the existing sentinel
          history.replaceState(
            { view, tab, _ephemeral: true },
            '',
            window.location.pathname + window.location.search,
          );
        } else {
          // First entry into the ephemeral flow — push ONE sentinel
          history.pushState(
            { view, tab, _ephemeral: true },
            '',
            window.location.pathname + window.location.search,
          );
        }
      }
      prevViewRef.current = view;
      prevTabRef.current  = tab;
      prevSelRef.current  = selected;
      prevChatRef.current = activeChat;
      prevOrderRef.current = activeOrder;
      return;
    }

    const newUrl = buildUrlFromState({ view, selected, activeChat, activeOrder });
    if (!newUrl) return; // should not happen for non-ephemeral views

    // Skip duplicate URL updates
    if (newUrl === lastUrlRef.current) {
      prevViewRef.current  = view;
      prevTabRef.current   = tab;
      prevSelRef.current   = selected;
      prevChatRef.current  = activeChat;
      prevOrderRef.current = activeOrder;
      return;
    }

    // ── Push vs Replace decision ─────────────────────────────────────────
    const tabChanged    = tab !== prevTabRef.current;
    const prevEphemeral = EPHEMERAL.has(prevViewRef.current);
    const objectOpened  = (selected    && !prevSelRef.current)   ||
                          (activeChat  && !prevChatRef.current)  ||
                          (activeOrder && !prevOrderRef.current);
    const objectCleared = (!selected    && prevSelRef.current)   ||
                          (!activeChat  && prevChatRef.current)  ||
                          (!activeOrder && prevOrderRef.current);
    const newDepth      = VIEW_DEPTH[view] ?? 1;
    const prevDepth     = VIEW_DEPTH[prevViewRef.current] ?? 1;

    let push;
    if (tabChanged || prevEphemeral || objectCleared) {
      push = false; // replace: tab switch / scan exit / in-app back
    } else if (objectOpened) {
      push = true;  // opening detail / chat / order
    } else {
      push = newDepth > prevDepth; // depth-based fallback
    }

    // Commit tracking refs before mutating history (avoids race on re-render)
    lastUrlRef.current   = newUrl;
    prevViewRef.current  = view;
    prevTabRef.current   = tab;
    prevSelRef.current   = selected;
    prevChatRef.current  = activeChat;
    prevOrderRef.current = activeOrder;

    if (push) {
      history.pushState({ view, tab }, '', newUrl);
    } else {
      history.replaceState({ view, tab }, '', newUrl);
    }
  }, [view, tab, selected, activeChat, activeOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 3. Popstate → state ──────────────────────────────────────────────────
  useEffect(() => {
    const handlePop = () => {
      // ── Modal interception ───────────────────────────────────────────────
      // Any open modal/sheet absorbs the back press. Re-push current URL so
      // the browser position doesn't actually change, then close the modal.
      const topModal = getTopModal({ showSignInModal, showCheckout, showContact });
      if (topModal) {
        const currentUrl =
          buildUrlFromState({ view, selected, activeChat, activeOrder }) ??
          window.location.pathname;
        history.pushState({ view, tab }, '', currentUrl);
        if (topModal === 'signIn')   setShowSignInModal(false);
        if (topModal === 'checkout') setShowCheckout(false);
        if (topModal === 'contact')  setShowContact(false);
        return;
      }

      // ── Scan flow: delegate to existing cancel handlers ──────────────────
      // The cancel functions call setView() themselves; URL sync will catch up.
      if (view === 'camera')                       { stopCamera();    return; }
      if (view === 'analyzing' || view === 'results') { cancelPipeline(); return; }

      // ── Normal URL-driven navigation ─────────────────────────────────────
      handlingPopRef.current = true;

      const { view: tv, tab: tt } = parseUrlToState(window.location.pathname);
      const rv = tv === 'profile' && !user ? 'auth' : tv;

      // Pre-update tracking refs so URL sync skips when it fires
      lastUrlRef.current   = window.location.pathname;
      prevViewRef.current  = rv;
      prevTabRef.current   = tt;
      prevSelRef.current   = null;
      prevChatRef.current  = null;
      prevOrderRef.current = null;

      // Apply state
      setTab(tt);
      if (rv === 'browse' || rv === 'home') setSelected(null);
      if (rv === 'inbox')                   setActiveChat(null);
      if (rv === 'orders')                  setActiveOrder(null);
      setView(rv);

      // Release guard after React has committed the update
      setTimeout(() => { handlingPopRef.current = false; }, 16);
    };

    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [
    // All closure values that the handler reads
    view, tab, selected, activeChat, activeOrder,
    showSignInModal, showCheckout, showContact,
    user,
    stopCamera, cancelPipeline,
    setView, setTab, setSelected, setActiveChat, setActiveOrder,
    setShowSignInModal, setShowCheckout, setShowContact,
  ]);
}
