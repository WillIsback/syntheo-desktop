import {
  type ChatTransport,
  convertToModelMessages,
  type LanguageModel,
  smoothStream,
  stepCountIs,
  ToolLoopAgent,
  type ToolSet,
} from "ai";

import {
  type SessionContext,
  commands as templateCommands,
} from "@syntheo/plugin-template";

import type { ContextRef } from "../context/entities";
import {
  extractContextRefsFromMessages,
  getCurrentSessionIdFromMessages,
  orderPromptContextRefs,
} from "../context/refs";
import { CONTEXT_TEXT_FIELD } from "../tools/context-text";
import type { ChatToolContext } from "../tools/current-session";
import type { SyntheoUIMessage } from "../types";
import {
  getMeetingIdsFromSearchOutput,
  hasContextText,
  isRecord,
  isToolOutputPart,
  MAX_TOOL_STEPS,
  MESSAGE_WINDOW_SIZE,
  MESSAGE_WINDOW_THRESHOLD,
  type ToolOutputPart,
} from "./helpers";

export type ResolvedChatContext =
  | { kind: "session"; context: SessionContext }
  | { kind: "text"; text: string };

export class CustomChatTransport implements ChatTransport<SyntheoUIMessage> {
  constructor(
    private readonly model: LanguageModel,
    private readonly tools: ToolSet,
    private readonly systemPrompt?: string,
    private readonly resolveContextRef?: (
      ref: ContextRef,
    ) => Promise<ResolvedChatContext | null>,
  ) {}

  private async collectContexts(
    contextRefs: ContextRef[],
    resolve: (ref: ContextRef) => Promise<ResolvedChatContext | null>,
  ): Promise<{
    sessionContexts: SessionContext[];
    textContexts: string[];
  }> {
    const seen = new Set<string>();
    const uniqueRefs: ContextRef[] = [];
    for (const ref of contextRefs) {
      if (seen.has(ref.key)) continue;
      seen.add(ref.key);
      uniqueRefs.push(ref);
    }

    const contexts = await Promise.all(uniqueRefs.map((ref) => resolve(ref)));

    const sessionContexts: SessionContext[] = [];
    const textContexts: string[] = [];
    for (const context of contexts) {
      if (!context) continue;
      if (context.kind === "session") {
        sessionContexts.push(context.context);
      } else if (context.text.trim()) {
        textContexts.push(context.text.trim());
      }
    }

    return { sessionContexts, textContexts };
  }

  private async renderSessionContexts(
    sessionContexts: SessionContext[],
    currentSessionId?: string,
  ): Promise<string | null> {
    // Rendered by Rust-side template engine via Tauri plugin
    const rendered = await templateCommands.render({
      contextBlock: {
        contexts: sessionContexts,
        currentSessionId: currentSessionId ?? null,
      },
    });
    if (rendered.status === "ok" && rendered.data.trim()) {
      return rendered.data.trim();
    }
    return null;
  }

