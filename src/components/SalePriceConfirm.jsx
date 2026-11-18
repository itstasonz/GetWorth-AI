import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatPrice } from '../lib/utils';
import { parseFinalPrice, recordSalePrice, completedPriceLine } from '../lib/marketplaceProvenance';

// A COMPLETED ORDER'S PRICE, SAID FOR WHAT IT IS (2026-11-15). The amount on the order is the LISTING price: nobody is
// told they "paid" it. Once buyer and seller have each stated the same final price (record_sale_price) it is the final
// agreed price — the two parties' word. GetWorth processes no payments, and no screen says or implies otherwise.
// The party who has not yet stated the final price may state it once: never pre-filled, never required, no message sent.
export default function SalePriceConfirm({ orderId, userId, listingPrice, lang }) {
  const t = (en, he) => (lang === 'he' ? he : en);
  const [state, setState] = useState(null); // null = loading/unsupported | { role, mine, buyer, seller }
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
        setState({ role, mine: role === 'seller' ? data.seller_final_price : data.final_price, buyer: data.final_price, seller: data.seller_final_price });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [orderId, userId]);

  const line = completedPriceLine({ listingPrice, buyer: state?.buyer, seller: state?.seller, role: state?.role, lang });
  const parsed = parseFinalPrice(value);
  const save = async () => {
    if (saving || !parsed.value) return;
    setSaving(true); setError(null);
    const r = await recordSalePrice(supabase, orderId, value);
    setSaving(false);
    if (r.ok) setState((s) => ({ ...s, mine: parsed.value, [s.role]: parsed.value }));
    else setError(t('Could not record it. Try again.', 'לא הצלחנו לשמור. נסו שוב.'));
  };
  return (
    <div className="space-y-3">
      <div className="space-y-1" data-testid="completed-price">
        <p className="text-sm text-slate-300">{line.label}: <bdi dir="ltr" className="font-semibold">{formatPrice(line.amount)}</bdi></p>
        <p className="text-xs text-slate-400">{line.note}</p>
      </div>
      {state && (state.mine ? (
        <p className="text-xs text-slate-400" data-testid="sale-price-recorded">
          {t(`You recorded a final price of ${formatPrice(state.mine)}.`, `רשמת מחיר סופי של ${formatPrice(state.mine)}.`)}
        </p>
      ) : (
        <div className="space-y-2 text-start" data-testid="sale-price-confirm">
          <label htmlFor="sale-price" className="block text-sm font-medium text-slate-200">
            {state.role === 'seller'
              ? t('What final price did you agree with the buyer? (optional)', 'על איזה מחיר סופי סיכמת עם הקונה? (לא חובה)')
              : t('What final price did you agree with the seller? (optional)', 'על איזה מחיר סופי סיכמת עם המוכר? (לא חובה)')}
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
            {t('Saved once, as your statement. It is not a payment record. When the buyer and seller state the same amount, it helps price similar items.',
              'נשמר פעם אחת, כהצהרה שלכם. זה לא רישום תשלום. כשהקונה והמוכר מציינים אותו סכום, זה עוזר לתמחר מוצרים דומים.')}
          </p>
        </div>
      ))}
    </div>
  );
}
