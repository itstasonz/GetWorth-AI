import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatPrice } from '../lib/utils';
import { finalPriceSupported, parseFinalPrice } from '../lib/marketplaceProvenance';

// The buyer's final price, asked for when they complete an order. Optional and
// never pre-filled: an empty field records nothing, and the asking price is one
// tap away rather than assumed. Shown only once the database records it
// (lib/marketplaceProvenance.js finalPriceSupported).
export default function FinalPriceField({ orderId, askingPrice, value, onChange, lang }) {
  const t = (en, he) => (lang === 'he' ? he : en);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let live = true;
    finalPriceSupported(supabase, orderId).then((ok) => { if (live) setSupported(ok); });
    return () => { live = false; };
  }, [orderId]);
  if (!supported) return null;

  const parsed = parseFinalPrice(value);
  return (
    <div className="space-y-2 text-start" data-testid="final-price-field">
      <label htmlFor="final-price" className="block text-sm font-medium text-slate-200">
        {t('How much did you pay? (optional)', 'כמה שילמת בפועל? (לא חובה)')}
      </label>
      <input
        id="final-price" inputMode="numeric" autoComplete="off" dir="ltr"
        value={value} onChange={(e) => onChange(e.target.value)} placeholder="₪"
        className="w-full p-3 rounded-control bg-white/5 border border-white/10 text-base text-white placeholder-slate-500"
        aria-invalid={!!parsed.error}
      />
      {Number(askingPrice) > 0 && (
        <button type="button" onClick={() => onChange(String(askingPrice))} className="text-sm underline underline-offset-2 text-slate-300">
          {t(`I paid the asking price, ${formatPrice(askingPrice)}`, `שילמתי את המחיר המבוקש, ${formatPrice(askingPrice)}`)}
        </button>
      )}
      {parsed.error && <p className="text-sm text-red-300">{t('Enter a whole number of shekels.', 'הזינו מספר שלם בשקלים.')}</p>}
      <p className="text-xs text-slate-400">
        {t('It helps others price similar items. It is recorded as your confirmation, not as a payment record.',
          'זה עוזר לאחרים לתמחר פריטים דומים. הסכום נשמר כאישור שלך, לא כרישום תשלום.')}
      </p>
    </div>
  );
}
