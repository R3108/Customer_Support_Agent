"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, streamChat } from "@/lib/api";
import type { AgentStep, Conversation, Message } from "@/lib/types";

const storageKey = (customerId: string | null, namespace: string) => `relay.${namespace}.${customerId ?? "guest"}`;

function readStored(customerId: string | null, namespace: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(customerId, namespace));
  } catch {
    return null;
  }
}

function writeStored(customerId: string | null, namespace: string, id: string | null) {
  try {
    if (id) window.localStorage.setItem(storageKey(customerId, namespace), id);
    else window.localStorage.removeItem(storageKey(customerId, namespace));
  } catch {
    /* storage unavailable */
  }
}

function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.filter((m) => m.id > 0).map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  const pending = current.filter((m) => m.id < 0 && !incoming.some((i) => i.role === m.role && i.content === m.content));
  return [...Array.from(byId.values()).sort((a, b) => a.id - b.id), ...pending];
}

export interface ChatController {
  conversation: Conversation | null;
  messages: Message[];
  pending: boolean;
  liveSteps: AgentStep[];
  lastSteps: AgentStep[];
  error: string | null;
  send: (text: string) => Promise<void>;
  reset: () => void;
  rate: (rating: number) => Promise<void>;
  rated: boolean;
}

/** `namespace` keeps separately embedded chats (demo page, storefront widget) from sharing a conversation. */
export function useChat(customerId: string | null, namespace = "conversation"): ChatController {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const [lastSteps, setLastSteps] = useState<AgentStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rated, setRated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const tempId = useRef(-1);

  // Restore the customer's previous conversation (server-side memory makes it resumable).
  useEffect(() => {
    let cancelled = false;
    abortRef.current?.abort();
    const stored = readStored(customerId, namespace);
    const restore = async () => {
      setConversation(null);
      setMessages([]);
      setLiveSteps([]);
      setLastSteps([]);
      setError(null);
      setRated(false);
      if (!stored) return;
      try {
        const data = await api.conversation(stored);
        if (cancelled) return;
        if (data.conversation.customer_id !== customerId) {
          writeStored(customerId, namespace, null);
          return;
        }
        setConversation(data.conversation);
        setMessages(data.messages);
        setRated(data.conversation.csat !== null);
      } catch (e) {
        if (!cancelled && e instanceof ApiError && e.status === 404) writeStored(customerId, namespace, null);
      }
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [customerId, namespace]);

  // While a specialist owns the conversation, poll for their replies.
  const conversationId = conversation?.id;
  const status = conversation?.status;
  const lastId = messages.reduce((max, m) => Math.max(max, m.id), 0);
  useEffect(() => {
    if (!conversationId || status !== "escalated") return;
    const timer = window.setInterval(async () => {
      try {
        const data = await api.pollMessages(conversationId, lastId);
        if (data.messages.length) setMessages((cur) => mergeMessages(cur, data.messages));
        setConversation(data.conversation);
      } catch {
        /* transient */
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [conversationId, status, lastId]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || pending) return;
      setError(null);
      setPending(true);
      setLiveSteps([]);
      const optimistic: Message = {
        id: tempId.current--,
        conversation_id: conversation?.id ?? "",
        role: "customer",
        content: trimmed,
        meta: {},
        created_at: new Date().toISOString(),
      };
      setMessages((cur) => [...cur, optimistic]);
      const controller = new AbortController();
      abortRef.current = controller;
      const steps: AgentStep[] = [];
      try {
        await streamChat(
          { message: trimmed, conversation_id: conversation?.id, customer_id: customerId },
          {
            onConversation: (c) => {
              setConversation(c);
              writeStored(customerId, namespace, c.id);
            },
            onCustomerMessage: (m) => setMessages((cur) => mergeMessages(cur.filter((x) => x.id !== optimistic.id), [m])),
            onStep: (s) => {
              steps.push(s);
              setLiveSteps([...steps]);
            },
            onMessage: (m, c) => {
              setMessages((cur) => mergeMessages(cur, [m]));
              setConversation(c);
              if (steps.length) setLastSteps([...steps]);
            },
          },
          controller.signal,
        );
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
          setMessages((cur) => cur.filter((m) => m.id !== optimistic.id));
          if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
            writeStored(customerId, namespace, null);
            setConversation(null);
          }
        }
      } finally {
        setPending(false);
        setLiveSteps([]);
      }
    },
    [conversation, customerId, namespace, pending],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    writeStored(customerId, namespace, null);
    setConversation(null);
    setMessages([]);
    setLastSteps([]);
    setLiveSteps([]);
    setError(null);
    setRated(false);
  }, [customerId, namespace]);

  const rate = useCallback(
    async (rating: number) => {
      if (!conversation) return;
      await api.feedback(conversation.id, rating);
      setRated(true);
    },
    [conversation],
  );

  return { conversation, messages, pending, liveSteps, lastSteps, error, send, reset, rate, rated };
}
