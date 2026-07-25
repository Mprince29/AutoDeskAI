"use client";

import React, { useEffect, useRef, useState, useMemo, forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2, ArrowUp, Paperclip, X, StopCircle, Mic, Globe, BrainCog, FolderCode, Square } from "lucide-react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import type { PipelineStage, PipelineStageKey } from "../state/types";

// ==========================================
// 1. Badge Component
// ==========================================
const tones = {
  green: "border-success/20 bg-success/10 text-success font-semibold",
  amber: "border-warning/20 bg-warning/10 text-warning font-semibold",
  grey: "border-border bg-surface text-muted-dark",
  purple: "border-primary/20 bg-primary/10 text-primary font-semibold"
};

export function Badge({ children, tone = "grey" }: { children: React.ReactNode; tone?: keyof typeof tones }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] tracking-wide", tones[tone])}>
      {children}
    </span>
  );
}

// ==========================================
// 2. FadeUp Component
// ==========================================
export function FadeUp({
  children,
  delay = 0,
  className
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-32px" }}
      transition={{ duration: 0.28, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ==========================================
// 3. Kbd Component
// ==========================================
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex min-w-5 items-center justify-center rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-dark ">
      {children}
    </span>
  );
}

// ==========================================
// 4. PipelineProgress Component
// ==========================================
const pipelineOrder: PipelineStageKey[] = ["parse", "discover", "enrich", "deduplicate", "draft"];

export function PipelineProgress({
  stages,
  activeStage,
  complete
}: {
  stages: PipelineStage[];
  activeStage: PipelineStageKey;
  complete: boolean;
}) {
  const activeIndex = pipelineOrder.indexOf(activeStage);

  return (
    <div className="rounded-xl border border-border bg-surface p-5 ">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-foreground">Agent pipeline</h2>
          <p className="mt-1 text-[12px] text-muted-dark">Transparent enough to trust, quiet enough to move fast.</p>
        </div>
        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-dark">
          {complete ? "Ready for approval" : "Simulated run"}
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {stages.map((stage, index) => {
          const done = complete || index < activeIndex;
          const running = !complete && index === activeIndex;
          return (
            <motion.div
              key={stage.key}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22, delay: index * 0.035, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3.5 transition-all duration-200",
                running && "border-primary bg-primary/5",
                done && "border-success/35 bg-success/5"
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                {done ? (
                  <Check size={14} className="text-success shrink-0" aria-hidden />
                ) : running ? (
                  <Loader2 size={14} className="animate-spin text-primary shrink-0" aria-hidden />
                ) : null}
                {!done && !running ? (
                  <span className="size-2 rounded-full bg-border shrink-0" />
                ) : null}
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-foreground">{stage.label}</span>
                  <p className="truncate text-[12px] text-muted-dark mt-0.5">{stage.detail}</p>
                </div>
              </div>
              <p className="shrink-0 text-[12px] font-mono text-muted-dark">{stage.estimate}</p>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ==========================================
// 5. PromptInputBox Component
// ==========================================
const promptBoxStyles = `
  .mc-prompt-box *:focus-visible {
    outline-offset: 0 !important;
    --ring-offset: 0 !important;
  }
  .mc-prompt-box textarea::-webkit-scrollbar {
    width: 4px;
  }
  .mc-prompt-box textarea::-webkit-scrollbar-track {
    background: transparent;
  }
  .mc-prompt-box textarea::-webkit-scrollbar-thumb {
    background-color: var(--border-light);
    border-radius: 2px;
  }
  .mc-prompt-box textarea::-webkit-scrollbar-thumb:hover {
    background-color: var(--muted);
  }
`;

function usePromptBoxStyles() {
  useEffect(() => {
    const id = "mc-prompt-box-styles";
    if (document.getElementById(id)) return;
    const styleSheet = document.createElement("style");
    styleSheet.id = id;
    styleSheet.innerText = promptBoxStyles;
    document.head.appendChild(styleSheet);
  }, []);
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "flex min-h-[44px] w-full resize-none rounded-md border-none bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-muted-dark focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    ref={ref}
    rows={1}
    {...props}
  />
));
Textarea.displayName = "Textarea";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-foreground  backdrop-blur-md",
      className
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-black/60 backdrop-blur-sm", className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-[90vw] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-border bg-surface p-0  duration-300 md:max-w-[700px]",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 z-10 rounded-full bg-surface-hover p-2 transition-all hover:bg-surface-hover/80">
        <X className="h-4 w-4 text-foreground/80 hover:text-foreground" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogTitle = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-base font-semibold leading-none tracking-tight text-foreground", className)} {...props} />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const variantClasses = {
      default: "bg-primary text-white hover:bg-primary-hover",
      outline: "border border-border bg-transparent hover:bg-surface",
      ghost: "bg-transparent hover:bg-surface"
    };
    const sizeClasses = {
      default: "h-9 px-4 py-2 text-sm",
      sm: "h-8 px-3 text-xs",
      lg: "h-11 px-5 text-sm",
      icon: "h-8 w-8 rounded-full aspect-square"
    };
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center font-medium rounded-lg transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

interface VoiceRecorderProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: (duration: number) => void;
  visualizerBars?: number;
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ isRecording, onStartRecording, onStopRecording, visualizerBars = 24 }) => {
  const [time, setTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const timeRef = useRef(0);
  const barHeights = useMemo(() => Array.from({ length: visualizerBars }, (_, i) => 18 + ((i * 17) % 72)), [visualizerBars]);

  useEffect(() => {
    if (isRecording) {
      onStartRecording();
      timerRef.current = setInterval(() => {
        timeRef.current += 1;
        setTime(timeRef.current);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      onStopRecording(timeRef.current);
      timeRef.current = 0;
      setTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording, onStartRecording, onStopRecording]);

  const mins = Math.floor(time / 60).toString().padStart(2, "0");
  const secs = (time % 60).toString().padStart(2, "0");

  return (
    <div className={cn("flex w-full flex-col items-center justify-center py-2 transition-all duration-300", isRecording ? "opacity-100" : "h-0 opacity-0")}>
      <div className="mb-2 flex items-center gap-1.5">
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-error" />
        <span className="font-mono text-xs text-foreground/80">{mins}:{secs}</span>
      </div>
      <div className="flex h-8 w-full items-center justify-center gap-0.5 px-4">
        {barHeights.map((height, i) => (
          <div
            key={i}
            className="w-0.5 animate-pulse rounded-full bg-primary/60"
            style={{ height: `${height}%`, animationDelay: `${i * 0.04}s`, animationDuration: `${0.6 + (i % 5) * 0.08}s` }}
          />
        ))}
      </div>
    </div>
  );
};

interface ImageViewDialogProps {
  imageUrl: string | null;
  onClose: () => void;
}

const ImageViewDialog: React.FC<ImageViewDialogProps> = ({ imageUrl, onClose }) => {
  if (!imageUrl) return null;
  return (
    <Dialog open={!!imageUrl} onOpenChange={onClose}>
      <DialogContent className="border-none bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">Image Preview</DialogTitle>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="relative overflow-hidden rounded-2xl bg-surface border border-border "
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Full preview" className="max-h-[75vh] w-full rounded-2xl object-contain" />
        </motion.div>
      </DialogContent>
    </Dialog>
  );
};

interface PromptInputContextType {
  isLoading: boolean;
  value: string;
  setValue: (value: string) => void;
  maxHeight: number | string;
  onSubmit?: () => void;
  disabled?: boolean;
}

const PromptInputContext = React.createContext<PromptInputContextType>({
  isLoading: false,
  value: "",
  setValue: () => {},
  maxHeight: 240,
  onSubmit: undefined,
  disabled: false
});

function usePromptInput() {
  const context = React.useContext(PromptInputContext);
  if (!context) throw new Error("usePromptInput must be used within a PromptInput");
  return context;
}

interface PromptInputProps {
  isLoading?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  maxHeight?: number | string;
  onSubmit?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}

const PromptInput = forwardRef<HTMLDivElement, PromptInputProps>(
  ({ className, isLoading = false, maxHeight = 240, value, onValueChange, onSubmit, children, disabled = false, onDragOver, onDragLeave, onDrop }, ref) => {
    const [internalValue, setInternalValue] = useState(value || "");
    const handleChange = (newValue: string) => {
      setInternalValue(newValue);
      onValueChange?.(newValue);
    };
    return (
      <TooltipProvider>
        <PromptInputContext.Provider
          value={{
            isLoading,
            value: value ?? internalValue,
            setValue: onValueChange ?? handleChange,
            maxHeight,
            onSubmit,
            disabled
          }}
        >
          <div
            ref={ref}
            className={cn(
              "mc-prompt-box rounded-2xl border border-border bg-surface p-2  transition-all duration-300 focus-within:border-primary/50",
              isLoading && "border-error/70",
              className
            )}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {children}
          </div>
        </PromptInputContext.Provider>
      </TooltipProvider>
    );
  }
);
PromptInput.displayName = "PromptInput";

interface PromptInputTextareaProps {
  disableAutosize?: boolean;
  placeholder?: string;
}

const PromptInputTextarea: React.FC<PromptInputTextareaProps & React.ComponentProps<typeof Textarea>> = ({
  className,
  onKeyDown,
  disableAutosize = false,
  placeholder,
  ...props
}) => {
  const { value, setValue, maxHeight, onSubmit, disabled } = usePromptInput();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (disableAutosize || !textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height =
      typeof maxHeight === "number"
        ? `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`
        : `min(${textareaRef.current.scrollHeight}px, ${maxHeight})`;
  }, [value, maxHeight, disableAutosize]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
    onKeyDown?.(e);
  };

  return (
    <Textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      className={cn("text-sm", className)}
      disabled={disabled}
      placeholder={placeholder}
      {...props}
    />
  );
};

const PromptInputActions: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className, ...props }) => (
  <div className={cn("flex items-center gap-2", className)} {...props}>
    {children}
  </div>
);

interface PromptInputActionProps extends React.ComponentProps<typeof Tooltip> {
  tooltip: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}

const PromptInputAction: React.FC<PromptInputActionProps> = ({ tooltip, children, className, side = "top", ...props }) => {
  const { disabled } = usePromptInput();
  return (
    <Tooltip {...props}>
      <TooltipTrigger asChild disabled={disabled}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className={className}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
};

const CustomDivider: React.FC = () => (
  <div className="mx-1 h-4 w-px bg-border" />
);

interface PromptInputBoxProps {
  onSend?: (message: string, files?: File[]) => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}

export const PromptInputBox = forwardRef<HTMLDivElement, PromptInputBoxProps>((props, ref) => {
  const { onSend = () => {}, isLoading = false, placeholder = "Type your message here...", className, value, onValueChange } = props;
  const [internalInput, setInternalInput] = useState(value ?? "");
  const input = value ?? internalInput;
  const setInput = onValueChange ?? setInternalInput;
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<{ [key: string]: string }>({});
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showThink, setShowThink] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const promptBoxRef = useRef<HTMLDivElement>(null);

  usePromptBoxStyles();

  const handleToggleChange = (toggleValue: string) => {
    if (toggleValue === "search") {
      setShowSearch((prev) => !prev);
      setShowThink(false);
    } else if (toggleValue === "think") {
      setShowThink((prev) => !prev);
      setShowSearch(false);
    }
  };

  const isImageFile = (file: File) => file.type.startsWith("image/");

  const processFile = React.useCallback((file: File) => {
    if (!isImageFile(file) || file.size > 10 * 1024 * 1024) return;
    setFiles([file]);
    const reader = new FileReader();
    reader.onload = (e) => setFilePreviews({ [file.name]: e.target?.result as string });
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const imageFiles = Array.from(e.dataTransfer.files).filter((file) => isImageFile(file));
      if (imageFiles.length > 0) processFile(imageFiles[0]);
    },
    [processFile]
  );

  const handlePaste = React.useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            processFile(file);
            break;
          }
        }
      }
    },
    [processFile]
  );

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const handleSubmit = () => {
    if (input.trim() || files.length > 0) {
      let messagePrefix = "";
      if (showSearch) messagePrefix = "[Search: ";
      else if (showThink) messagePrefix = "[Think: ";
      else if (showCanvas) messagePrefix = "[Canvas: ";
      const formattedInput = messagePrefix ? `${messagePrefix}${input}]` : input;
      onSend(formattedInput, files);
      setInput("");
      setFiles([]);
      setFilePreviews({});
    }
  };

  const handleStopRecording = (duration: number) => {
    setIsRecording(false);
    if (duration > 0) onSend(`[Voice message - ${duration} seconds]`, []);
  };

  const hasContent = input.trim() !== "" || files.length > 0;

  return (
    <>
      <PromptInput
        value={input}
        onValueChange={setInput}
        isLoading={isLoading}
        onSubmit={handleSubmit}
        className={cn(
          "w-full bg-surface border-border transition-all duration-300 ease-in-out ",
          isRecording && "border-error/70",
          className
        )}
        disabled={isLoading || isRecording}
        ref={ref || promptBoxRef}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={handleDrop}
      >
        {files.length > 0 && !isRecording && (
          <div className="flex flex-wrap gap-2 p-0 pb-1.5 transition-all duration-300">
            {files.map((file) => (
              <div key={file.name} className="group relative">
                {file.type.startsWith("image/") && filePreviews[file.name] && (
                  <div className="h-14 w-14 cursor-pointer overflow-hidden rounded-xl border border-border transition-all duration-300" onClick={() => setSelectedImage(filePreviews[file.name])}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={filePreviews[file.name]} alt={file.name} className="h-full w-full object-cover" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFiles([]);
                        setFilePreviews({});
                      }}
                      className="absolute -right-1.5 -top-1.5 rounded-full bg-black/80 p-0.5 opacity-100 hover:bg-black"
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className={cn("transition-all duration-300", isRecording ? "h-0 overflow-hidden opacity-0" : "opacity-100")}>
          <PromptInputTextarea
            placeholder={showSearch ? "Search the web..." : showThink ? "Think deeply..." : showCanvas ? "Create on canvas..." : placeholder}
            className="text-sm"
          />
        </div>

        {isRecording && <VoiceRecorder isRecording={isRecording} onStartRecording={() => undefined} onStopRecording={handleStopRecording} />}

        <PromptInputActions className="flex items-center justify-between gap-2 p-0 pt-2">
          <div className={cn("flex items-center gap-1.5 transition-opacity duration-300", isRecording ? "invisible h-0 opacity-0" : "visible opacity-100")}>
            <PromptInputAction tooltip="Upload image">
              <button
                onClick={() => uploadInputRef.current?.click()}
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-muted-dark transition-colors hover:bg-surface-hover hover:text-foreground"
                disabled={isRecording}
              >
                <Paperclip className="h-4 w-4 transition-colors" />
                <input
                  ref={uploadInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) processFile(e.target.files[0]);
                    e.target.value = "";
                  }}
                  accept="image/*"
                />
              </button>
            </PromptInputAction>

            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => handleToggleChange("search")}
                className={cn(
                  "flex h-7 items-center gap-1 rounded-full border px-2 py-0.5 transition-all text-xs",
                  showSearch ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400" : "border-transparent bg-transparent text-muted-dark hover:text-foreground"
                )}
              >
                <motion.div animate={{ rotate: showSearch ? 360 : 0, scale: showSearch ? 1.05 : 1 }} transition={{ type: "spring", stiffness: 260, damping: 25 }}>
                  <Globe className="h-3.5 w-3.5" />
                </motion.div>
                <AnimatePresence>{showSearch && <motion.span initial={{ width: 0, opacity: 0 }} animate={{ width: "auto", opacity: 1 }} exit={{ width: 0, opacity: 0 }} className="overflow-hidden whitespace-nowrap">Search</motion.span>}</AnimatePresence>
              </button>

              <CustomDivider />

              <button
                type="button"
                onClick={() => handleToggleChange("think")}
                className={cn(
                  "flex h-7 items-center gap-1 rounded-full border px-2 py-0.5 transition-all text-xs",
                  showThink ? "border-primary bg-primary/10 text-primary" : "border-transparent bg-transparent text-muted-dark hover:text-foreground"
                )}
              >
                <motion.div animate={{ rotate: showThink ? 360 : 0, scale: showThink ? 1.05 : 1 }} transition={{ type: "spring", stiffness: 260, damping: 25 }}>
                  <BrainCog className="h-3.5 w-3.5" />
                </motion.div>
                <AnimatePresence>{showThink && <motion.span initial={{ width: 0, opacity: 0 }} animate={{ width: "auto", opacity: 1 }} exit={{ width: 0, opacity: 0 }} className="overflow-hidden whitespace-nowrap">Think</motion.span>}</AnimatePresence>
              </button>

              <CustomDivider />

              <button
                type="button"
                onClick={() => setShowCanvas((prev) => !prev)}
                className={cn(
                  "flex h-7 items-center gap-1 rounded-full border px-2 py-0.5 transition-all text-xs",
                  showCanvas ? "border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400" : "border-transparent bg-transparent text-muted-dark hover:text-foreground"
                )}
              >
                <motion.div animate={{ rotate: showCanvas ? 360 : 0, scale: showCanvas ? 1.05 : 1 }} transition={{ type: "spring", stiffness: 260, damping: 25 }}>
                  <FolderCode className="h-3.5 w-3.5" />
                </motion.div>
                <AnimatePresence>{showCanvas && <motion.span initial={{ width: 0, opacity: 0 }} animate={{ width: "auto", opacity: 1 }} exit={{ width: 0, opacity: 0 }} className="overflow-hidden whitespace-nowrap">Canvas</motion.span>}</AnimatePresence>
              </button>
            </div>
          </div>

          <PromptInputAction tooltip={isLoading ? "Stop generation" : isRecording ? "Stop recording" : hasContent ? "Send message" : "Voice message"}>
            <Button
              variant={hasContent ? "default" : "outline"}
              size="icon"
              className={cn(
                "h-7 w-7 rounded-full transition-all duration-200",
                isRecording
                  ? "bg-transparent text-error hover:bg-surface-hover hover:text-error"
                  : hasContent
                    ? "bg-primary text-white hover:bg-primary-hover border-transparent"
                    : "bg-transparent text-muted-dark border-border hover:bg-surface-hover hover:text-foreground"
              )}
              onClick={() => {
                if (isRecording) setIsRecording(false);
                else if (hasContent) handleSubmit();
                else setIsRecording(true);
              }}
              disabled={isLoading && !hasContent}
            >
              {isLoading ? (
                <Square className="h-3.5 w-3.5 animate-pulse fill-foreground" />
              ) : isRecording ? (
                <StopCircle className="h-4 w-4 text-error" />
              ) : hasContent ? (
                <ArrowUp className="h-3.5 w-3.5 text-white" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
          </PromptInputAction>
        </PromptInputActions>
      </PromptInput>

      <ImageViewDialog imageUrl={selectedImage} onClose={() => setSelectedImage(null)} />
    </>
  );
});
PromptInputBox.displayName = "PromptInputBox";
