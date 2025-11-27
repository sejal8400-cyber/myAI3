// app/chat/page.tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import * as z from 'zod';

import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useChat } from 'ai/react';
import { ArrowUp, Loader2, Plus, Square, Upload } from 'lucide-react';
import { MessageWall } from '@/components/messages/message-wall';
import { ChatHeader } from '@/app/parts/chat-header';
import { ChatHeaderBlock } from '@/app/parts/chat-header';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UIMessage } from 'ai';
import { useEffect, useState, useRef } from 'react';
import { AI_NAME, CLEAR_CHAT_TEXT, OWNER_NAME, WELCOME_MESSAGE } from '@/config';
import Image from 'next/image';
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
    return { messages: parsed.messages || [], durations: parsed.durations || {} };
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

// Normalize parsed rows (CSV / XLSX) to list of holdings
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

  // CSV file state (replaces image flow)
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<{ ticker: string; qty: number }[] | null>(null);
  const [csvFilename, setCsvFilename] = useState<string | null>(null);

  const stored = typeof window !== 'undefined' ? loadMessagesFromStorage() : { messages: [], durations: {} };
  const [initialMessages] = useState<UIMessage[]>(stored.messages);

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    messages: initialMessages,
  });

  useEffect(() => {
    setIsClient(true);
    setDurations(stored.durations);
    setMessages(stored.messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        parts: [{ type: 'text', text: WELCOME_MESSAGE }],
      };
      setMessages([welcomeMessage]);
      saveMessagesToStorage([welcomeMessage], {});
      welcomeMessageShownRef.current = true;
    }
  }, [isClient, initialMessages.length, setMessages]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { message: '' },
  });

  // parse CSV/XLSX file client-side to produce preview
  async function parseFileForPreview(file: File) {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith('.csv') || name.endsWith('.txt')) {
        const text = await file.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        const holdings = normalizeRowsToHoldings(parsed.data as any[]);
        setCsvPreview(holdings);
      } else if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
        const ab = await file.arrayBuffer();
        const wb = XLSX.read(ab, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[];
        const holdings = normalizeRowsToHoldings(json);
        setCsvPreview(holdings);
      } else {
        throw new Error('Unsupported file type. Use CSV or Excel (xls/xlsx).');
      }
    } catch (err: any) {
      console.error('Failed to parse file for preview', err);
      toast.error('Failed to parse file. Ensure it has columns like ticker,symbol and qty,quantity');
      setCsvPreview(null);
    }
  }

  // Handle file selection from input
  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setCsvFile(file);
    setCsvFilename(file?.name ?? null);
    setCsvPreview(null);
    if (file) parseFileForPreview(file);
  }

  // upload file to server and send holdings to chat
  async function handleUploadAndSendHoldings() {
    try {
      if (!csvFile) return { ok: false, error: 'No file' };
      const formData = new FormData();
      formData.append('file', csvFile, csvFile.name);

      const res = await fetch('/api/upload-file', {
        method: 'POST',
        body: formData,
      });

      const json = await res.json();
      if (!res.ok) {
        console.warn('Server upload failed', json);
        return { ok: false, error: json?.error || 'Upload failed' };
      }
      // response shape: { result: {...} }
      return { ok: true, result: json.result };
    } catch (err: any) {
      console.error('Upload error', err);
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async function onSubmit(data: z.infer<typeof formSchema>) {
    const trimmed = data.message.trim();

    if (!trimmed && !csvFile) {
      toast.error('Type a message or attach a CSV file first.');
      return;
    }

    try {
      if (csvFile) {
        // ensure preview parsed
        if (!csvPreview) {
          await parseFileForPreview(csvFile);
        }

        const payloadObj = { holdings: csvPreview ?? [] };
        const payloadText = `<HOLDINGS_JSON>${JSON.stringify(payloadObj)}</HOLDINGS_JSON>\n`;

        // upload to server (optional server processing) — don't block chat if upload fails
        const uploadResp = await handleUploadAndSendHoldings();
        if (!uploadResp?.ok) {
          console.warn('Upload failed but will still send holdings to assistant', uploadResp);
        }

        // send small human message + structured payload for the assistant
        await sendMessage({ text: `I've uploaded ${csvFilename || 'a file'}. Sending holdings for analysis.` });
        await sendMessage({ text: payloadText });

        // clear local CSV state
        setCsvFile(null);
        setCsvFilename(null);
        setCsvPreview(null);
      } else {
        // normal text-only message
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
    setCsvFile(null);
    setCsvPreview(null);
    saveMessagesToStorage(newMessages, newDurations);
    toast.success('Chat cleared');
  }

  return (
    <div className="flex h-screen items-center justify-center font-sans dark:bg-black">
      <main className="w-full dark:bg-black h-screen relative">
        <div className="fixed top-0 left-0 right-0 z-50 bg-linear-to-b from-background via-background/50 to-transparent dark:bg-black overflow-visible pb-16">
          <div className="relative overflow-visible">
            <ChatHeader>
              <ChatHeaderBlock />
              <ChatHeaderBlock className="justify-center items-center">
                <Avatar className="size-8 ring-1 ring-primary">
                  <AvatarImage src="/logo.png" />
                  <AvatarFallback>
                    <Image src="/logo.png" alt="Logo" width={36} height={36} />
                  </AvatarFallback>
                </Avatar>
                <p className="tracking-tight">Chat with {AI_NAME}</p>
              </ChatHeaderBlock>
              <ChatHeaderBlock className="justify-end">
                <Button variant="outline" size="sm" className="cursor-pointer" onClick={clearChat}>
                  <Plus className="size-4" />
                  {CLEAR_CHAT_TEXT}
                </Button>
              </ChatHeaderBlock>
            </ChatHeader>
          </div>
        </div>

        <div className="h-screen overflow-y-auto px-5 py-4 w-full pt-[88px] pb-[150px]">
          <div className="flex flex-col items-center justify-end min-h-full">
            {isClient ? (
              <>
                <MessageWall messages={messages} status={status} durations={durations} onDurationChange={handleDurationChange} />
                {status === 'submitted' && (
                  <div className="flex justify-start max-w-3xl w-full">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                )}
              </>
            ) : (
              <div className="flex justify-center max-w-2xl w-full">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-50 bg-linear-to-t from-background via-background/50 to-transparent dark:bg-black overflow-visible pt-13">
          <div className="w-full px-5 pt-5 pb-1 items-center flex justify-center relative overflow-visible">
            <div className="message-fade-overlay" />
            <div className="max-w-3xl w-full">
              <form id="chat-form" onSubmit={form.handleSubmit(onSubmit)}>
                <FieldGroup>
                  {/* CSV/XLSX upload row */}
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <Upload className="size-4" />
                      <span>{csvFilename ? csvFilename : 'Attach portfolio CSV/XLSX'}</span>
                      <input
                        type="file"
                        accept=".csv,.txt,.xls,.xlsx"
                        className="hidden"
                        onChange={onFileSelected}
                      />
                    </label>

                    {csvFilename && (
                      <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => { setCsvFile(null); setCsvFilename(null); setCsvPreview(null); }}>
                        Remove file
                      </button>
                    )}
                  </div>

                  <Controller
                    name="message"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="chat-form-message" className="sr-only">Message</FieldLabel>
                        <div className="relative h-13">
                          <Input
                            {...field}
                            id="chat-form-message"
                            className="h-15 pr-15 pl-5 bg-card rounded-[20px]"
                            placeholder={csvFile ? 'Optional: ask a question about the uploaded portfolio...' : 'Type your message here...'}
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
                          {(status === 'ready' || status === 'error') && (
                            <Button className="absolute right-3 top-3 rounded-full" type="submit" disabled={!field.value.trim() && !csvFile} size="icon">
                              <ArrowUp className="size-4" />
                            </Button>
                          )}
                          {(status === 'streaming' || status === 'submitted') && (
                            <Button className="absolute right-2 top-2 rounded-full" size="icon" type="button" onClick={() => { stop(); }}>
                              <Square className="size-4" />
                            </Button>
                          )}
                        </div>
                      </Field>
                    )}
                  />
                </FieldGroup>
              </form>

              {/* CSV preview */}
              {csvPreview && csvPreview.length > 0 && (
                <div className="mt-3 p-3 border rounded max-w-3xl bg-card">
                  <div className="font-medium mb-2">Preview detected holdings</div>
                  <ul className="list-disc pl-5">
                    {csvPreview.map((h) => (
                      <li key={h.ticker}>{h.ticker}: {h.qty}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="w-full px-5 py-3 items-center flex justify-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} {OWNER_NAME}&nbsp;
            <Link href="/terms" className="underline">Terms of Use</Link>
            &nbsp;Powered by&nbsp;
            <Link href="https://ringel.ai/" className="underline">Ringel.AI</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
