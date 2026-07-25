"use client";
import React from "react";
import { Bot, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: () => void;
}

export function WelcomeModal({ isOpen, onClose, onStart }: WelcomeModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2 }}
            className="relative w-full max-w-md bg-background rounded-2xl shadow-xl"
          >
            <div className="p-8 text-center">
              
              {/* Close */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 text-muted hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Icon */}
             <img src="/logo.png" alt="AutoDeskAI" className="mx-auto mb-6 w-12 h-12" />

              {/* Title */}
              <h2 className="text-2xl font-semibold text-foreground mb-2">
                Welcome to AutoDeskAI
              </h2>

              {/* Description */}
              <p className="text-sm text-muted mb-8">
                Set up your profile to personalize your AI workflow.
              </p>

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <button
                  onClick={onStart}
                  id="start-setup-btn"
                  className="w-full py-3 rounded-xl bg-primary text-white text-sm font-medium hover:opacity-90 transition"
                >
                  Get Started
                </button>

                <button
                  onClick={onClose}
                  className="text-sm text-muted hover:text-foreground"
                >
                  Skip for now
                </button>
              </div>

            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}