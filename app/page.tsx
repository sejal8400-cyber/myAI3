'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import * as z from 'zod';

import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useChat } from '@ai-sdk/react';
import { ArrowUp, Loader2, Plus, Upload } from 'lucide-react';
import Image from 'next/image';
import { MessageWall } from '@/components/messages/message-wall';
import { UIMessage } from 'ai';
import { useEffect, useState, useRef } from 'react';
import { AI_NAME, CLEAR_CHAT_TEXT, OWNER_NAME, WELCOME_MESSAGE } from '@/config';
import Link from 'next/link';

import Papa from 'papaparse';
import * as XLSX from 'xlsx';

const formSchema = z.object({
  message: z.string().max(2000, 'Message must be at most 2000 characters.'),
});

const STORAGE_KEY = 'chat-messages';

type StorageData = {
  messages: UIMessage[];
  durations: Record<string, number>;
};

const loadMessagesFromStorage = (): { messages: UIMessage[]; durations: Record<string, number> } => {
  if (typeof window === 'undefined') return { messages: [], durations: {} };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { messages: [], durations: {} };

    const parsed = JSON.parse(stored);
    return {
      messages: parsed.messages || [],
      durations: parsed.durations || {},
    };
  } catch (error) {
    console.error('Failed to load messages from localStorage:', error);
    return { messages: [], durations: {} };
  }
};

const saveMessagesToStorage = (messages: UIMessage[], durations: Record<string, number>) => {
  if (typeof window === 'undefined') return;
  try {
    const data: StorageData = { messages, durations };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save messages to localStorage:', error);
  }
};

function normalizeRowsToHoldings(rows: any[]): { ticker: string; qty: number }[] {
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
    const normTicker = ticker.toUpperCase();
    if (!(normTicker in out)) out[normTicker] = 0;
    out[normTicker] += qty;
  }
  return Object.entries(out).map(([ticker, qty]) => ({ ticker, qty }));
}

