import type { ApprovalRequest, AssistantPayload, ChatMessageInput, ChatStreamEvent, ToolEvent } from '../shared/chat.js';
import { executeTool, isWriteTool, buildApprovalRequest, buildBlocksFromToolResult } from './tools.js';
import type { ToolStep } from './dynamic-tool-types.js';
import { interpolateArgs } from './tool-composer.js';
import { getAllToolDefinitions } from './dynamic-tool-bridge.js';
import { createLLMClient } from './llm-client.js';
import type { ChatMessage, LLMClient } from './llm-types.js';
import { parseSuggestions } from '../lib/suggestions.js';
import { type Persona } from '../lib/persona.js';
import { chunkText, toolLabel, verboseRunningLabel, verboseCompletedDetail, updateToolEvent, approvalMessage, applyPersonaContentRules, buildAutomaticSuggestions } from './chat-utils.js';
import { setMemoryFileIO, loadMemories, getMemories, mergeMemory, isMemoryInitialized, beginBatch, flushBatch } from './memory/memory-store.js';
import { extractFromToolResult } from './memory/memory-extractor.js';
import { retrieveMemories } from './memory/memory-retriever.js';
import type { MemoryEntry } from './memory/memory-types.js';
import type { ExtractedMemory } from './memory/memory-extractor.js';
import { getUserHash } from '../lib/user-hash.js';
import { assembleContext, truncateMessages, MAX_CONTEXT_TOKENS, estimateTokens } from './context-assembler.js';
import { getSummary, saveSummary, shouldGenerateSummary, generateSummary } from './conversation-summary.js';
import { validateApprovalFields } from './approval-runtime.js';
import { initEmbeddingStore, loadEmbeddings, saveEmbedding, supportsEmbeddings, computeEmbedding, beginEmbeddingBatch, flushEmbeddingBatch } from './memory/memory-embeddings.js';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../lib/data-dir.js';

function initMemoryForUser(userEmail: string | undefined): boolean {
  if (!userEmail) {
    console.warn('[memory] No userEmail provided - memory system disabled');
    return false;
  }

  if (isMemoryInitialized()) {
    console.log('[memory] Already initialized');
    return true;
  }

  try {
    const userHash = getUserHash(userEmail);
    const memoryDir = path.join(getDataDir(), '.memory');
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
      console.log('[memory] Created memory directory:', memoryDir);
    }
    const memoryPath = path.join(memoryDir, `${userHash}.json`);
    console.log('[memory] Initializing for user hash:', userHash);

    setMemoryFileIO({
      exists: (p: string) => fs.existsSync(p),
      read: (p: string) => fs.readFileSync(p, 'utf-8'),
      write: (p: string, data: string) => fs.writeFileSync(p, data, 'utf-8'),
      rename: (oldP: string, newP: string) => fs.renameSync(oldP, newP),
      getFilePath: () => memoryPath,
    }, userHash);

    // Initialize embedding store for this user (T084)
    initEmbeddingStore(userHash);

    loadMemories();
    console.log('[memory] Loaded', getMemories().length, 'memories');
    return true;
  } catch (err) {
    console.error('[memory] Failed to initialize:', err);
    return false;
  }
}

function generateThreadBriefSuggestion(extractedMemories: ExtractedMemory[]): string | undefined {
  const resourceMemories = extractedMemories.filter((m) => m.category === 'resource');
  if (resourceMemories.length === 0) return undefined;

  const mostRecent = resourceMemories[resourceMemories.length - 1];
  if (!mostRecent.metadata) return undefined;

  const { spreadsheetId, docId, fileId, folderId, url, title } = mostRecent.metadata as Record<string, unknown>;
  const resourceId = spreadsheetId || docId || fileId || folderId;
  if (!resourceId && !url) return undefined;

  const resourceName = mostRecent.content || title || 'resource';
  return `This thread created/modified ${resourceName}.`;
}

