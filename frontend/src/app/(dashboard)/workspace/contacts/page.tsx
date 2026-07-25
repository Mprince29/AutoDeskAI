"use client";
import { toastError, toastSuccess } from "@/lib/friendly-errors";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { apiService, Contact, ContactCreate } from "@/services/api";
import { useRouter } from "next/navigation";
import { toast } from "react-hot-toast";
import {
  Plus, Search, Trash2, Edit3, X, User, Mail, Phone,
  Building2, Briefcase, Tag, StickyNote, Save, Loader2,
} from "lucide-react";

const EMPTY_FORM: ContactCreate = {
  name: "", email: "", nickname: "", phone: "",
  company: "", title: "", notes: "", tags: [],
};

export default function ContactsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [fetching, setFetching] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [form, setForm] = useState<ContactCreate>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    if (!loading && !user) router.push("/auth");
  }, [user, loading, router]);

  const loadContacts = useCallback(async () => {
    if (!user?.email) return;
    setFetching(true);
    try {
      const data = await apiService.getContacts(user.email);
      setContacts(data);
    } catch {
      toastError("Failed to load contacts");
    } finally {
      setFetching(false);
    }
  }, [user?.email]);

  useEffect(() => { if (user) loadContacts(); }, [user, loadContacts]);

  const filtered = contacts.filter(c => {
    const q = searchTerm.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.company ?? "").toLowerCase().includes(q) ||
      (c.phone ?? "").includes(q)
    );
  });

  const openAdd = () => {
    setEditingContact(null);
    setForm(EMPTY_FORM);
    setTagInput("");
    setShowModal(true);
  };

  const openEdit = (c: Contact) => {
    setEditingContact(c);
    setForm({
      name: c.name, email: c.email, nickname: c.nickname ?? "",
      phone: c.phone ?? "", company: c.company ?? "",
      title: c.title ?? "", notes: c.notes ?? "", tags: c.tags ?? [],
    });
    setTagInput("");
    setShowModal(true);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !(form.tags ?? []).includes(t)) {
      setForm(f => ({ ...f, tags: [...(f.tags ?? []), t] }));
    }
    setTagInput("");
  };

  const removeTag = (t: string) =>
    setForm(f => ({ ...f, tags: (f.tags ?? []).filter(x => x !== t) }));

  const handleSave = async () => {
    if (!user?.email || !form.name.trim() || !form.email.trim()) {
      toastError("Name and email are required");
      return;
    }
    setSaving(true);
    try {
      if (editingContact) {
        await apiService.updateContact(user.email, editingContact.id, form);
        toastSuccess("Contact updated");
      } else {
        await apiService.addContact(user.email, form);
        toastSuccess("Contact added");
      }
      setShowModal(false);
      await loadContacts();
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : "Failed to save contact");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Contact) => {
    if (!user?.email) return;
    try {
      await apiService.deleteContact(user.email, c.id);
      setContacts(prev => prev.filter(x => x.id !== c.id));
      toastSuccess("Contact deleted");
    } catch {
      toastError("Failed to delete contact");
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden p-6 gap-6">

        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted/50" />
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search contacts…"
              className="w-full pl-9 pr-4 py-2.5 bg-surface border border-border rounded-xl text-[12px] outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <button onClick={openAdd} className="btn-primary">
            <Plus className="w-3.5 h-3.5" /> New Contact
          </button>
        </div>

        {/* Count */}
        <p className="text-[10px] font-black uppercase tracking-widest text-muted/40">
          {filtered.length} of {contacts.length} contacts
        </p>

        {/* Table */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {fetching ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-primary/40" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 opacity-20">
              <User className="w-12 h-12" />
              <span className="text-[10px] font-black uppercase tracking-widest">No contacts yet</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map(c => (
                <div key={c.id} className="card-os group !p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[14px] font-black text-primary">
                        {c.name[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-[13px] text-foreground/90">{c.name}</p>
                        {c.nickname && <p className="text-[10px] text-muted/50">&quot;{c.nickname}&quot;</p>}
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition">
                      <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-surface-hover text-muted/60 hover:text-foreground transition">
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(c)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted/60 hover:text-red-400 transition">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-[11px] text-muted/70">
                    <div className="flex items-center gap-2"><Mail className="w-3 h-3 shrink-0" /><span className="truncate">{c.email}</span></div>
                    {c.phone && <div className="flex items-center gap-2"><Phone className="w-3 h-3 shrink-0" /><span>{c.phone}</span></div>}
                    {c.company && <div className="flex items-center gap-2"><Building2 className="w-3 h-3 shrink-0" /><span className="truncate">{c.company}</span></div>}
                    {c.title && <div className="flex items-center gap-2"><Briefcase className="w-3 h-3 shrink-0" /><span className="truncate">{c.title}</span></div>}
                  </div>

                  {(c.tags ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(c.tags ?? []).map(t => (
                        <span key={t} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] font-black uppercase tracking-wide">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-5 border-b border-border/50">
              <h2 className="text-[13px] font-black uppercase tracking-widest">
                {editingContact ? "Edit Contact" : "New Contact"}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 rounded-lg hover:bg-surface-hover text-muted/60">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
              {([
                { icon: User, label: "Name *", key: "name", placeholder: "John Doe" },
                { icon: Mail, label: "Email *", key: "email", placeholder: "john@example.com" },
                { icon: User, label: "Nickname", key: "nickname", placeholder: "e.g. boss, bro" },
                { icon: Phone, label: "Phone", key: "phone", placeholder: "+1 555 000 0000" },
                { icon: Building2, label: "Company", key: "company", placeholder: "Acme Corp" },
                { icon: Briefcase, label: "Title", key: "title", placeholder: "CEO" },
              ] as const).map(({ icon: Icon, label, key, placeholder }) => (
                <div key={key}>
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted/60 mb-1 flex items-center gap-1.5">
                    <Icon className="w-3 h-3" />{label}
                  </label>
                  <input
                    value={(form[key] as string) ?? ""}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full px-3 py-2.5 bg-background border border-border rounded-xl text-[12px] outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
              ))}

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-muted/60 mb-1 flex items-center gap-1.5">
                  <StickyNote className="w-3 h-3" />Notes
                </label>
                <textarea
                  rows={3}
                  value={form.notes ?? ""}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Any notes…"
                  className="w-full px-3 py-2.5 bg-background border border-border rounded-xl text-[12px] outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-muted/60 mb-1 flex items-center gap-1.5">
                  <Tag className="w-3 h-3" />Tags
                </label>
                <div className="flex gap-2">
                  <input
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addTag())}
                    placeholder="Add tag + Enter"
                    className="flex-1 px-3 py-2 bg-background border border-border rounded-xl text-[12px] outline-none focus:ring-1 focus:ring-primary/30"
                  />
                  <button onClick={addTag} className="px-3 py-2 bg-primary/10 text-primary rounded-xl text-[11px] font-bold hover:bg-primary/20 transition">Add</button>
                </div>
                {(form.tags ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(form.tags ?? []).map(t => (
                      <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                        {t}
                        <button onClick={() => removeTag(t)}><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-5 border-t border-border/50 flex gap-3">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-xl border border-border text-[11px] font-black uppercase tracking-widest text-muted/70 hover:bg-surface-hover transition">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-[11px] font-black uppercase tracking-widest hover:opacity-90 transition flex items-center justify-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {editingContact ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
