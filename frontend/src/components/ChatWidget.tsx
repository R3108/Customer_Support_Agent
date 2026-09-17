"use client";

import { MessageCircle, X } from "lucide-react";
import { useState } from "react";
import { useChat } from "@/hooks/useChat";
import { useWorkspaceConfig } from "@/hooks/useWorkspaceConfig";
import { cx } from "@/lib/format";
import { brandStyle } from "@/lib/theme";
import { ChatPanel } from "./ChatPanel";

/** Embeddable floating support widget, as a customer would see it on a storefront. */
export function ChatWidget({ customerId = null }: { customerId?: string | null }) {
  const [open, setOpen] = useState(false);
  const chat = useChat(customerId, "widget");
  const config = useWorkspaceConfig();

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3" style={brandStyle(config?.accent_color)}>
      <div
        className={cx(
          "h-[min(620px,calc(100dvh-110px))] w-[min(390px,calc(100vw-40px))] origin-bottom-right overflow-hidden rounded-2xl border border-slate-200 shadow-2xl transition duration-200",
          open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
        )}
        aria-hidden={!open}
      >
        <ChatPanel
          chat={chat}
          compact
          assistantName={config?.assistant_name}
          companyName={config?.company_name}
          welcome={config?.welcome_message}
          suggestions={config?.suggested_prompts ?? ["Where is my order?", "Return policy", "Talk to a human"]}
        />
      </div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 transition hover:scale-105 hover:bg-brand-700"
        aria-label={open ? "Close support chat" : "Open support chat"}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </div>
  );
}
