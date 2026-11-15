import type { Metadata } from "next";
import { AuthShell } from "../auth-shell";

export const metadata: Metadata = {
  title: "Definir nova senha | ZapFlow",
};

export default function ResetPasswordPage() {
  return <AuthShell mode="reset" />;
}
