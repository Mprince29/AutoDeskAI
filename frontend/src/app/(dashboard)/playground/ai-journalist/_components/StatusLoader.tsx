import React from "react";
import { StatusLoader as SharedStatusLoader } from "@/components/shared/StatusLoader";

export function StatusLoader({ statuses }: { statuses: string[] }) {
  return <SharedStatusLoader statuses={statuses} title="Journalist Pipeline" />;
}