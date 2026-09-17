import type { Metadata } from "next";
import { KnowledgeManager } from "./KnowledgeManager";

export const metadata: Metadata = { title: "Knowledge base" };

export default function KnowledgePage() {
  return <KnowledgeManager />;
}
