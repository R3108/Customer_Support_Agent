import type { Metadata } from "next";
import { SettingsManager } from "./SettingsManager";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <SettingsManager />;
}
