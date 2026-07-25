"use client";
import React from "react";
import Link from "next/link";
import { Home } from "lucide-react";

interface HomeButtonProps {
  className?: string;
}

export default function HomeButton({ className = "" }: HomeButtonProps) {
  return (
    <Link
      href="/"
      className={`absolute top-6 left-6 z-30 flex items-center justify-center w-12 h-12 rounded-full bg-surface/90 backdrop-blur-sm text-foreground shadow-lg hover:bg-surface transition-all duration-200 hover:scale-105 border border-border ${className}`}
      style={{ textDecoration: 'none' }}
    >
      <Home className="w-5 h-5" />
    </Link>
  );
}