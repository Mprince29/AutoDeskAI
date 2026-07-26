"use client";

import Image, { type ImageProps } from "next/image";
import { useTheme } from "next-themes";

type AppLogoProps = Omit<ImageProps, "src" | "alt" | "priority" | "loading"> & {
  alt?: string;
};

/** Theme-aware brand mark: swaps to a brightened variant on dark backgrounds. */
export function AppLogo({ alt = "AutoDeskAI", ...props }: AppLogoProps) {
  const { resolvedTheme } = useTheme();
  const src = resolvedTheme === "dark" ? "/logo-dark.png" : "/logo.png";

  return <Image src={src} alt={alt} {...props} />;
}
