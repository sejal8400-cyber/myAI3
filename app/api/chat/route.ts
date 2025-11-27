// app/api/upload-file/route.ts
import { NextResponse } from 'next/server';
import { streamText } from 'ai'; // if you want to stream results directly
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import fetch from 'node-fetch'; // Node 18 has fetch in global, but include if needed

export const runtime = 'nodejs';

async function fetchPricesAlphaVantage(symbols: string[], apiKey: string) {
  // Alpha Vantage has per-minute rate limits; fetch serially or use a batch provider.
  const out: Record<string, number | null> = {};
  for (const s of symbols) {
    try {
      const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(s)}&apikey=${apiKey}`);
      const j = await r.json();
      const price = j?.['Global Quote']?.['05. price'];
      out[s] = price ? Number(price) : null;
      // Respect rate limits: sleep 12s if using free AlphaVantage (not ideal).
      await new Promise((res) => setTimeout(res, 1200)); // reduced but still spaced
    } catch (e) {
      out[s] = null;
    }
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file') as unknown as File | null;
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

    const filename = (file as any).name || 'upload';
    const ext = filename.split('.').pop()?.toLowerCase();

    let rows: any[] = [];
    if (ext === 'csv' || ext === 'txt') {
      const text = await (file as any).text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      rows = parsed.data as any[];
    } else if (ext === 'xls' || ext === 'xlsx') {
      const ab = await (file as any).arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[];
    } else {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    // Normalize: assume columns ticker/symbol and qty/quantity or first two columns
    const holdingsMap: Record<string, number> = {};
    for (const r of rows) {
      const keys = Object.keys(r);
      const ticker = (r.ticker || r.symbol || r[keys[0]] || '').toString().trim().toUpperCase();
      let qty = Number(r.qty ?? r.quantity ?? r[keys[1]] ?? 0);
      if (!ticker) continue;
      if (!qty || isNaN(qty)) qty = 0;
      holdingsMap[ticker] = (holdingsMap[ticker] || 0) + qty;
    }

    const symbols = Object.keys(holdingsMap).slice(0, 50); // limit
    const ALPHAVANTAGE_KEY = process.env.ALPHA_VANTAGE_KEY || '';
    let prices: Record<string, number | null> = {};
    if (ALPHAVANTAGE_KEY) {
      prices = await fetchPricesAlphaVantage(symbols, ALPHAVANTAGE_KEY);
    } else {
      // fallback: set nulls
      symbols.forEach((s) => (prices[s] = null));
    }

    // Build summary
    const holdings = symbols.map((s) => ({
      ticker: s,
      qty: holdingsMap[s],
      price: prices[s] ?? null,
      value: prices[s] ? holdingsMap[s] * (prices[s] as number) : null,
    }));
    const totalValue = holdings.reduce((acc, h) => acc + (h.value ?? 0), 0);

    const result = { filename, holdings, totalValue };

    // Optionally: call AI to summarize (example)
    // const aiResult = await streamText({...}); // or generateText()

    return NextResponse.json({ result });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
