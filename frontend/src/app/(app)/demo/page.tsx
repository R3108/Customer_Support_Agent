import type { Metadata } from "next";
import { DemoPlayground } from "./DemoPlayground";

export const metadata: Metadata = { title: "Live demo" };

export default function DemoPage() {
  return <DemoPlayground />;
}
