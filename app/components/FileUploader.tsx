// app/components/FileUploader.tsx
"use client";

import React, { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import Papa from "papaparse";
import * as XLSX from "xlsx";

type Holding = { ticker: string; qty: number };

export default function FileUploader({ sendMessage }: { sendMessage: any }) {
  // const { sendMessage } = useChat(); // Removed internal hook
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Holding[] | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  function openFilePicker() {
    if (inputRef.current) inputRef.current.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setFilename(file.name);
    setPreview(null);

    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let holdings: Holding[] = [];

      if (ext === "csv" || ext === "txt") {
        const text = await file.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        holdings = normalizeRowsToHoldings(parsed.data as any[]);
      } else if (ext === "xls" || ext === "xlsx") {
        const ab = await file.arrayBuffer();
        const wb = XLSX.read(ab, { type: "array" });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as any[];
        holdings = normalizeRowsToHoldings(json);
      } else {
        throw new Error("Unsupported file type. Use CSV or Excel.");
      }

      if (!holdings || holdings.length === 0) {
        throw new Error("No holdings found. Ensure CSV/XLSX has columns 'ticker' and 'qty' (or first two columns are ticker, qty).");
      }

      setPreview(holdings);
    } catch (err: any) {
      console.error("File parse failed:", err);
      alert("Failed to parse file: " + (err?.message || err));
    } finally {
      setLoading(false);
      // reset input so same file can be reselected
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function normalizeRowsToHoldings(rows: any[]): Holding[] {
    const out: Record<string, number> = {};
    for (const r of rows) {
      const keys = Object.keys(r);
      let ticker = "";
      let qty: number | null = null;

      if ("ticker" in r) ticker = String(r["ticker"]).trim();
      else if ("symbol" in r) ticker = String(r["symbol"]).trim();
      else if (keys.length >= 1) ticker = String(r[keys[0]]).trim();

      if ("qty" in r) qty = Number(r["qty"]);
      else if ("quantity" in r) qty = Number(r["quantity"]);
      else if (keys.length >= 2) qty = Number(r[keys[1]]);

      if (!ticker) continue;
      if (!qty || isNaN(qty)) qty = 0;
      if (!(ticker in out)) out[ticker] = 0;
      out[ticker] += qty;
    }
    return Object.entries(out).map(([ticker, qty]) => ({ ticker, qty }));
  }

  async function confirmAndSend() {
    if (!preview || preview.length === 0) return;
    const payloadObj = { holdings: preview };
    const payloadText = `<HOLDINGS_JSON>${JSON.stringify(payloadObj)}</HOLDINGS_JSON>\n`;
    const messageText = `I've uploaded ${filename || "file"}. Please analyze these holdings based on the system instructions.\n\n${payloadText}`;
    await sendMessage({ text: messageText });
    setPreview(null);
    setFilename(null);
  }

  return (
    <div style={{ marginTop: 12 }}>
      {/* Hidden input controlled by ref */}
      <input
        ref={inputRef}
        id="file-upload-input"
        type="file"
        accept=".csv,.txt,.xls,.xlsx"
        onChange={handleFile}
        style={{ display: "none" }}
      />

      {/* Use explicit onClick to open file picker */}
      <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        <Button onClick={openFilePicker} variant="outline" size="sm">
          Upload file
        </Button>
        {loading ? <span>Parsing…</span> : filename ? <span>{filename}</span> : null}
      </div>

      {preview && (
        <div style={{ marginTop: 12, border: "1px solid #eee", padding: 8, maxWidth: 560 }}>
          <div><strong>Preview detected holdings</strong></div>
          <ul>
            {preview.map((h) => <li key={h.ticker}>{h.ticker}: {h.qty}</li>)}
          </ul>
          <div style={{ marginTop: 8 }}>
            <Button onClick={confirmAndSend} variant="default" size="sm">Confirm &amp; Send to Assistant</Button>
            <Button onClick={() => { setPreview(null); setFilename(null); }} variant="ghost" size="sm" style={{ marginLeft: 8 }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