  private async renderContextBlock(
    contextRefs: ContextRef[],
    cache: Map<string, string | null>,
    currentSessionId?: string,
  ): Promise<string | null> {
    const resolve = this.resolveContextRef;
    if (!resolve || contextRefs.length === 0) {
      return null;
    }

    const cacheKey = JSON.stringify([contextRefs, currentSessionId ?? null]);
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey) ?? null;
    }

    const { sessionContexts, textContexts } = await this.collectContexts(
      contextRefs,
      resolve,
    );

    if (sessionContexts.length === 0 && textContexts.length === 0) {
      cache.set(cacheKey, null);
      return null;
    }

    const blocks: string[] = [];

    if (sessionContexts.length > 0) {
      const rendered = await this.renderSessionContexts(
        sessionContexts,
        currentSessionId,
      );
      if (rendered) {
        blocks.push(rendered);
      }
    }

    if (textContexts.length > 0) {
      blocks.push(textContexts.join("\n\n"));
    }

    const result = blocks.length > 0 ? blocks.join("\n\n") : null;
    cache.set(cacheKey, result);
    return result;
  }

  private async hydrateMeetingSearchOutput(
    output: unknown,
    cache: Map<string, string | null>,
  ): Promise<unknown> {
    const sessionIds = getMeetingIdsFromSearchOutput(output);
    if (sessionIds.length === 0) return output;

    const refs: ContextRef[] = sessionIds.map((sessionId) => ({
      kind: "session" as const,
      key: `session:search:${sessionId}`,
      source: "tool" as const,
      sessionId,
    }));

    const contextText = await this.renderContextBlock(refs, cache);
    if (!contextText) return output;

    return {
      ...(isRecord(output) ? output : {}),
      [CONTEXT_TEXT_FIELD]: contextText,
    };
  }

  private async expandSearchMeetingsOutput(
    part: ToolOutputPart,
    cache: Map<string, string | null>,
  ): Promise<ToolOutputPart> {
    if (hasContextText(part.output)) {
      return part;
    }

    const output = await this.hydrateMeetingSearchOutput(part.output, cache);
    if (output === part.output) return part;

    return {
      ...part,
      output,
    };
  }

  private buildHydratingToolSet(cache: Map<string, string | null>): ToolSet {
    const meetingSearchTool = this.tools.search_meetings;
    if (!meetingSearchTool || typeof meetingSearchTool !== "object") {
      return this.tools;
    }

    const execute = (
      meetingSearchTool as {
        execute?: (...args: unknown[]) => Promise<unknown>;
      }
    ).execute;
    if (typeof execute !== "function") {
      return this.tools;
    }

    return {
      ...this.tools,
      search_meetings: {
        ...meetingSearchTool,
        execute: async (...args: unknown[]) => {
          const output = await execute(...args);
          if (hasContextText(output)) {
            return output;
          }
          return this.hydrateMeetingSearchOutput(output, cache);
        },
      },
    };
  }

  sendMessages: ChatTransport<SyntheoUIMessage>["sendMessages"] = async (
    options,
  ) => {
    const cache = new Map<string, string | null>();
    const tools = this.buildHydratingToolSet(cache);

    const currentSessionId = getCurrentSessionIdFromMessages(options.messages);
    const effectiveContextRefs = orderPromptContextRefs(
      extractContextRefsFromMessages(options.messages),
      currentSessionId,
    );
    const effectiveContextBlock = await this.renderContextBlock(
      effectiveContextRefs,
      cache,
      currentSessionId,
    );

    let lastUserMessageIndex = -1;
    for (let i = options.messages.length - 1; i >= 0; i -= 1) {
      if (options.messages[i]?.role === "user") {
        lastUserMessageIndex = i;
        break;
      }
    }

    const lastUserMessage =
      lastUserMessageIndex >= 0
        ? options.messages[lastUserMessageIndex]
        : undefined;
    const mentionedFolderPaths = [
      ...new Set(
        (lastUserMessage?.metadata?.contextRefs ?? []).flatMap((ref) =>
          ref.kind === "folder" && ref.source === "manual"
            ? [ref.folderId]
            : [],
        ),
      ),
    ];

    const agent = new ToolLoopAgent({
      model: this.model,
      instructions: this.systemPrompt,
      tools,
      experimental_context: {
        currentSessionId,
        mentionedFolderPaths,
      } satisfies ChatToolContext,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      prepareStep: ({ messages, stepNumber }) => {
        const finalStep = stepNumber >= MAX_TOOL_STEPS - 1;
        const progressReport = finalStep
          ? {
              toolChoice: "none" as const,
              system: [
                this.systemPrompt,
                "This is the final step of this turn. Report verified results and failures. If work remains, explicitly say it is incomplete and offer to continue. Include the original selection/query or series ID, exact destination, completed counts, next unprocessed offset, and any listed but unprocessed IDs so the next turn can resume. Never claim all meetings were moved unless pagination and moves both completed.",
              ]
                .filter(Boolean)
                .join("\n\n"),
            }
          : {};

        if (messages.length > MESSAGE_WINDOW_THRESHOLD) {
          const lastUserIndex = messages
            .map((message) => message.role)
            .lastIndexOf("user");
          // Keep the request and completed batches throughout a multi-step action.
          const start =
            lastUserIndex < 0
              ? 0
              : Math.min(lastUserIndex, messages.length - MESSAGE_WINDOW_SIZE);
          return Promise.resolve({
            ...progressReport,
            messages: messages.slice(start),
          });
        }
        return Promise.resolve(progressReport);
      },
    });

    const messagesWithContext: SyntheoUIMessage[] = await Promise.all(
      options.messages.map(async (msg, index): Promise<SyntheoUIMessage> => {
        if (msg.role === "user") {
          if (
            !effectiveContextBlock ||
            lastUserMessageIndex === -1 ||
            index !== lastUserMessageIndex
          ) {
            return msg;
          }

          return {
            ...msg,
            parts: [
              {
                type: "text" as const,
                text: `${effectiveContextBlock}\n\n`,
              },
              ...msg.parts,
            ],
          };
        }

        if (msg.role === "assistant") {
          const expandedParts = await Promise.all(
            msg.parts.map((part) => {
              if (
                isToolOutputPart(part) &&
                (part.type === "tool-search_meetings" ||
                  part.type === "tool-search_sessions")
              ) {
                return this.expandSearchMeetingsOutput(part, cache);
              }
              return part;
            }),
          );
          return {
            ...msg,
            parts: expandedParts as SyntheoUIMessage["parts"],
          };
        }

        return msg;
      }),
    );

    const result = await agent.stream({
      messages: await convertToModelMessages(messagesWithContext, { tools }),
      abortSignal: options.abortSignal,
      // Word chunking emits tokens as they arrive. Line chunking holds the
      // whole reply until a newline, so short chat answers only appear at the end.
      experimental_transform: smoothStream({
        chunking: "word",
      }),
    });

    return result.toUIMessageStream({
      originalMessages: options.messages,
      messageMetadata: ({ part }: { part: { type: string } }) => {
        if (part.type === "start") {
          return { createdAt: Date.now() };
        }
      },
      onError: (error: unknown) => {
        console.error(error);
        if (error instanceof Error) {
          return `${error.name}: ${error.message}`;
        }
        if (isRecord(error) && typeof error.message === "string") {
          return error.message;
        }
        try {
          return JSON.stringify(error);
        } catch {
          return String(error);
        }
      },
    });
  };

  reconnectToStream: ChatTransport<SyntheoUIMessage>["reconnectToStream"] =
    () => Promise.resolve(null);
}
