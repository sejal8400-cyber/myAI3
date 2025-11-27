// app/components/FileUploader.tsx
'use client';

import React, { useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react'; // adjust if your SDK hook path differs
import { Button } from '@/components/ui/button'; // adjust if your shadcn button path differs
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

type Holding = { ticker: string; qty: number };

export default function FileUploader() {
  const { sendMessage } = useChat();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Holding[] | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function openFilePicker() {
    inputRef.current?.click();
  }

  // When user selects a file from the file input
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setFilename(f?.name ?? null);
    // clear previous preview/result when a new file is chosen
    setPreview(null);
    setResult(null);
  }

  // Normalize parsed rows (CSV / XLSX) to list of holdings
  function normalizeRowsToHoldings(rows: any[]): Holding[] {
    const out: Record<string, number> = {};
    for (const r of rows) {
      const keys = Object.keys(r);
      let ticker = '';
      let qty: number | null = null;

      if ('ticker' in r) ticker = String(r['ticker']).trim();
      else if ('symbol' in r) ticker = String(r['symbol']).trim();
      else if (keys.length >= 1) ticker = String(r[keys[0]]).trim();

      if ('qty' in r) qty = Number(r['qty']);
      else if ('quantity' in r) qty = Number(r['quantity']);
      else if (keys.length >= 2) qty = Number(r[keys[1]]);

      if (!ticker) continue;
      if (!qty || isNaN(qty)) qty = 0;
      if (!(ticker in out)) out[ticker] = 0;
      out[ticker] += qty;
    }
    return Object.entries(out).map(([ticker, qty]) => ({ ticker, qty }));
  }

  // Parse the selected file, show preview, then upload file to server and set result
  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return alert('Choose a file first');
    setLoading(true);
    setResult(null);

    try {
      const ext = file.name.split('.').pop()?.toLowerCase();
      let holdings: Holding[] = [];

      if (ext === 'csv' || ext === 'txt') {
        const text = await file.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        holdings = normalizeRowsToHoldings(parsed.data as any[]);
      } else if (ext === 'xls' || ext === 'xlsx') {
        const ab = await file.arrayBuffer();
        const wb = XLSX.read(ab, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[];
        holdings = normalizeRowsToHoldings(json);
      } else {
        throw new Error('Unsupported file type. Use CSV or Excel (xls/xlsx).');
      }

      if (!holdings || holdings.length === 0) {
        throw new Error("No holdings found. Ensure CSV/XLSX has columns 'ticker' and 'qty' (or first two columns are ticker, qty).");
      }

      // show preview
      setPreview(holdings);

      // Upload the original file to server-side route (for model-based processing)
      const form = new FormData();
      form.append('file', file);

      const res = await fetch('/api/upload-file', {
        method: 'POST',
        body: form,
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Upload failed');

      // store result (model response) for display
      setResult(typeof json.result === 'string' ? json.result : JSON.stringify(json.result, null, 2));
    } catch (err: any) {
      console.error('File parse/upload failed:', err);
      alert('Error: ' + (err?.message || String(err)));
    } finally {
      setLoading(false);
      // reset input value so same file can be re-selected if needed
      if (inputRef.current) inputRef.current.value = '';
      // keep `file` state if you want; we leave it as-is so user can confirm
    }
  }

  // Confirm preview and send holdings into chat (as structured payload)
  async function confirmAndSend() {
    if (!preview || preview.length === 0) return;
    const payloadObj = { holdings: preview };
    const payloadText = `<HOLDINGS_JSON>${JSON.stringify(payloadObj)}</HOLDINGS_JSON>\n`;

    await sendMessage({ text: `I've uploaded ${filename || 'file'}. Sending holdings for analysis.` });
    await sendMessage({ text: payloadText });

    // clear preview & filename after sending
    setPreview(null);
    setFilename(null);
    setFile(null);
  }

  return (
    <div className="space-y-4">
      {/* Hidden input controlled by ref */}
      <input
        ref={inputRef}
        id="file-upload-input"
        type="file"
        accept=".csv,.txt,.xls,.xlsx"
        onChange={handleFile}
        style={{ display: 'none' }}
      />

      <form onSubmit={handleUpload} className="space-y-4">
        <div className="flex items-center gap-3">
          <Button type="button" onClick={openFilePicker} variant="outline" size="sm">
            Choose file
          </Button>

          <div>
            <span className="text-sm text-muted-foreground">
              {filename ?? 'No file selected'}
            </span>
          </div>

          <div>
            <Button type="submit" disabled={!file || loading} variant="default" size="sm">
              {loading ? 'Parsing & Uploading…' : 'Parse & Upload'}
            </Button>
          </div>
        </div>

        {preview && (
          <div className="mt-2 border rounded p-3 max-w-xl">
            <div className="font-medium mb-2">Preview detected holdings</div>
            <ul className="list-disc pl-5">
              {preview.map((h) => (
                <li key={h.ticker}>
                  {h.ticker}: {h.qty}
                </li>
              ))}
            </ul>

            <div className="mt-3 flex gap-2">
              <Button onClick={confirmAndSend} size="sm" variant="default">
                Confirm & Send to Assistant
              </Button>
              <Button
                onClick={() => {
                  setPreview(null);
                  setFilename(null);
                  setFile(null);
                }}
                size="sm"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {result && (
          <div className="mt-2">
            <div className="font-medium mb-1">Model result</div>
            <pre className="whitespace-pre-wrap mt-2 bg-slate-50 p-2 rounded">{result}</pre>
          </div>
        )}
      </form>
    </div>
  );
}
