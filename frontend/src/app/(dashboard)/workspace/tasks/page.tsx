"use client";
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import {
  CheckCircle2, Search, Clock, RefreshCw,
  Loader2, MoreVertical, FilePlus2, Sparkles, Circle, CheckCircle, Pencil
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { SiGoogletasks } from "react-icons/si";

import WorkspaceSkeleton from "@/components/shared/WorkspaceSkeleton";

export default function TasksPage() {
  const { user, loading, preferences } = useAuth();
  const router = useRouter();
  const { tasks, fetchTasks, tasksLoaded, fetchingTasks, tasksError, updateTask } = useWorkspaceStore();

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const notesRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (notesRef.current) {
      notesRef.current.style.height = 'auto';
      notesRef.current.style.height = `${notesRef.current.scrollHeight}px`;
    }
  }, [editNotes, editingTaskId]);

  const handleToggleStatus = (task: any) => {
    if (!user?.email) return;
    const newStatus = task.status === 'completed' ? 'needsAction' : 'completed';
    updateTask(user.email, task.id, { status: newStatus });
  };

  const startEditing = (task: any) => {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditNotes(task.notes || "");
  };

  const saveEdit = (task: any) => {
    if (!user?.email) return;
    updateTask(user.email, task.id, { title: editTitle, notes: editNotes });
    setEditingTaskId(null);
  };

  const cancelEdit = () => {
    setEditingTaskId(null);
  };

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  useEffect(() => {
    if (!loading && !user) router.push("/auth");
  }, [user, loading, router]);

  const loadDocs = useCallback(async () => {
    if (!user?.email || !preferences?.gmail_connected) return;
    await fetchTasks(user.email);
  }, [user?.email, preferences?.gmail_connected, fetchTasks]);

  useEffect(() => {
    if (user && preferences?.gmail_connected && !tasksLoaded) {
      loadDocs();
    }
  }, [user, preferences?.gmail_connected, loadDocs, tasksLoaded]);

  const filteredTasks = useMemo(() => {
    return tasks.filter(task =>
      task.title.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [tasks, searchTerm]);

  const totalPages = Math.ceil(filteredTasks.length / itemsPerPage);
  const paginatedTasks = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredTasks.slice(start, start + itemsPerPage);
  }, [filteredTasks, currentPage]);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-background/50 backdrop-blur-xl border-b border-border/40 shrink-0 gap-3">
        <div className="flex items-center justify-between sm:justify-start gap-4 flex-1 sm:flex-none">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-blue-600/10 flex items-center justify-center border border-blue-600/20">
              <SiGoogletasks className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-sm font-black text-foreground tracking-tight uppercase leading-none">Smart Tasks</h1>
              <p className="text-[10px] text-muted mt-1 font-medium">Your AI-optimized Google Tasks</p>
            </div>
          </div>
          <button
            onClick={loadDocs}
            className="sm:hidden p-2 rounded-xl text-muted hover:text-foreground hover:bg-surface/60 border border-border/10 transition-all"
            title="Refresh"
          >
            <RefreshCw className={cn("w-4 h-4", fetchingTasks && "animate-spin")} />
          </button>
        </div>

        <div className="flex-1 sm:max-w-xl sm:px-8">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted group-focus-within:text-primary transition-colors" />
            <input
              type="text"
              placeholder="Search your tasks..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full bg-surface/50 border border-border/40 hover:border-border-light focus:border-primary/40 focus:bg-background rounded-2xl pl-10 pr-4 py-2 text-sm outline-none transition-all"
            />
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-3">
          <button
            onClick={loadDocs}
            className="p-2 rounded-xl text-muted hover:text-foreground hover:bg-surface/60 border border-border/10 transition-all"
            title="Refresh"
          >
            <RefreshCw className={cn("w-4 h-4", fetchingTasks && "animate-spin")} />
          </button>
        </div>
      </header>

      {loading || !preferences || (fetchingTasks && !tasksLoaded) ? <WorkspaceSkeleton /> : <main className="flex-1 overflow-y-auto custom-scrollbar bg-surface/10 flex flex-col">
        {!preferences?.gmail_connected ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-6 border border-primary/20">
              <CheckCircle2 className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-xl font-black text-foreground mb-3">Connect Google Tasks</h2>
            <p className="text-muted text-sm mb-8">Access and manage your tasks directly within AutoDeskAI.</p>
            <button className="btn-primary px-8 py-3 rounded-2xl">Enable Workspace</button>
          </div>
        ) : tasksError ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto gap-4">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center border border-red-500/20">
              <CheckCircle2 className="w-5 h-5 text-red-500" />
            </div>
            <h2 className="text-sm font-black text-foreground uppercase tracking-tight">Failed to load tasks</h2>
            <p className="text-[11px] text-muted">{tasksError.includes('accessNotConfigured') || tasksError.includes('disabled') ? 'The Google Tasks API is not enabled in your Google Cloud project. Enable it at console.cloud.google.com → APIs & Services → Google Tasks API.' : tasksError}</p>
            <button onClick={loadDocs} className="btn-primary px-6 py-2 rounded-xl text-xs">Retry</button>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-30 grayscale">
            <FilePlus2 className="w-16 h-16 mb-4" />
            <p className="text-sm font-black uppercase tracking-widest">No tasks found</p>
          </div>
        ) : (
          <div className="flex flex-col flex-1 bg-background overflow-hidden">
            <div className="flex-1 divide-y divide-border/20 overflow-y-auto">
              {paginatedTasks.map((task) => (
                <div
                  key={task.id}
                  className="p-4 hover:bg-surface/40 transition-colors cursor-default group"
                >
                  {editingTaskId === task.id ? (
                    <div className="flex flex-col gap-3 w-full">
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full bg-surface/50 border border-border/40 focus:border-primary/40 focus:bg-background rounded-lg px-3 py-2 text-[13px] font-semibold outline-none transition-all"
                        autoFocus
                      />
                      <textarea
                        ref={notesRef}
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        rows={1}
                        className="w-full bg-surface/50 border border-border/40 focus:border-primary/40 focus:bg-background rounded-lg px-3 py-2 text-[11px] outline-none transition-all resize-none min-h-[60px] overflow-hidden"
                        placeholder="Add notes..."
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={cancelEdit} className="px-3 py-1.5 rounded-lg hover:bg-surface text-muted hover:text-foreground text-[11px] font-bold transition-all">Cancel</button>
                        <button onClick={() => saveEdit(task)} className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary text-white text-[11px] font-bold transition-all border border-primary">Save Changes</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <button onClick={() => handleToggleStatus(task)} className="flex items-center justify-center hover:scale-110 transition-transform">
                            {task.status === 'completed' ? <CheckCircle className="w-5 h-5 text-blue-600" /> : <Circle className="w-5 h-5 text-muted hover:text-blue-600 transition-colors" />}
                          </button>
                          <div className="flex flex-col gap-0 cursor-text" onClick={() => startEditing(task)}>
                            <span className={cn("text-[13px] font-semibold text-foreground hover:text-primary transition-colors", task.status === 'completed' && "line-through opacity-50")}>{task.title}</span>
                            <span className="text-[11px] text-muted font-medium">
                              {task.updated ? formatDistanceToNow(new Date(task.updated), { addSuffix: true }) : 'Recently updated'}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEditing(task)} className="p-2 rounded-xl text-muted hover:text-foreground hover:bg-surface transition-all" title="Edit Task">
                            <Pencil className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      {task.notes && (
                        <div className="ml-8 mt-2 text-[11px] text-muted line-clamp-2 cursor-text" onClick={() => startEditing(task)}>
                          {task.notes}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="px-6 py-4 border-t border-border/40 flex items-center justify-between bg-surface/10">
                <span className="text-[11px] text-muted font-medium uppercase tracking-tight">
                  Page <span className="text-foreground font-black">{currentPage}</span> of <span className="text-foreground font-black">{totalPages}</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-hover disabled:opacity-30 text-[10px] font-black uppercase tracking-widest transition-all border border-border/40"
                  >
                    Previous
                  </button>
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-hover disabled:opacity-30 text-[10px] font-black uppercase tracking-widest transition-all border border-border/40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>}
    </div>
  );
}