export default function Chat() {
  const [isClient, setIsClient] = useState(false);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const welcomeMessageShownRef = useRef<boolean>(false);

  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<{ ticker: string; qty: number }[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const stored = typeof window !== 'undefined' ? loadMessagesFromStorage() : { messages: [], durations: {} };
  const [initialMessages] = useState<UIMessage[]>(stored.messages);

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    messages: initialMessages,
  });

  useEffect(() => {
    setIsClient(true);
    setDurations(stored.durations);
    setMessages(stored.messages);
  }, []);

  useEffect(() => {
    if (isClient) {
      saveMessagesToStorage(messages, durations);
    }
  }, [durations, messages, isClient]);

  const handleDurationChange = (key: string, duration: number) => {
    setDurations((prevDurations) => {
      const newDurations = { ...prevDurations };
      newDurations[key] = duration;
      return newDurations;
    });
  };

  useEffect(() => {
    if (isClient && initialMessages.length === 0 && !welcomeMessageShownRef.current) {
      const welcomeMessage: UIMessage = {
        id: `welcome-${Date.now()}`,
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: WELCOME_MESSAGE,
          },
        ],
      };
      setMessages([welcomeMessage]);
      saveMessagesToStorage([welcomeMessage], {});
      welcomeMessageShownRef.current = true;
    }
  }, [isClient, initialMessages.length, setMessages]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      message: '',
    },
  });

  async function parseFileForPreview(f: File) {
    const name = f.name.toLowerCase();
    try {
      if (name.endsWith('.csv') || name.endsWith('.txt')) {
        const text = await f.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        const holdings = normalizeRowsToHoldings(parsed.data as any[]);
        setFilePreview(holdings);
      } else if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
        const ab = await f.arrayBuffer();
        const wb = XLSX.read(ab, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[];
        const holdings = normalizeRowsToHoldings(json);
        setFilePreview(holdings);
      } else {
        throw new Error('Unsupported file type. Use CSV or Excel (xls/xlsx).');
      }
    } catch (err: any) {
      console.error('Failed to parse file for preview', err);
      toast.error('Failed to parse file. Ensure it has columns like ticker,symbol and qty,quantity');
      setFilePreview(null);
    }
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setFileName(f?.name ?? null);
    setFilePreview(null);
    if (f) parseFileForPreview(f);
  }

  async function uploadFileToServer() {
    try {
      if (!file) return { ok: false, error: 'No file' };
      const fd = new FormData();
      fd.append('file', file, file.name);

      const res = await fetch('/api/upload-file', {
        method: 'POST',
        body: fd,
      });

      const json = await res.json();
      if (!res.ok) {
        console.warn('Server upload failed', json);
        return { ok: false, error: json?.error || 'Upload failed' };
      }
      return { ok: true, result: json.result };
    } catch (err: any) {
      console.error('Upload error', err);
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async function onSubmit(data: z.infer<typeof formSchema>) {
    const trimmed = data.message.trim();

    if (!trimmed && !file) {
      toast.error('Type a message or attach a portfolio file first.');
      return;
    }

    try {
      if (file) {
        if (!filePreview) {
          await parseFileForPreview(file);
        }

        const payloadObj = { holdings: filePreview ?? [] };
        const payloadText = `<HOLDINGS_JSON>${JSON.stringify(payloadObj)}</HOLDINGS_JSON>\n`;

        const uploadResp = await uploadFileToServer();
        if (!uploadResp?.ok) {
          console.warn('Upload failed but will still send holdings to assistant', uploadResp);
        }

        await sendMessage({ text: `I've uploaded ${fileName || 'a file'}. Sending holdings for analysis.` });
        await sendMessage(
          { text: payloadText },
          {}
        );

        setFile(null);
        setFileName(null);
        setFilePreview(null);
      } else {
        await sendMessage({ text: trimmed });
      }

      form.reset();
    } catch (err: any) {
      console.error(err);
      toast.error('Could not send file/message. Please try again.');
    }
  }

  function clearChat() {
    const newMessages: UIMessage[] = [];
    const newDurations = {};
    setMessages(newMessages);
    setDurations(newDurations);
    setFile(null);
    setFilePreview(null);
    saveMessagesToStorage(newMessages, newDurations);
    toast.success('Chat cleared');
  }

  return (
    <div className="flex h-screen items-center justify-center font-sans bg-[#0D0D0E]">
      <main className="w-full bg-[#0D0D0E] h-screen relative">
        {/* Header */}
        <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-b from-[#0D0D0E] via-[#0D0D0E]/95 to-transparent pb-8">
          <div className="w-full flex items-center justify-between py-4 px-6 border-b border-[#1A1A1C]">
            <div className="flex items-center gap-3">
              <Image 
                src="/logo.png" 
                alt="Penny Logo" 
                width={32} 
                height={32} 
                className="h-8 w-8 object-contain"
                priority
              />
              <h1 className="text-white font-semibold text-base tracking-tight">Penny</h1>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-[#8B8B8B] hover:text-white hover:bg-[#1A1A1C] border border-[#2A2A2D] rounded-lg h-9 px-3"
              onClick={clearChat}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              {CLEAR_CHAT_TEXT}
            </Button>
          </div>
        </div>

        {/* Chat Area */}
        <div className="h-screen overflow-y-auto px-6 py-4 w-full pt-24 pb-48">
          <div className="flex flex-col items-center justify-end min-h-full">
            {isClient ? (
              <>
                <MessageWall messages={messages} status={status} durations={durations} onDurationChange={handleDurationChange} />
                {status === 'submitted' && (
                  <div className="flex justify-start max-w-3xl w-full mt-4">
                    <div className="flex items-center gap-2 text-[#6B6B6B]">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Analyzing...</span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex justify-center max-w-2xl w-full">
                <Loader2 className="w-5 h-5 animate-spin text-[#6B6B6B]" />
              </div>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-gradient-to-t from-[#0D0D0E] via-[#0D0D0E]/98 to-transparent pt-6">
          <div className="w-full px-6 pb-4 items-center flex justify-center">
            <div className="max-w-3xl w-full">
              <form id="chat-form" onSubmit={form.handleSubmit(onSubmit)}>
                <div className="bg-[#1A1A1C] rounded-xl border border-[#2A2A2D] overflow-hidden">
                  {/* File upload section */}
                  {fileName && filePreview && filePreview.length > 0 && (
                    <div className="px-4 py-3 border-b border-[#2A2A2D]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-white font-medium">Portfolio Holdings</span>
                        <button 
                          type="button" 
                          className="text-xs text-[#6B6B6B] hover:text-white transition-colors"
                          onClick={() => { setFile(null); setFileName(null); setFilePreview(null); }}
                        >
                          Remove
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {filePreview.slice(0, 8).map((h) => (
                          <span key={h.ticker} className="text-xs bg-[#2A2A2D] text-[#8B8B8B] px-2 py-1 rounded">
                            {h.ticker}: {h.qty}
                          </span>
                        ))}
                        {filePreview.length > 8 && (
                          <span className="text-xs text-[#6B6B6B]">+{filePreview.length - 8} more</span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3 p-3">
                    {/* File upload button */}
                    <label className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#2A2A2D] hover:bg-[#3A3A3D] cursor-pointer transition-colors">
                      <Upload className="w-4 h-4 text-[#8B8B8B]" />
                      <input
                        type="file"
                        accept=".csv,.txt,.xls,.xlsx"
                        className="hidden"
                        onChange={onFileSelected}
                      />
                    </label>

                    {/* Message input */}
                    <Controller
                      name="message"
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <div className="flex-1">
                          <Input
                            {...field}
                            id="chat-form-message"
                            className="h-10 bg-transparent border-0 text-white placeholder:text-[#6B6B6B] focus-visible:ring-0 focus-visible:border-0 px-0"
                            placeholder={file ? 'Add a question about your portfolio...' : 'Ask about your portfolio...'}
                            disabled={status === 'streaming'}
                            aria-invalid={fieldState.invalid}
                            autoComplete="off"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                form.handleSubmit(onSubmit)();
                              }
                            }}
                          />
                        </div>
                      )}
                    />

                    {/* Send/Stop button */}
                    {(status === 'ready' || status === 'error') ? (
                      <Button 
                        type="submit" 
                        disabled={!form.watch('message').trim() && !file}
                        size="icon"
                        className="w-10 h-10 rounded-lg bg-white hover:bg-gray-200 disabled:bg-[#2A2A2D] disabled:text-[#6B6B6B]"
                      >
                        <ArrowUp className="w-4 h-4 text-[#0D0D0E]" />
                      </Button>
                    ) : (
                      <Button 
                        type="button" 
                        onClick={() => stop()}
                        size="icon"
                        className="w-10 h-10 rounded-lg bg-[#2A2A2D] hover:bg-[#3A3A3D]"
                      >
                        <div className="w-3 h-3 bg-white rounded-sm" />
                      </Button>
                    )}
                  </div>
                </div>
              </form>

              {/* Footer */}
              <div className="flex items-center justify-center gap-1 mt-3 text-xs text-[#4A4A4D]">
                <span>&copy; {new Date().getFullYear()} {OWNER_NAME}</span>
                <span className="mx-1">·</span>
                <Link href="/terms" className="hover:text-[#6B6B6B] transition-colors">Terms</Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
