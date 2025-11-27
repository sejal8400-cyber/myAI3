'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button'; // adjust if your shadcn button path differs

export default function FileUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return alert('Choose a file first');
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);

      const res = await fetch('/api/upload-file', {
        method: 'POST',
        body: form,
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Upload failed');
      setResult(typeof json.result === 'string' ? json.result : JSON.stringify(json.result, null, 2));
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleUpload} className="space-y-4">
      <div>
        <input
          id="file"
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="border rounded p-1"
        />
      </div>

      <div>
        <Button type="submit" disabled={!file || loading}>
          {loading ? 'Uploading…' : 'Upload & Analyze'}
        </Button>
      </div>

      {result && <pre className="whitespace-pre-wrap mt-2 bg-slate-50 p-2 rounded">{result}</pre>}
    </form>
  );
}
