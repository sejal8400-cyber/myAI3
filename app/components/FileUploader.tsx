// app/components/FileUploader.tsx
'use client';
import React, { useRef, useState } from 'react';
import { useChat } from 'ai/react'; // ensure 'ai' package installed
import { Button } from '@/components/ui/button'; // adapt if path differs

export default function FileUploader() {
  const { sendMessage } = useChat();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);

  function openFilePicker() { inputRef.current?.click(); }

  function handleSelection(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setFilename(f?.name ?? null);
    setPreviewText(null);
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return alert('Choose a file first');
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      // POST to Node upload route
      const res = await fetch('/api/upload-file', {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Upload failed');
      // json.result should include processed portfolio summary
      setPreviewText(JSON.stringify(json.result, null, 2));
      // optionally send into chat as structured payload for AI analysis
      const payloadText = `<HOLDINGS_JSON>${JSON.stringify(json.result)}</HOLDINGS_JSON>`;
      await sendMessage({ text: `I've uploaded ${filename || 'file'}. Sending holdings for analysis.` });
      await sendMessage({ text: payloadText });
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Upload failed');
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
      setFile(null);
      setFilename(null);
    }
  }

  return (
    <div className="space-y-3">
      <input ref={inputRef} type="file" accept=".csv,.txt,.xls,.xlsx" onChange={handleSelection} style={{display:'none'}} />
      <div className="flex items-center gap-3">
        <Button type="button" onClick={openFilePicker}>Choose file</Button>
        <span>{filename ?? 'No file selected'}</span>
        <Button onClick={handleUpload} disabled={!file || loading}>{loading ? 'Uploading…' : 'Upload & Analyze'}</Button>
      </div>
      {previewText && <pre className="mt-2 bg-slate-50 p-2 rounded whitespace-pre-wrap">{previewText}</pre>}
    </div>
  );
}
