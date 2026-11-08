import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { setTestAccount } from '../lib/marketplaceProvenance';

// Admin only: mark an account as internal/test, so its sales never count as market evidence. Rendered only when the
// database has the admin function (AdminPanel passes testIds = null otherwise).
export default function TestAccountToggle({ userId, isTest, onChange, lang }) {
  const t = (en, he) => (lang === 'he' ? he : en);
  const [busy, setBusy] = useState(false);
  const flip = async (e) => {
    e.stopPropagation();
    setBusy(true);
    const ok = await setTestAccount(supabase, userId, !isTest);
    setBusy(false);
    if (ok) onChange(userId, !isTest);
  };
  return (
    <button
      type="button" onClick={flip} disabled={busy} aria-pressed={isTest} data-testid="test-account-toggle"
      className={`px-2.5 py-1 rounded-control text-xs font-medium border ${isTest ? 'border-amber-400/40 text-amber-300 bg-amber-500/10' : 'border-white/10 text-slate-300 bg-white/5'}`}
    >
      {isTest ? t('Test account ✓', 'חשבון בדיקה ✓') : t('Mark as test account', 'סמן כחשבון בדיקה')}
    </button>
  );
}
