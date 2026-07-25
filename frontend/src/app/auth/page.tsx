"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { Loader2, Check, Eye, EyeOff } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// --- Types ---
type Step = "email" | "login" | "signup" | "forgot-password" | "reset-password";

// --- Components ---

function AuthHeader({ step, email }: { step: Step; email?: string }) {
  const getTitle = () => {
    switch (step) {
      case "email": return { main: "Identify", sub: "Yourself." };
      case "login": return { main: "Welcome", sub: "Back." };
      case "signup": return { main: "Create", sub: "Account." };
      case "forgot-password": return { main: "Reset", sub: "Access." };
      case "reset-password": return { main: "Verify", sub: "Identity." };
      default: return { main: "Auth", sub: "System." };
    }
  };

  const getSubTitle = () => {
    switch (step) {
      case "email": return "Initialize session to access the central intelligence engine.";
      case "forgot-password": return "Enter your email to receive a recovery code.";
      case "reset-password": return `Enter the 6-digit code sent to ${email}`;
      default: return `Continuing as ${email}`;
    }
  };

  const { main, sub } = getTitle();

  return (
    <div className="mb-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 className="text-[64px] leading-[0.85] font-black tracking-tighter text-foreground mb-4">
          {main}<br />
          <span className="text-foreground/15 font-medium">{sub}</span>
        </h1>
        <p className="text-[15px] font-medium text-muted-dark/40 max-w-[320px] leading-snug">
          {getSubTitle()}
        </p>
      </motion.div>
    </div>
  );
}