interface HandleChatOptions {
  onEvent?: (event: ChatStreamEvent) => void;
  signal?: AbortSignal;
  userTz?: string;
  runId?: string;
  conversationId?: string;
  sourceMessageId?: string;
  persona?: Persona;
  threadBrief?: string;
  userEmail?: string;
}

function emit(onEvent: HandleChatOptions['onEvent'], event: ChatStreamEvent) {
  onEvent?.(event);
}

function getClient(): LLMClient {
  return createLLMClient();
}

function ensureNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('The request was aborted.', 'AbortError');
  }
}


function emitFinalPayload(onEvent: HandleChatOptions['onEvent'], payload: AssistantPayload, persona?: Persona) {
  const personaAdjustedContent = applyPersonaContentRules(payload.content, persona);
  // Parse [SUGGEST: ...] markers from content into structured suggestions
  const { cleanContent, suggestions } = parseSuggestions(personaAdjustedContent);
  const automaticSuggestions = buildAutomaticSuggestions(payload);
  const mergedSuggestions = [...new Set([...suggestions, ...automaticSuggestions])].slice(0, 4);
  const enriched: AssistantPayload = {
    ...payload,
    content: cleanContent,
    suggestions: mergedSuggestions.length > 0 ? mergedSuggestions : undefined,
  };

  for (const chunk of chunkText(enriched.content)) {
    emit(onEvent, { type: 'assistant_chunk', chunk });
  }
  emit(onEvent, { type: 'assistant_complete', payload: enriched });
}

