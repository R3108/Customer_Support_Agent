import type { Metadata } from "next";
import { TestLab } from "./TestLab";

export const metadata: Metadata = { title: "Test Lab" };

export default function TestLabPage() {
  return <TestLab />;
}