// --- Main Page ---
export default function AuthPage() {
  const { user, loading: authLoading, login: authLogin } = useAuth();
  const router = useRouter();

  // Navigation State
  const [step, setStep] = useState<Step>("email");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [agreeToTerms, setAgreeToTerms] = useState(false);

  // Form Data
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  const isSigningUpRef = useRef(false);
  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;

  // Timer logic for Resend OTP
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resendTimer > 0) {
      timer = setInterval(() => setResendTimer(prev => prev - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [resendTimer]);

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user && !isSigningUpRef.current) router.push("/chat");
  }, [user, authLoading, router]);

  if (authLoading) return null;

  async function handleCheckEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!agreeToTerms) {
      setError("Please agree to the Terms of Service.");
      return;
    }
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/check-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Verification failed");
      const data = await res.json();
      setStep(data.exists ? "login" : "signup");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.detail === "Invalid credentials" ? "Invalid password" : (data.detail || "Couldn't sign you in."));
        return;
      }
      const data = await res.json();
      authLogin(data.user, data.access_token);
      setSuccess(true);
      setTimeout(() => router.push("/chat"), 100);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.detail || "Couldn't create your account.");
        return;
      }
      const data = await res.json();
      isSigningUpRef.current = true;
      authLogin(data.user, data.access_token);
      setSuccess(true);
      setTimeout(() => router.push("/chat"), 100);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleForgotPassword(e: any) {
    if (e) e.preventDefault();
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error("Failed to send OTP");
      setStep("reset-password");
      setResendTimer(60);
    } catch {
      setError("Failed to send OTP. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, new_password: password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.detail || "Invalid code or expired.");
        return;
      }
      setSuccess(true);
      setTimeout(() => setStep("login"), 1500);
    } catch {
      setError("Reset failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleGoogleLogin = () => {
    window.location.href = `${API_BASE_URL}/api/auth/google`;
  };

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center bg-background px-6 py-12 selection:bg-primary/30 overflow-hidden">
      {/* Texture & Background Elements */}
      <div className="noise-texture" />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute left-[10%] top-[10%] h-[600px] w-[600px] rounded-full bg-primary/[0.03] blur-[150px]" />
        <div className="absolute right-[10%] bottom-[10%] h-[500px] w-[500px] rounded-full bg-primary/[0.02] blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-[640px]">
        <AuthHeader
          step={step}
          email={email}
        />

        <div className="mt-8">
          <AnimatePresence mode="wait">
            {step === "email" && (
              <motion.div
                key="email-step"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="space-y-10"
              >
                <form onSubmit={handleCheckEmail} className="space-y-12">
                  <div className="space-y-4">
                    <label className="text-[26px] font-bold text-foreground/30 tracking-tight block">
                      Enter your email address
                    </label>
                    <div className="relative group">
                      <input
                        type="email"
                        placeholder="email address"
                        className="w-full bg-transparent border-b-2 border-foreground/10 py-3 text-[32px] font-bold text-foreground placeholder:text-foreground/5 transition-all focus:border-primary focus:outline-none"
                        required
                        autoFocus
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        disabled={isSubmitting}
                      />
                      <div className="absolute bottom-0 left-0 h-[2px] w-0 bg-primary transition-all duration-500 group-focus-within:w-full" />
                    </div>
                  </div>

                  <div className="flex flex-col gap-6">
                    <label className="flex items-start gap-4 cursor-pointer group max-w-[480px]">
                      <div className="relative flex items-center justify-center mt-1">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={agreeToTerms}
                          onChange={e => setAgreeToTerms(e.target.checked)}
                        />
                        <div className="h-5 w-5 rounded border-2 border-foreground/10 transition-all peer-checked:border-primary peer-checked:bg-primary group-hover:border-foreground/20" />
                        <Check className="absolute h-3.5 w-3.5 text-white opacity-0 transition-opacity peer-checked:opacity-100" />
                      </div>
                      <span className="text-[12px] leading-relaxed text-muted-dark/50">
                        I agree to the <span className="text-primary font-bold hover:underline">Terms of Service</span> and <span className="text-primary font-bold hover:underline">Privacy Policy</span>, including responsible use of AI and full accountability for uploaded content and generated outputs.
                      </span>
                    </label>

                    <button
                      type="submit"
                      className="group relative flex h-[56px] w-full max-w-[220px] items-center justify-center rounded-full bg-foreground/10 text-[13px] font-black uppercase tracking-[0.2em] text-foreground/40 transition-all hover:bg-foreground hover:text-background active:scale-[0.98] disabled:opacity-30 overflow-hidden"
                      disabled={isSubmitting || !agreeToTerms}
                    >
                      <span className="relative z-10">
                        {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Continue"}
                      </span>
                      <div className="absolute inset-0 bg-primary translate-y-full transition-transform duration-300 group-hover:translate-y-0" />
                    </button>
                  </div>
                </form>

                <div className="pt-8 border-t border-foreground/[0.03]">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/20 font-bold mb-4">Or continue with</p>
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    className="flex h-12 w-full max-w-[200px] items-center justify-center gap-4 rounded-2xl border border-foreground/5 bg-surface/30 text-[12px] font-bold text-foreground transition-all hover:bg-surface active:scale-[0.98]"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="currentColor" />
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="currentColor" opacity="0.6" />
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="currentColor" opacity="0.4" />
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="currentColor" opacity="0.8" />
                    </svg>
                    GOOGLE
                  </button>
                </div>
              </motion.div>
            )}

            {step === "login" && (
              <motion.div
                key="login-step"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-12"
              >
                <form onSubmit={handleLogin} className="space-y-12">
                  <div className="space-y-4">
                    <div className="flex justify-between items-end">
                      <label className="text-[28px] font-bold text-foreground/30 tracking-tight">
                        Enter password
                      </label>
                      <button
                        type="button"
                        onClick={() => setStep("forgot-password")}
                        className="text-[12px] font-bold text-primary hover:underline mb-1"
                      >
                        Forgot?
                      </button>
                    </div>
                    <div className="relative group">
                      <input
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        className="w-full bg-transparent border-b-2 border-foreground/10 py-4 text-[36px] font-bold text-foreground placeholder:text-foreground/5 transition-all focus:border-primary focus:outline-none pr-12"
                        required
                        autoFocus
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        disabled={isSubmitting}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-0 bottom-4 text-foreground/20 hover:text-primary transition-colors"
                      >
                        {showPassword ? <EyeOff className="h-6 w-6" /> : <Eye className="h-6 w-6" />}
                      </button>
                      <div className="absolute bottom-0 left-0 h-[2px] w-0 bg-primary transition-all duration-500 group-focus-within:w-full" />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="group relative flex h-[58px] w-full max-w-[220px] items-center justify-center rounded-full bg-foreground/10 text-[13px] font-black uppercase tracking-[0.2em] text-foreground/40 transition-all hover:bg-foreground hover:text-background active:scale-[0.98] disabled:opacity-30 overflow-hidden"
                    disabled={isSubmitting}
                  >
                    <span className="relative z-10">
                      {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign In"}
                    </span>
                    <div className="absolute inset-0 bg-primary translate-y-full transition-transform duration-300 group-hover:translate-y-0" />
                  </button>
                </form>

                <button
                  onClick={() => setStep("email")}
                  className="text-[13px] font-bold text-muted-dark/40 hover:text-foreground transition-colors"
                >
                  ← USE DIFFERENT EMAIL
                </button>
              </motion.div>
            )}

            {step === "signup" && (
              <motion.div
                key="signup-step"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-12"
              >
                <form onSubmit={handleSignup} className="space-y-12">
                  <div className="space-y-12">
                    <div className="space-y-6">
                      <label className="text-[24px] font-bold text-foreground/30 tracking-tight block">
                        Full Name
                      </label>
                      <input
                        type="text"
                        placeholder="John Doe"
                        className="w-full bg-transparent border-b-2 border-foreground/10 py-2 text-[32px] font-bold text-foreground placeholder:text-foreground/5 transition-all focus:border-primary focus:outline-none"
                        required
                        autoFocus
                        value={name}
                        onChange={e => setName(e.target.value)}
                        disabled={isSubmitting}
                      />
                    </div>
                    <div className="space-y-6">
                      <label className="text-[24px] font-bold text-foreground/30 tracking-tight block">
                        Create Password
                      </label>
                      <div className="relative group">
                        <input
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          className="w-full bg-transparent border-b-2 border-foreground/10 py-2 text-[32px] font-bold text-foreground placeholder:text-foreground/5 transition-all focus:border-primary focus:outline-none pr-12"
                          required
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          disabled={isSubmitting}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-0 bottom-2 text-foreground/20 hover:text-primary transition-colors"
                        >
                          {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                        <div className="absolute bottom-0 left-0 h-[2px] w-0 bg-primary transition-all duration-500 group-focus-within:w-full" />
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="group relative flex h-[64px] w-full max-w-[280px] items-center justify-center rounded-full bg-foreground/10 text-[14px] font-black uppercase tracking-[0.2em] text-foreground/40 transition-all hover:bg-foreground hover:text-background active:scale-[0.98] disabled:opacity-30 overflow-hidden"
                    disabled={isSubmitting}
                  >
                    <span className="relative z-10">
                      {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create Account"}
                    </span>
                    <div className="absolute inset-0 bg-primary translate-y-full transition-transform duration-300 group-hover:translate-y-0" />
                  </button>
                </form>

                <button
                  onClick={() => setStep("email")}
                  className="text-[13px] font-bold text-muted-dark/40 hover:text-foreground transition-colors"
                >
                  ← BACK
                </button>
              </motion.div>
            )}

            {step === "forgot-password" && (
              <motion.div
                key="forgot-step"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-12"
              >
                <form onSubmit={handleForgotPassword} className="space-y-16">
                  <div className="space-y-6">
                    <label className="text-[32px] font-bold text-foreground/30 tracking-tight block">
                      Recovery email
                    </label>
                    <input
                      type="email"
                      placeholder="email address"
                      className="w-full bg-transparent border-b-2 border-foreground/10 py-4 text-[42px] font-bold text-foreground placeholder:text-foreground/5 transition-all focus:border-primary focus:outline-none"
                      required
                      autoFocus
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>

                  <button
                    type="submit"
                    className="group relative flex h-[64px] w-full max-w-[320px] items-center justify-center rounded-full bg-foreground/10 text-[14px] font-black uppercase tracking-[0.2em] text-foreground/40 transition-all hover:bg-foreground hover:text-background active:scale-[0.98] disabled:opacity-30 overflow-hidden"
                    disabled={isSubmitting}
                  >
                    <span className="relative z-10">
                      {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send Code"}
                    </span>
                    <div className="absolute inset-0 bg-primary translate-y-full transition-transform duration-300 group-hover:translate-y-0" />
                  </button>
                </form>
              </motion.div>
            )}

            {step === "reset-password" && (
              <motion.div
                key="reset-step"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-12"
              >
                <form onSubmit={handleResetPassword} className="space-y-12">
                  <div className="space-y-12">
                    <div className="space-y-6">
                      <label className="text-[24px] font-bold text-foreground/30 tracking-tight block">
                        6-Digit Code
                      </label>
                      <input
                        type="text"
                        maxLength={6}
                        placeholder="000000"
                        className="w-full bg-transparent border-b-2 border-foreground/10 py-2 text-[48px] font-mono font-bold text-foreground placeholder:text-foreground/5 tracking-[0.5em] transition-all focus:border-primary focus:outline-none"
                        required
                        autoFocus
                        value={otp}
                        onChange={e => setOtp(e.target.value.replace(/[^0-9]/g, ""))}
                        disabled={isSubmitting}
                      />
                    </div>
                    <div className="space-y-6">
                      <label className="text-[24px] font-bold text-foreground/30 tracking-tight block">
                        New Password
                      </label>
                      <div className="relative group">
                        <input
                          type={showPassword ? "text" : "password"}
                          placeholder="••••••••"
                          className="w-full bg-transparent border-b-2 border-foreground/10 py-2 text-[32px] font-bold text-foreground placeholder:text-foreground/5 transition-all focus:border-primary focus:outline-none pr-12"
                          required
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          disabled={isSubmitting}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-0 bottom-2 text-foreground/20 hover:text-primary transition-colors"
                        >
                          {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                        <div className="absolute bottom-0 left-0 h-[2px] w-0 bg-primary transition-all duration-500 group-focus-within:w-full" />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-8">
                    <button
                      type="submit"
                      className="group relative flex h-[64px] w-full max-w-[320px] items-center justify-center rounded-full bg-foreground/10 text-[14px] font-black uppercase tracking-[0.2em] text-foreground/40 transition-all hover:bg-foreground hover:text-background active:scale-[0.98] disabled:opacity-30 overflow-hidden"
                      disabled={isSubmitting}
                    >
                      <span className="relative z-10">
                        {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Update Password"}
                      </span>
                      <div className="absolute inset-0 bg-primary translate-y-full transition-transform duration-300 group-hover:translate-y-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleForgotPassword(null)}
                      disabled={isSubmitting || resendTimer > 0}
                      className="text-[13px] font-bold text-primary hover:underline disabled:text-muted/40 disabled:no-underline text-left"
                    >
                      {resendTimer > 0 ? `RESEND CODE IN ${resendTimer}S` : "RESEND CODE"}
                    </button>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {(error || success) && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mt-12 rounded-xl p-4 text-[14px] font-bold ${error ? "bg-error/10 text-error" : "bg-success/10 text-success"
                  }`}
              >
                {error || (step === "reset-password" && success ? "Password updated!" : (step === "login" ? "Welcome back!" : "Account created!"))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
