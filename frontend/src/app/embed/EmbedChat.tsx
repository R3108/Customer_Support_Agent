"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { useChat } from "@/hooks/useChat";
import { useWorkspaceConfig } from "@/hooks/useWorkspaceConfig";
import { brandStyle } from "@/lib/theme";

/** Chat rendered inside the iframe that public/widget.js injects into any website. */
export function EmbedChat({ customerId }: { customerId: string | null }) {
  const chat = useChat(customerId, "embed");
  const config = useWorkspaceConfig();

  // Let the host page's launcher button pick up the workspace accent colour.
  useEffect(() => {
    if (config && window.parent !== window) window.parent.postMessage({ type: "relay:config", accent: config.accent_color }, "*");
  }, [config]);

  return (
    <div className="h-dvh" style={brandStyle(config?.accent_color)}>
      <ChatPanel
        chat={chat}
        compact
        assistantName={config?.assistant_name}
        companyName={config?.company_name}
        welcome={config?.welcome_message}
        suggestions={config?.suggested_prompts ?? []}
        headerExtra={
          <button
            onClick={() => window.parent.postMessage({ type: "relay:close" }, "*")}
            className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close chat"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        }
      />
    </div>
  );
}
