import axios from 'axios';

// ─── Cache ───
let cachedRate: number | null = null;
let lastFetched: number = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam

// ─── Fallback rate if API fails ───
const FALLBACK_RATE = 16500; // ~Rp16.500/USD

// ─── Fetch USD/IDR rate from free API ───
export async function fetchUsdToIdrRate(): Promise<number> {
  const now = Date.now();
  if (cachedRate !== null && (now - lastFetched) < CACHE_TTL_MS) {
    return cachedRate;
  }

  // Try multiple free APIs for reliability
  const apis = [
    'https://open.er-api.com/v6/latest/USD',
    'https://api.exchangerate-api.com/v4/latest/USD',
  ];

  for (const url of apis) {
    try {
      const res = await axios.get(url, { timeout: 5000 });
      const rate = res.data?.rates?.IDR;
      if (rate && typeof rate === 'number' && rate > 0) {
        cachedRate = rate;
        lastFetched = now;
        console.log(`[ExchangeRate] USD/IDR = ${rate} (dari ${url.split('/')[2]})`);
        return rate;
      }
    } catch (e: any) {
      console.log(`[ExchangeRate] Gagal fetch dari ${url.split('/')[2]}: ${e.message}`);
    }
  }

  console.log(`[ExchangeRate] Pakai fallback: ${FALLBACK_RATE}`);
  return FALLBACK_RATE;
}

// ─── Convert USD to IDR ───
export async function usdToIdr(usdAmount: number): Promise<number> {
  const rate = await fetchUsdToIdrRate();
  return usdAmount * rate;
}

// ─── Get current rate info ───
export async function getRateInfo() {
  const rate = await fetchUsdToIdrRate();
  return {
    usd_to_idr: rate,
    fetched_at: lastFetched > 0 ? new Date(lastFetched).toISOString() : null,
    is_fallback: cachedRate === null || lastFetched === 0,
  };
}

// ─── Force refresh rate ───
export function clearCache() {
  cachedRate = null;
  lastFetched = 0;
}
