import type { Metadata } from "next";
import { AuthShell } from "../auth-shell";

export const metadata: Metadata = {
  title: "Recuperar senha | ZapFlow",
};

export default function RecoveryPage() {
  return <AuthShell mode="recovery" />;
}
