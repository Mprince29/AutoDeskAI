import React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Loader2 } from "lucide-react";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => unknown;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  isLoading?: boolean;
  variant?: "default" | "destructive";
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isLoading = false,
  variant = "default",
}: ConfirmationModalProps) {
  const isDestructive = variant === "destructive";

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="overflow-hidden border border-border/70 bg-background p-0 shadow-[0_30px_90px_rgba(0,0,0,0.18)] sm:max-w-[480px] sm:rounded-3xl">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
        <div className="px-6 py-6 sm:px-7 sm:py-7">
          <AlertDialogHeader className="gap-4 text-left">
            <div className="flex items-start gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-sm ${
                  isDestructive
                    ? "border-red-500/20 bg-red-500/10 text-red-500"
                    : "border-primary/15 bg-primary/10 text-primary"
                }`}
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <AlertDialogTitle className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-foreground">
                  {title}
                </AlertDialogTitle>
                <AlertDialogDescription className="max-w-[36ch] text-[14px] leading-7 text-muted-dark">
                  {description}
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>

          <div className="mt-6 rounded-2xl border border-border/50 bg-surface/55 px-4 py-3 text-[12px] font-medium text-muted-dark">
            {isDestructive
              ? "This action is permanent and cannot be reversed."
              : "Please confirm to continue with this action."}
          </div>

          <AlertDialogFooter className="mt-7 flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:space-x-0">
            <AlertDialogCancel
              disabled={isLoading}
              className="mt-0 h-11 rounded-xl border-border/70 bg-background px-5 text-[14px] font-medium text-foreground transition-all hover:border-border-light hover:bg-surface/70"
            >
              {cancelText}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isLoading}
              onClick={(e) => {
                e.preventDefault();
                void onConfirm();
              }}
              className={`h-11 min-w-[132px] gap-2 rounded-xl px-5 text-[14px] font-semibold shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                isDestructive
                  ? "bg-red-500 text-white hover:bg-red-600 focus-visible:ring-red-500/20"
                  : "bg-primary text-white hover:bg-primary/90"
              }`}
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {confirmText}
            </AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
