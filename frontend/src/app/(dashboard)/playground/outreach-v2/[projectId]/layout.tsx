import React from "react";
import { OutreachShell } from "../shared/outreach-shell";

export default function OutreachProjectLayout({ children }: { children: React.ReactNode }) {
  return <OutreachShell>{children}</OutreachShell>;
}