export async function handleChat(
  messages: ChatMessageInput[],
  options: HandleChatOptions = {},
): Promise<AssistantPayload> {
  const client = getClient();
  const onEvent = options.onEvent;
  const signal = options.signal;
  let toolEvents: ToolEvent[] = [];
  const blocks: AssistantPayload['blocks'] = [];

  // Initialize memory for user
  const memoryInitialized = initMemoryForUser(options.userEmail);
  let retrievedMemories: MemoryEntry[] = [];
  let allExtractedMemories: ExtractedMemory[] = [];

  if (memoryInitialized) {
    try {
      loadMemories();
      const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMessage) {
        const query = lastUserMessage.content;
        // Load embeddings cache before retrieval (T084)
        const embeddingsCache = loadEmbeddings();
        const results = await retrieveMemories(query, [...getMemories()], { maxResults: 5 }, embeddingsCache);
        retrievedMemories = results.map((r) => r.entry);
      }
    } catch (err) {
      console.error('Memory retrieval failed:', err);
    }
  }

  // Load conversation summary if this is a long conversation
  let conversationSummary: string | undefined;
  let summaryUpdatedAt: number | undefined;
  let summaryMessageCutoff: number | undefined;

  if (options.conversationId && options.userEmail) {
    const userHash = getUserHash(options.userEmail);
    const existingSummary = getSummary(userHash, options.conversationId);

    // Estimate conversation tokens (excluding system prompt)
    const conversationTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

    // Check if we should generate/update summary
    const currentMessageCount = messages.length;
    if (shouldGenerateSummary(conversationTokens, existingSummary, currentMessageCount)) {
      try {
        // Build full chatMessages for summarization (user + assistant only, no system)
        const summaryInput: ChatMessage[] = messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

        const newSummary = await generateSummary(summaryInput, existingSummary, options.conversationId);
        if (newSummary) {
          const summaryToSave = { ...newSummary, messageCountAtLastSummary: currentMessageCount };
          saveSummary(userHash, summaryToSave);
          conversationSummary = newSummary.summaryText;
          summaryUpdatedAt = newSummary.updatedAt;
          summaryMessageCutoff = existingSummary?.messageCountAtLastSummary ?? 0;
        }
      } catch (err) {
        console.warn('[summary] Generation failed (non-fatal):', err);
      }
    } else if (existingSummary) {
      conversationSummary = existingSummary.summaryText;
      summaryUpdatedAt = existingSummary.updatedAt;
      summaryMessageCutoff = existingSummary.messageCountAtLastSummary;
    }
  }

  // If summary covers older messages, keep only recent ones
  const inputMessages =
    conversationSummary && summaryMessageCutoff != null && summaryMessageCutoff < messages.length
      ? messages.slice(summaryMessageCutoff)
      : messages;

  ensureNotAborted(signal);
  emit(onEvent, { type: 'assistant_begin' });

  let chatMessages: ChatMessage[] = [
    {
      role: 'system',
      content: assembleContext({
        userTz: options.userTz,
        persona: options.persona,
        threadBrief: options.threadBrief,
        memories: retrievedMemories,
        userHash: options.userEmail ? getUserHash(options.userEmail) : undefined,
        conversationSummary,
        conversationSummaryUpdatedAt: summaryUpdatedAt,
      }),
    },
    ...inputMessages.map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    })),
  ];

  // Wire context truncation (T085): drop oldest messages when over the 100K token budget
  const pretruncateLen = chatMessages.length;
  chatMessages = truncateMessages(chatMessages, MAX_CONTEXT_TOKENS);
  if (chatMessages.length < pretruncateLen) {
    console.warn(
      `[context] Truncated: dropped ${pretruncateLen - chatMessages.length} oldest messages to fit 100K token budget`,
    );
  }

  let response = await client.complete(chatMessages, { tools: getAllToolDefinitions(), signal });

  if (memoryInitialized) beginBatch();
  if (memoryInitialized) beginEmbeddingBatch();
  try {
  for (let round = 0; round < 5; round++) {
    ensureNotAborted(signal);
    const choice = response.choices[0];
    if (!choice) break;

    const toolCalls = choice.message.tool_calls;
    if (!toolCalls || toolCalls.length === 0 || choice.finish_reason !== 'tool_calls') {
      const payload: AssistantPayload = {
        content: choice.message.content || 'Done.',
        blocks,
        toolEvents,
      };
      emitFinalPayload(onEvent, payload, options.persona);
      return payload;
    }

    // Push the assistant message (with tool_calls) into the conversation
    chatMessages.push({
      role: 'assistant',
      content: choice.message.content,
      tool_calls: choice.message.tool_calls ? [...choice.message.tool_calls] : undefined,
    });

    for (const toolCall of toolCalls) {
      if (toolCall.type !== 'function') continue;

      const toolName = toolCall.function.name;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        const errorResult = `Error: Failed to parse tool arguments for ${toolName}. The arguments were not valid JSON.`;
        chatMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: errorResult,
        });
        const errorEvent: ToolEvent = {
          id: toolCall.id,
          toolName,
          label: toolLabel(toolName),
          status: 'error',
          detail: 'Malformed tool arguments from model.',
        };
        toolEvents = updateToolEvent(toolEvents, errorEvent);
        emit(onEvent, { type: 'tool_event', event: errorEvent });
        continue;
      }

      const runningEvent: ToolEvent = {
        id: toolCall.id,
        toolName,
        label: verboseRunningLabel(toolName, args),
        status: 'running',
      };
      toolEvents = updateToolEvent(toolEvents, runningEvent);
      emit(onEvent, { type: 'tool_event', event: runningEvent });

      if (isWriteTool(toolName)) {
        const approval = buildApprovalRequest(toolName, args);
        if (options.runId) approval.runId = options.runId;
        if (options.sourceMessageId) approval.sourceMessageId = options.sourceMessageId;
        const approvalEvent: ToolEvent = {
          ...runningEvent,
          status: 'approval_required',
          detail: 'Waiting for explicit approval before executing.',
        };
        toolEvents = updateToolEvent(toolEvents, approvalEvent);
        emit(onEvent, { type: 'tool_event', event: approvalEvent });

        const payload: AssistantPayload = {
          content: approvalMessage(toolName),
          blocks,
          toolEvents,
          approval,
        };
        emitFinalPayload(onEvent, payload, options.persona);
        return payload;
      }

      try {
        const result = await executeTool(toolName, args, signal);

        // Dynamic tools that halt at a write step return a serialized approval signal
        if (result.startsWith('{"_approvalRequired":true')) {
          let parsed: { _approvalRequired: boolean; approval: import('../shared/chat.js').ApprovalRequest } | null = null;
          try {
            parsed = JSON.parse(result);
          } catch { /* fall through */ }
          if (parsed?._approvalRequired === true && parsed.approval) {
            const approval = parsed.approval;
            if (options.runId) approval.runId = options.runId;
            if (options.sourceMessageId) approval.sourceMessageId = options.sourceMessageId;
            const approvalEvent: ToolEvent = {
              ...runningEvent,
              status: 'approval_required',
              detail: 'Waiting for explicit approval before executing.',
            };
            toolEvents = updateToolEvent(toolEvents, approvalEvent);
            emit(onEvent, { type: 'tool_event', event: approvalEvent });

            const approvalPayload: AssistantPayload = {
              content: approvalMessage(toolName),
              blocks,
              toolEvents,
              approval,
            };
            emitFinalPayload(onEvent, approvalPayload, options.persona);
            return approvalPayload;
          }
        }

        // Navigation tools — emit navigate event to switch the UI view
        if (toolName === 'open_email_triage') {
          emit(onEvent, { type: 'navigate', view: 'gmail', tab: 'triage' });
        } else if (toolName === 'check_email_triage') {
          emit(onEvent, { type: 'navigate', view: 'gmail', tab: 'triage', refresh: true });
        }

        const newBlocks = buildBlocksFromToolResult(toolName, result);
        // Deduplicate: for list-type blocks, only keep the latest of each type
        // (e.g. multiple search_emails calls should show one EMAIL MATCHES, not three)
        for (const nb of newBlocks) {
          const listTypes = new Set(['email_list', 'file_list', 'event_list', 'task_list', 'agenda', 'triage', 'sheet_data']);
          const existingIdx = listTypes.has(nb.type)
            ? blocks.findIndex((b) => b.type === nb.type)
            : blocks.findIndex((b) => b.type === nb.type && b.title === nb.title);
          if (existingIdx !== -1) {
            blocks[existingIdx] = nb;
          } else {
            blocks.push(nb);
          }
        }
        // Extract memories from tool result (for read tools and non-approval write tools)
        if (!result.startsWith('Error:') && memoryInitialized) {
          try {
            const extracted = extractFromToolResult({ toolName, args, result, conversationId: options.conversationId });
            console.log('[memory] Extraction result for', toolName, ':', extracted.length, 'memories');
            for (const mem of extracted) {
              allExtractedMemories.push(mem);
              const entry = mergeMemory({
                category: mem.category,
                content: mem.content,
                tags: mem.tags,
                metadata: mem.metadata,
                resourceIds: mem.resourceIds,
                source: mem.source,
              });
              console.log('[memory] Saved memory:', entry.id);
              // Compute and save embedding for the new memory (T084)
              if (supportsEmbeddings()) {
                computeEmbedding(entry.content + ' ' + entry.tags.join(' ')).then((embedding) => {
                  if (embedding) saveEmbedding(entry.id, embedding);
                }).catch(() => { /* non-fatal */ });
              }
            }
          } catch (err) {
            console.error('[memory] Memory extraction failed:', err);
          }
        } else if (result.startsWith('Error:')) {
          console.log('[memory] Skipping extraction for error result');
        } else if (!memoryInitialized) {
          console.log('[memory] Skipping extraction - memory not initialized');
        }

        chatMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });

        const completedEvent: ToolEvent = {
          ...runningEvent,
          label: toolLabel(toolName),
          status: result.startsWith('Error:') ? 'error' : 'completed',
          detail: result.startsWith('Error:') ? result.slice(0, 180) : verboseCompletedDetail(toolName, result),
        };
        toolEvents = updateToolEvent(toolEvents, completedEvent);
        emit(onEvent, { type: 'tool_event', event: completedEvent });
      } catch (error: any) {
        const failedEvent: ToolEvent = {
          ...runningEvent,
          status: 'error',
          detail: error?.message || 'Tool execution failed.',
        };
        toolEvents = updateToolEvent(toolEvents, failedEvent);
        emit(onEvent, { type: 'tool_event', event: failedEvent });
        throw error;
      }
    }

    response = await client.complete(chatMessages, { tools: getAllToolDefinitions(), signal });
  }
  } finally {
    if (memoryInitialized) flushBatch();
    if (memoryInitialized) flushEmbeddingBatch();
  }

  // If the last response was a tool-call (no text content), make one final call
  // without tools to force the model to produce a text summary of what it found.
  let finalContent = response.choices[0]?.message?.content;
  if (!finalContent) {
    ensureNotAborted(signal);
    const summaryResponse = await client.complete(
      [...chatMessages, { role: 'user' as const, content: 'Summarize what you found from the tool calls above. Do not call any more tools.' }],
      { signal },
    );
    finalContent = summaryResponse.choices[0]?.message?.content || 'I completed the requested actions.';
  }

  const payload: AssistantPayload = {
    content: finalContent,
    blocks,
    toolEvents,
    memoriesUsed: retrievedMemories.length > 0
      ? retrievedMemories.slice(0, 5).map((m) => ({ id: m.id, content: m.content, category: m.category }))
      : undefined,
    threadBriefSuggestion: generateThreadBriefSuggestion(allExtractedMemories),
  };
  emitFinalPayload(onEvent, payload, options.persona);
  return payload;
}

