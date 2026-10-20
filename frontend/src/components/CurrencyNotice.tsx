import { useMeta } from '../hooks/useMeta';
import type { DatasetMetaResponse } from '../api/types';

interface CurrencyNoticeProps {
  meta?: DatasetMetaResponse | null;
}

export function CurrencyNotice({ meta: propMeta }: CurrencyNoticeProps = {}) {
  const hookMeta = useMeta().meta;
  const meta = propMeta !== undefined ? propMeta : hookMeta;

  if (meta?.display_currency !== 'INR' || !meta?.usd_to_inr_rate) {
    return null;
  }

  return (
    <div
      role="note"
      className="p-3 bg-blue-950/60 border border-blue-700/60 rounded-lg text-xs text-blue-200"
      data-testid="currency-notice"
    >
      Amounts are stored in USD and shown in INR at a configured rate of 1 USD = ₹{meta.usd_to_inr_rate} (assumption, not a live exchange rate).
    </div>
  );
}
