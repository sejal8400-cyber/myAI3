// app/api/chat/route.ts  (replace your existing file)
import {
  streamText,
  UIMessage,
  convertToModelMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  CoreMessage,
} from "ai";
import { MODEL } from "@/config";
import { SYSTEM_PROMPT } from "@/prompts";
import { isContentFlagged } from "@/lib/moderation";
import { webSearch } from "./tools/web-search";
import { vectorDatabaseSearch } from "./tools/search-vector-database";

import Papa from "papaparse";
import * as XLSX from "xlsx";

export const maxDuration = 30;

type IncomingJson = {
  messages?: UIMessage[];
  imageBase64?: string;
  fileName?: string;
};

function normalizeRowsToHoldings(rows: any[]): { ticker: string; qty: number }[] {
  // ------------------------ paste these helpers ABOVE export async function POST ------------------------
async function fetchPricesAlphaVantage(symbols: string[]) {
  const key = process.env.ALPHA_VANTAGE_KEY;
  if (!key) {
    console.log('[api/chat] ALPHA_VANTAGE_KEY not set; skipping price fetch');
    return {};
  }
  const out: Record<string, number | null> = {};
  for (const s of symbols.slice(0, 5)) { // limit to avoid rate-limit
    try {
      console.log('[api/chat] fetching price for', s);
      const resp = await fetch(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(s)}&apikey=${key}`
      );
      const j = await resp.json();
      const price = j?.['Global Quote']?.['05. price'];
      out[s] = price ? Number(price) : null;
      // polite sleep for free tier (adjust/remove in prod)
      await new Promise((r) => setTimeout(r, 1200));
    } catch (err) {
      console.error('[api/chat] alpha fetch error for', s, err);
      out[s] = null;
    }
  }
  return out;
}

async function fetchWebContextForTickers(tickers: string[]) {
  // expects your ./tools/web-search implementation to call an external API
  const snippets: { ticker: string; hits: { title: string; snippet: string; url?: string }[] }[] = [];

  for (const t of tickers.slice(0, 6)) { // limit to avoid large work
    try {
      console.log('[api/chat] webSearch query for', t);
      // adapt this call to your webSearch API signature
      const res = await webSearch({ q: `${t} stock news` });
      // if your webSearch returns { items: [...] } adapt below
      const items = (res?.items ?? res?.results ?? []).slice(0, 3);
      snippets.push({
        ticker: t,
        hits: items.map((it: any) => ({
          title: it.title || it.headline || '',
          snippet: it.snippet || it.summary || it.excerpt || '',
          url: it.url || it.link,
        })),
      });
    } catch (err) {
      console.error('[api/chat] webSearch error for', t, err);
    }
  }

  return snippets;
}
// ------------------------ end helper block ------------------------

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
    const normTicker = ticker.toUpperCase();
    out[normTicker] = (out[normTicker] || 0) + qty;
  }
  return Object.entries(out).map(([ticker, qty]) => ({ ticker, qty }));
}

export async function POST(req: Request) {
    console.log('[api/chat] POST received; content-type=', req.headers.get('content-type'));
  // support both JSON body and multipart/form-data with file
  let incoming: IncomingJson = {};
  let uploadedFile: File | null = null;

  const contentType = req.headers.get("content-type") || "";

  if (contentType.startsWith("multipart/form-data")) {
    // form-data path (browser file upload)
    try {
      const form = await req.formData();
      uploadedFile = (form.get("file") as unknown) as File | null;

      // also allow optional messages/imageBase64 fields in form
      const messagesRaw = form.get("messages") as string | null;
      if (messagesRaw) {
        try {
          incoming.messages = JSON.parse(messagesRaw) as UIMessage[];
        } catch {
          // ignore parse error — fallback to not having messages
        }
      }

      const imageBase64 = form.get("imageBase64") as string | null;
      if (imageBase64) incoming.imageBase64 = imageBase64;

      const fileName = form.get("fileName") as string | null;
      if (fileName) incoming.fileName = fileName;
    } catch (err) {
      console.error("Failed to parse formData", err);
      return new Response(JSON.stringify({ error: "Invalid form data" }), { status: 400 });
    }
  } else {
    // JSON path (existing behavior)
    try {
      incoming = (await req.json()) as IncomingJson;
    } catch (err) {
      console.error("Failed to parse JSON body", err);
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }
  }

  const messages = incoming.messages || [];
  const latestUserMessage = messages.filter((msg) => msg.role === "user").pop();

  if (latestUserMessage) {
    const textParts = latestUserMessage.parts
      .filter((part) => part.type === "text")
      .map((part) => ("text" in part ? part.text : ""))
      .join("");

    if (textParts) {
      const moderationResult = await isContentFlagged(textParts);

      if (moderationResult.flagged) {
        const stream = createUIMessageStream({
          execute({ writer }) {
            const textId = "moderation-denial-text";

            writer.write({
              type: "start",
            });

            writer.write({
              type: "text-start",
              id: textId,
            });

            writer.write({
              type: "text-delta",
              id: textId,
              delta:
                moderationResult.denialMessage ||
                "Your message violates our guidelines. I can't answer that.",
            });

            writer.write({
              type: "text-end",
              id: textId,
            });

            writer.write({
              type: "finish",
            });
          },
        });

        return createUIMessageStreamResponse({ stream });
      }
    }
  }

  // Convert incoming UIMessage[] to core model messages
  const baseModelMessages = convertToModelMessages(messages);

  // If a file was uploaded, parse it server-side and append a structured holdings message
  let modelMessagesToUse: CoreMessage[] = baseModelMessages as CoreMessage[];

  if (uploadedFile) {
    try {
      const fname = uploadedFile.name || "upload";
      const lower = fname.toLowerCase();

      let rows: any[] = [];

      if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
        const text = await uploadedFile.text();
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        rows = parsed.data as any[];
      } else if (lower.endsWith(".xls") || lower.endsWith(".xlsx")) {
        const ab = await uploadedFile.arrayBuffer();
        const wb = XLSX.read(ab, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as any[];
      } else {
        // unsupported file type — create a short user text saying file couldn't be parsed
        const fileMessage: CoreMessage = {
          role: "user",
          content: [
            {
              type: "text",
              text: `I uploaded a file named ${fname} but the server could not parse its type. Please upload CSV or XLSX.`,
            },
          ],
        };
        modelMessagesToUse = [...(baseModelMessages as CoreMessage[]), fileMessage];
      }

      if (rows && rows.length > 0) {
        const holdings = normalizeRowsToHoldings(rows);
        const payloadText = `<HOLDINGS_JSON>${JSON.stringify({ holdings })}</HOLDINGS_JSON>`;

        const fileMessage: CoreMessage = {
          role: "user",
          content: [
            {
              type: "text",
              text: `User uploaded file ${fname} with detected holdings:`,
            },
            {
              type: "text",
              text: payloadText,
            },
          ],
        };

        modelMessagesToUse = [...(baseModelMessages as CoreMessage[]), fileMessage];
        // ------------------ paste this right AFTER you have `holdings` array and modelMessagesToUse set ------------------
try {
  const tickers = (holdings || []).map((h: any) => h.ticker).filter(Boolean);
  if (tickers.length > 0) {
    // 1) fetch web context
    const webSnips = await fetchWebContextForTickers(tickers);
    if (webSnips && webSnips.length > 0) {
      const webText = webSnips.map(w => {
        const hits = w.hits.map(h => `- ${h.title}\n  ${h.snippet}\n  ${h.url ?? ''}`).join('\n');
        return `Web search for ${w.ticker}:\n${hits}`;
      }).join('\n\n');

      modelMessagesToUse.push({
        role: 'user',
        content: [{ type: 'text', text: `Current web context for holdings:\n${webText}` }],
      });
      console.log('[api/chat] attached web search snippets to model messages');
    }

    // 2) fetch prices
    const prices = await fetchPricesAlphaVantage(tickers);
    if (Object.keys(prices).length > 0) {
      modelMessagesToUse.push({
        role: 'user',
        content: [{ type: 'text', text: `Latest prices (AlphaVantage): ${JSON.stringify(prices)}` }],
      });
      console.log('[api/chat] attached prices to model messages');
    }
  }
} catch (err) {
  console.error('[api/chat] error while fetching web/price context', err);
}
// ------------------ end paste ------------------

      }
    } catch (err) {
      console.error("Error parsing uploaded file:", err);
      // fall back to base messages if parsing fails
      modelMessagesToUse = baseModelMessages as CoreMessage[];
    }
  } else {
    // No file upload path: preserve image handling and possible imageBase64
    if (incoming.imageBase64 && baseModelMessages.length > 0) {
      const initialMessages = baseModelMessages.slice(0, -1);
      const lastMessage = baseModelMessages[baseModelMessages.length - 1];

      let lastText = "";

      if (typeof lastMessage.content === "string") {
        lastText = lastMessage.content;
      } else if (Array.isArray(lastMessage.content)) {
        lastText = lastMessage.content
          .filter(
            (part: any) =>
              part &&
              part.type === "text" &&
              typeof part.text === "string"
          )
          .map((part: any) => part.text)
          .join(" ");
      }

      const combinedLast: CoreMessage = {
        role: "user",
        content: [
          ...(lastText
            ? [
                {
                  type: "text" as const,
                  text: lastText,
                },
              ]
            : []),
          {
            type: "image" as const,
            image: incoming.imageBase64,
          },
        ],
      };

      modelMessagesToUse = [...initialMessages, combinedLast];
    } else {
      modelMessagesToUse = baseModelMessages as CoreMessage[];
    }
  }

  const result = streamText({
    model: MODEL,
    system: SYSTEM_PROMPT,
    messages: modelMessagesToUse,
    tools: {
      webSearch,
      vectorDatabaseSearch,
    },
    stopWhen: stepCountIs(10),
    providerOptions: {
      openai: {
        reasoningSummary: "auto",
        reasoningEffort: "low",
        parallelToolCalls: false,
      },
    },
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
  });
}