export async function executeApprovedAction(
  approval: ApprovalRequest,
  options: HandleChatOptions = {},
): Promise<AssistantPayload> {
  const onEvent = options.onEvent;
  const signal = options.signal;
  let toolEvents: ToolEvent[] = [];

  // Validate required fields before doing any work
  // Use preserved toolArgs when available (e.g. dynamic tools), otherwise
  // reconstruct from editable fields (static write tools like send_email).
  const args: Record<string, unknown> = approval.toolArgs
    ? { ...approval.toolArgs }
    : approval.fields.reduce<Record<string, string>>((acc, field) => {
        if (!field.key.startsWith('_') && field.value.trim()) acc[field.key] = field.value;
        return acc;
      }, {});

  const validation = validateApprovalFields(approval.toolName, args);
  if (!validation.valid) {
    return {
      content: `Cannot execute: ${validation.error}`,
      blocks: [],
      toolEvents,
    };
  }

  // Initialize memory for user
  const memoryInitialized = initMemoryForUser(options.userEmail);
  let extractedMemories: ExtractedMemory[] = [];

  ensureNotAborted(signal);
  emit(onEvent, { type: 'assistant_begin' });

  const started: ToolEvent = {
    id: approval.id,
    toolName: approval.toolName,
    label: toolLabel(approval.toolName),
    status: 'running',
  };
  toolEvents = updateToolEvent(toolEvents, started);
  emit(onEvent, { type: 'tool_event', event: started });

  if (memoryInitialized) beginBatch();
  let result: string;
  try {
    result = await executeTool(approval.toolName, args, signal, 'chat', 'user_approved');
  } finally {
    if (memoryInitialized) flushBatch();
  }
  const finalEvent: ToolEvent = {
    ...started,
    status: result.startsWith('Error:') ? 'error' : 'completed',
    detail: result.startsWith('Error:') ? result.slice(0, 180) : 'Approved action executed.',
  };
  toolEvents = updateToolEvent(toolEvents, finalEvent);
  emit(onEvent, { type: 'tool_event', event: finalEvent });

  // Extract memories from approved write tool result
  if (!result.startsWith('Error:') && memoryInitialized) {
    try {
      extractedMemories = extractFromToolResult({ toolName: approval.toolName, args, result, conversationId: options.conversationId });
      console.log('[memory] Extraction result for approved', approval.toolName, ':', extractedMemories.length, 'memories');
      if (memoryInitialized) beginBatch();
      if (memoryInitialized) beginEmbeddingBatch();
      try {
        for (const mem of extractedMemories) {
          const entry = mergeMemory({
            category: mem.category,
            content: mem.content,
            tags: mem.tags,
            metadata: mem.metadata,
            resourceIds: mem.resourceIds,
            source: mem.source,
          });
          console.log('[memory] Saved memory from approval:', entry.id);
          // Compute and save embedding for the new memory (T086)
          if (supportsEmbeddings()) {
            computeEmbedding(entry.content + ' ' + entry.tags.join(' ')).then((embedding) => {
              if (embedding) saveEmbedding(entry.id, embedding);
            }).catch(() => { /* non-fatal */ });
          }
        }
      } finally {
        if (memoryInitialized) flushBatch();
        if (memoryInitialized) flushEmbeddingBatch();
      }
    } catch (err) {
      console.error('[memory] Memory extraction failed in executeApprovedAction:', err);
    }
  }

  // After executing the approved step, check if there are remaining dynamic tool steps
  if (!result.startsWith('Error:') && approval.toolArgs?._dynamicToolName) {
    const remainingStepsRaw = approval.toolArgs._remainingSteps;
    let remainingSteps: ToolStep[] = [];
    if (typeof remainingStepsRaw === 'string') {
      try {
        const parsed = JSON.parse(remainingStepsRaw);
        if (Array.isArray(parsed)) remainingSteps = parsed as ToolStep[];
      } catch { /* malformed — skip remaining */ }
    }

    // Restore the interpolation context from the completed steps so remaining
    // step args (e.g. {{steps.credit_card_threads.thread_ids}}) resolve correctly.
    let savedOutputKeys: Record<string, Record<string, unknown> | null> = {};
    if (typeof approval.toolArgs._outputKeys === 'string') {
      try {
        const parsed = JSON.parse(approval.toolArgs._outputKeys);
        if (parsed && typeof parsed === 'object') savedOutputKeys = parsed;
      } catch { /* ignore */ }
    }
    const interpCtx = { input: {}, steps: [], outputKeys: savedOutputKeys };

    for (let stepIdx = 0; stepIdx < remainingSteps.length; stepIdx++) {
      const step = remainingSteps[stepIdx];
      ensureNotAborted(signal);

      const resolvedStepArgs = interpolateArgs(step.args as Record<string, unknown>, interpCtx);

      const stepEvent: ToolEvent = {
        id: `${approval.id}-step-${stepIdx}`,
        toolName: step.action,
        label: verboseRunningLabel(step.action, resolvedStepArgs),
        status: 'running',
      };
      toolEvents = updateToolEvent(toolEvents, stepEvent);
      emit(onEvent, { type: 'tool_event', event: stepEvent });

      // If this remaining step is also a write tool, halt and return a new approval request
      if (isWriteTool(step.action)) {
        const nextApproval = buildApprovalRequest(step.action, resolvedStepArgs);
        const originalStepIndex = typeof approval.toolArgs._stepIndex === 'number'
          ? approval.toolArgs._stepIndex + 1 + stepIdx
          : stepIdx;
        const nextApprovalWithContext: ApprovalRequest = {
          ...nextApproval,
          toolArgs: {
            ...resolvedStepArgs,
            _dynamicToolName: approval.toolArgs._dynamicToolName,
            _stepIndex: originalStepIndex,
            _remainingSteps: JSON.stringify(remainingSteps.slice(stepIdx + 1)),
            _outputKeys: approval.toolArgs._outputKeys,
          },
        };
        if (options.runId) nextApprovalWithContext.runId = options.runId;
        if (options.sourceMessageId) nextApprovalWithContext.sourceMessageId = options.sourceMessageId;

        const approvalEvent: ToolEvent = {
          ...stepEvent,
          status: 'approval_required',
          detail: 'Waiting for explicit approval before executing.',
        };
        toolEvents = updateToolEvent(toolEvents, approvalEvent);
        emit(onEvent, { type: 'tool_event', event: approvalEvent });

        const approvalPayload: AssistantPayload = {
          content: approvalMessage(step.action),
          blocks: buildBlocksFromToolResult(approval.toolName, result),
          toolEvents,
          approval: nextApprovalWithContext,
        };
        emitFinalPayload(onEvent, approvalPayload, options.persona);
        return approvalPayload;
      }

      // Execute read/non-write remaining step
      let stepResult: string;
      try {
        stepResult = await executeTool(step.action, resolvedStepArgs, signal, 'chat', 'user_approved');
      } catch (err: any) {
        const errEvent: ToolEvent = { ...stepEvent, status: 'error', detail: err?.message ?? 'Step failed.' };
        toolEvents = updateToolEvent(toolEvents, errEvent);
        emit(onEvent, { type: 'tool_event', event: errEvent });
        break;
      }

      const stepDone: ToolEvent = {
        ...stepEvent,
        label: toolLabel(step.action),
        status: stepResult.startsWith('Error:') ? 'error' : 'completed',
        detail: stepResult.startsWith('Error:') ? stepResult.slice(0, 180) : verboseCompletedDetail(step.action, stepResult),
      };
      toolEvents = updateToolEvent(toolEvents, stepDone);
      emit(onEvent, { type: 'tool_event', event: stepDone });

      // Extract memories from this step's result
      if (!stepResult.startsWith('Error:') && memoryInitialized) {
        try {
          const stepMems = extractFromToolResult({ toolName: step.action, args: resolvedStepArgs, result: stepResult, conversationId: options.conversationId });
          if (memoryInitialized) beginBatch();
          try {
            for (const mem of stepMems) {
              extractedMemories.push(mem);
              mergeMemory({
                category: mem.category,
                content: mem.content,
                tags: mem.tags,
                metadata: mem.metadata,
                resourceIds: mem.resourceIds,
                source: mem.source,
              });
            }
          } finally {
            if (memoryInitialized) flushBatch();
          }
        } catch (memErr) {
          console.error('[memory] Memory extraction failed for remaining step:', memErr);
        }
      }

      if (stepResult.startsWith('Error:')) break;
    }
  }

  // Build a richer success message for tools that produce referenceable output
  let successContent = 'Approved action completed successfully.';
  if (!result.startsWith('Error:')) {
    // Dynamic tools: use the result directly as a structured summary
    if (approval.toolArgs?._dynamicToolName) {
      successContent = result;
    } else {
      try {
        const parsed = JSON.parse(result);
        if (approval.toolName === 'sheets_create' && parsed?.spreadsheetId) {
          const title = parsed.properties?.title ?? 'Untitled';
          const url = parsed.spreadsheetUrl ?? '';
          successContent = `Created spreadsheet "${title}" (ID: ${parsed.spreadsheetId}).${url ? `\nOpen it here: ${url}` : ''}`;
        }
      } catch { /* non-JSON result, use default message */ }
    }
  }

  const payload: AssistantPayload = {
    content: result.startsWith('Error:')
      ? `The approved action failed.\n\n${result}`
      : successContent,
    blocks: buildBlocksFromToolResult(approval.toolName, result),
    toolEvents,
    suggestions: result.startsWith('Error:')
      ? ['Retry this action', 'Show me the failed threads']
      : approval.toolName === 'archive_email_threads'
        ? ['Mute similar senders', 'Create a filter for these emails', 'Review action-required emails']
        : approval.toolName === 'mark_threads_read'
          ? ['Archive these emails too', 'Review action-required emails']
          : approval.toolName === 'create_gmail_filter'
            ? ['Apply this filter strategy to another sender', 'Review recent inbox actions']
            : undefined,
    threadBriefSuggestion: generateThreadBriefSuggestion(extractedMemories),
  };

  emitFinalPayload(onEvent, payload, options.persona);
  return payload;
}
