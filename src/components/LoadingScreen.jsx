import React from 'react';

// Shown as a Suspense fallback while lazy view bundles load.
// fullscreen=true  → fixed overlay covering the entire viewport (camera/results/chat)
// fullscreen=false → fills the current content container (inbox/orders/etc.)
export default function LoadingScreen({ fullscreen = true }) {
  const base = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#131313',
  };

  const style = fullscreen
    ? { ...base, position: 'fixed', inset: 0, zIndex: 50 }
    : { ...base, width: '100%', minHeight: '60dvh' };

  return (
    <div style={style} aria-busy="true" aria-label="Loading">
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        style={{ animation: 'spin 0.9s linear infinite' }}
      >
        <circle cx="16" cy="16" r="13" stroke="#3c4947" strokeWidth="3" />
        <path
          d="M16 3 A13 13 0 0 1 29 16"
          stroke="#6FEEE1"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </svg>
    </div>
  );
}
