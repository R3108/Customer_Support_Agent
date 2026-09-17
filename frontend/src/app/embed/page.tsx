import type { Metadata } from "next";
import { EmbedChat } from "./EmbedChat";

export const metadata: Metadata = { title: "Support chat", robots: { index: false } };

export default async function EmbedPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const customer = typeof params.customer === "string" && params.customer ? params.customer : null;
  return <EmbedChat customerId={customer} />;
}
