import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatPrice } from '../lib/utils';
import { parseFinalPrice, recordSalePrice } from '../lib/marketplaceProvenance';

// THE FINAL PRICE, FROM EACH SIDE (migration 20261115120000 record_sale_price). On a completed order, the party who has
// not yet stated the final price may state it once. Never pre-filled, never required, never a message to anyone. Both
// sides stating the same amount makes the sale "mutually reported" — still the parties' word, not a payment record.
// Shown only once the database has the column (a missing column is an error → nothing is shown).
export default function SalePriceConfirm({ orderId, userId, lang }) {
  const t = (en, he) => (lang === 'he' ? he : en);
  const [state, setState] = useState(null); // null = loading/unsupported | { mine, role }
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    if (!orderId || !userId) return undefined;
    supabase.from('orders').select('buyer_id, seller_id, status, final_price, seller_final_price').eq('id', orderId).maybeSingle()
      .then(({ data, error: e }) => {
        if (!live || e || !data || data.status !== 'completed' || data.buyer_id === data.seller_id) return;
        const role = data.seller_id === userId ? 'seller' : data.buyer_id === userId ? 'buyer' : null;
        if (!role) return;
        setState({ role, mine: role === 'seller' ? data.seller_final_price : data.final_price });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [orderId, userId]);

  if (!state) return null;
  if (state.mine) {
    return (
      <p className="text-xs text-slate-400 text-center" data-testid="sale-price-recorded">
        {t(`You recorded a final price of ${formatPrice(state.mine)}.`, `רשמת מחיר סופי של ${formatPrice(state.mine)}.`)}
      </p>
    );
  }
  const parsed = parseFinalPrice(value);
  const save = async () => {
    if (saving || !parsed.value) return;
    setSaving(true); setError(null);
    const r = await recordSalePrice(supabase, orderId, value);
    setSaving(false);
    if (r.ok) setState({ ...state, mine: parsed.value });
    else setError(t('Could not record it. Try again.', 'לא הצלחנו לשמור. נסו שוב.'));
  };
  return (
    <div className="space-y-2 text-start" data-testid="sale-price-confirm">
      <label htmlFor="sale-price" className="block text-sm font-medium text-slate-200">
        {state.role === 'seller'
          ? t('What was the final price you sold it for? (optional)', 'באיזה מחיר סופי מכרת? (לא חובה)')
          : t('What was the final price you paid? (optional)', 'כמה שילמת בפועל? (לא חובה)')}
      </label>
      <div className="flex gap-2">
        <input
          id="sale-price" inputMode="numeric" autoComplete="off" dir="ltr"
          value={value} onChange={(e) => setValue(e.target.value)} placeholder="₪"
          className="flex-1 p-3 rounded-control bg-white/5 border border-white/10 text-base text-white placeholder-slate-500"
          aria-invalid={!!parsed.error}
        />
        <button type="button" onClick={save} disabled={saving || !parsed.value}
          className="px-4 min-h-[44px] rounded-control bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">
          {t('Save', 'שמירה')}
        </button>
      </div>
      {parsed.error && <p className="text-sm text-red-300">{t('Enter a whole number of shekels.', 'הזינו מספר שלם בשקלים.')}</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}
      <p className="text-xs text-slate-400">
        {t('Recorded once, as your statement — not a payment record. It helps price similar items when both sides state the same amount.',
          'נשמר פעם אחת, כהצהרה שלך — לא כרישום תשלום. כשהקונה והמוכר מציינים את אותו סכום, זה עוזר לתמחר פריטים דומים.')}
      </p>
    </div>
  );
}
