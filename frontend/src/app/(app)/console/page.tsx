import type { Metadata } from "next";
import { AgentConsole } from "./AgentConsole";

export const metadata: Metadata = { title: "Agent console" };

export default function ConsolePage() {
  return <AgentConsole />;
}
