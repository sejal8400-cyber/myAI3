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

export const maxDuration = 30;

export async function POST(req: Request) {
  const {
    messages,
    data,
  }: {
    messages: UIMessage[];
    data?: {
      imageBase64?: string;
      fileName?: string;
    };
  } = await req.json();

  // Existing moderation logic on latest user text
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

  // Convert UI messages to model messages
  const baseModelMessages = convertToModelMessages(messages);

  let modelMessagesWithImage: CoreMessage[];

  if (data?.imageBase64 && baseModelMessages.length > 0) {
    const initialMessages = baseModelMessages.slice(0, -1);
    const lastMessage = baseModelMessages[baseModelMessages.length - 1];

    // Extract text content from the last message
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
          image: data.imageBase64,
        },
      ],
    };

    modelMessagesWithImage = [...initialMessages, combinedLast];
  } else {
    // No image attached, use messages as usual
    modelMessagesWithImage = baseModelMessages as CoreMessage[];
  }

  const result = streamText({
    model: MODEL,
    system: SYSTEM_PROMPT,
    messages: modelMessagesWithImage,
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
