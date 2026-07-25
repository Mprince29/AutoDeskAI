"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Edit3,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { useOutreachStore } from "../../state/store";
import { Badge, FadeUp } from "../../shared/ui-elements";
import type { Product } from "@/services/sales.service";

// ── Product Form ──────────────────────────────────────────────────────────────

interface ProductFormState {
  display_name: string;
  product_description: string;
  sender_name: string;
  sender_title: string;
  cal_link: string;
  pain_points: string;
  social_proof: string;
  icp_job_titles: string;
  icp_industries: string;
  icp_locations: string;
}

const emptyForm = (): ProductFormState => ({
  display_name: "",
  product_description: "",
  sender_name: "",
  sender_title: "",
  cal_link: "",
  pain_points: "",
  social_proof: "",
  icp_job_titles: "",
  icp_industries: "",
  icp_locations: "",
});

const productToForm = (p: Product): ProductFormState => ({
  display_name: p.display_name ?? "",
  product_description: p.product_description ?? "",
  sender_name: p.sender_name ?? "",
  sender_title: p.sender_title ?? "",
  cal_link: p.cal_link ?? "",
  pain_points: (p.pain_points ?? []).join("\n"),
  social_proof: (p.social_proof ?? []).join("\n"),
  icp_job_titles: (p.icp_job_titles ?? []).join(", "),
  icp_industries: (p.icp_industries ?? []).join(", "),
  icp_locations: (p.icp_locations ?? []).join(", "),
});

const formToPayload = (f: ProductFormState) => ({
  display_name: f.display_name.trim(),
  product_description: f.product_description.trim() || undefined,
  sender_name: f.sender_name.trim() || undefined,
  sender_title: f.sender_title.trim() || undefined,
  cal_link: f.cal_link.trim() || undefined,
  pain_points: f.pain_points.split("\n").map((s) => s.trim()).filter(Boolean),
  social_proof: f.social_proof.split("\n").map((s) => s.trim()).filter(Boolean),
  icp_job_titles: f.icp_job_titles.split(",").map((s) => s.trim()).filter(Boolean),
  icp_industries: f.icp_industries.split(",").map((s) => s.trim()).filter(Boolean),
  icp_locations: f.icp_locations.split(",").map((s) => s.trim()).filter(Boolean),
});

// ── Product Modal ─────────────────────────────────────────────────────────────

function ProductModal({
  open,
  product,
  onClose,
  onSave,
}: {
  open: boolean;
  product: Product | null;
  onClose: () => void;
  onSave: (form: ProductFormState) => Promise<void>;
}) {
  const [form, setForm] = useState<ProductFormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (product) setForm(productToForm(product));
    else setForm(emptyForm());
  }, [product, open]);

  const update = (field: keyof ProductFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSave = async () => {
    if (!form.display_name.trim()) return;
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 max-h-[88vh] overflow-y-auto mx-4"
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full bg-surface-hover p-1.5 hover:bg-border transition-colors"
        >
          <X size={14} className="text-muted-dark" />
        </button>

        <div className="mb-5">
          <h2 className="text-base font-bold text-foreground">
            {product ? "Edit product" : "New product"}
          </h2>
          <p className="mt-1 text-xs text-muted-dark">
            Product details power email personalization and ICP matching.
          </p>
        </div>

        <div className="space-y-4">
          <Field label="Product name *">
            <input
              value={form.display_name}
              onChange={update("display_name")}
              placeholder="e.g. eBic AI"
              className={inputCls}
            />
          </Field>

          <Field label="Description">
            <textarea
              value={form.product_description}
              onChange={update("product_description")}
              placeholder="What does the product do? What problem does it solve?"
              rows={3}
              className={textareaCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Sender name">
              <input value={form.sender_name} onChange={update("sender_name")} placeholder="John Smith" className={inputCls} />
            </Field>
            <Field label="Sender title">
              <input value={form.sender_title} onChange={update("sender_title")} placeholder="Head of Growth" className={inputCls} />
            </Field>
          </div>

          <Field label="Cal.com / booking link">
            <input value={form.cal_link} onChange={update("cal_link")} placeholder="https://cal.com/your-link" className={inputCls} />
          </Field>

          <hr className="border-border/60" />

          <Field label="Pain points (one per line)">
            <textarea
              value={form.pain_points}
              onChange={update("pain_points")}
              placeholder={"Manual research takes hours daily, Teams miss timely outreach windows"}
              rows={3}
              className={textareaCls}
            />
          </Field>

          <Field label="Social proof (one per line)">
            <textarea
              value={form.social_proof}
              onChange={update("social_proof")}
              placeholder={"Trusted by 50+ PR agencies, 24× faster signal tracking"}
              rows={3}
              className={textareaCls}
            />
          </Field>

          <hr className="border-border/60" />

          <Field label="ICP job titles (comma-separated)">
            <input
              value={form.icp_job_titles}
              onChange={update("icp_job_titles")}
              placeholder="Founder, VP Communications, Managing Partner"
              className={inputCls}
            />
          </Field>

          <Field label="ICP industries (comma-separated)">
            <input
              value={form.icp_industries}
              onChange={update("icp_industries")}
              placeholder="Public relations, B2B agencies, SaaS"
              className={inputCls}
            />
          </Field>

          <Field label="ICP locations (comma-separated)">
            <input
              value={form.icp_locations}
              onChange={update("icp_locations")}
              placeholder="United States, United Kingdom, India"
              className={inputCls}
            />
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-9 rounded-lg border border-border bg-background px-4 text-xs font-semibold text-foreground hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!form.display_name.trim() || saving}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? "Saving..." : product ? "Save changes" : "Create product"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const inputCls =
  "h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20";
const textareaCls =
  "w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20";

// ── Main ProductsTab ───────────────────────────────────────────────────────────

export function ProductsTab() {
  const products = useOutreachStore((s) => s.productsCatalog);
  const loading = useOutreachStore((s) => s.productsLoading);
  const loadProducts = useOutreachStore((s) => s.loadProducts);
  const projectId = useOutreachStore((s) => s.projectId);
  const projects = useOutreachStore((s) => s.projects);
  const selectedProductKey = useOutreachStore((s) => s.selectedProductKey);
  const setSelectedProductKey = useOutreachStore((s) => s.setSelectedProductKey);
  const createProduct = useOutreachStore((s) => s.createProduct);
  const updateProduct = useOutreachStore((s) => s.updateProduct);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [modalProduct, setModalProduct] = useState<Product | null | "new">(null);

  const load = async () => {
    try {
      await loadProducts();
    } catch {}
  };

  useEffect(() => {
    if (products.length === 0) {
      void load();
    }
  }, [products.length]);

  const currentProject = projects.find((project) => project.id === projectId) ?? null;
  const normalizeValue = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const filteredProducts = currentProject
    ? products.filter((product) => {
        return product.product_key === currentProject.id || normalizeValue(product.display_name) === normalizeValue(currentProject.name);
      })
    : products;

  const visibleProducts = selectedProductKey
    ? filteredProducts.filter((product) => product.product_key === selectedProductKey)
    : filteredProducts;

  useEffect(() => {
    if (!selectedProductKey) return;

    const selectedStillVisible = visibleProducts.some((product) => product.product_key === selectedProductKey);
    if (!selectedStillVisible) {
      setSelectedProductKey(null);
    }
  }, [selectedProductKey, setSelectedProductKey, visibleProducts]);

  useEffect(() => {
    if (selectedProductKey) {
      setExpandedKey(selectedProductKey);
    }
  }, [selectedProductKey]);

  const handleSave = async (form: ProductFormState) => {
    const payload = formToPayload(form);
    if (modalProduct && modalProduct !== "new") {
      await updateProduct(modalProduct.product_key, payload);
    } else {
      await createProduct(payload);
    }
  };

  const chips = (values?: string[]) =>
    values?.filter(Boolean).map((v) => (
      <span key={v} className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-dark">
        {v}
      </span>
    ));

  return (
    <main className="min-w-0 flex-1 p-4 bg-background text-foreground">
      <div className="w-full">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[12px] font-bold text-muted-dark uppercase tracking-wider">
              {selectedProductKey ? currentProject?.name ?? "Selected" : currentProject?.name ?? "Global"}
            </p>
            <h1 className="mt-1 text-[22px] font-extrabold tracking-tight text-foreground">
              {selectedProductKey
                ? visibleProducts[0]?.display_name ?? "Product"
                : currentProject
                  ? `${currentProject.name} Products`
                  : "Products"}
            </h1>
            <p className="mt-1 text-xs text-muted-dark font-medium">
              {selectedProductKey
                ? "Showing the selected product and its ICP details."
                : "Define your products and ICPs to power personalized outreach."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-bold text-muted-dark hover:bg-surface-hover disabled:opacity-50 transition-all"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            </button>
            <button
              onClick={() => setModalProduct("new")}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-hover active:scale-95 transition-all "
            >
              <Plus size={14} />
              New product
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={22} className="animate-spin text-primary" />
            </div>
          ) : visibleProducts.length === 0 ? (
            <FadeUp>
              <div className="rounded-xl border border-dashed border-border p-12 text-center bg-surface/50">
                <Package size={28} className="mx-auto mb-3 text-muted-dark/50" />
                <p className="text-sm font-bold text-foreground">
                  {selectedProductKey ? "Selected product not found" : "No products yet"}
                </p>
                <p className="mt-1 text-xs text-muted-dark">
                  {selectedProductKey
                    ? "Pick another product from the sidebar or refresh the catalog."
                    : "Create a product to define your ICP and power email personalization."}
                </p>
                <button
                  onClick={() => setModalProduct("new")}
                  className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-hover"
                >
                  <Plus size={13} />
                  New product
                </button>
              </div>
            </FadeUp>
          ) : (
            visibleProducts.map((p, i) => (
              <motion.div
                key={p.product_key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: i * 0.04 }}
              >
                <div className="rounded-xl border border-border bg-surface ">
                  <div className="flex items-center gap-3 p-4">
                    <button
                      onClick={() => setExpandedKey(expandedKey === p.product_key ? null : p.product_key)}
                      className="rounded-md p-0.5 text-muted-dark hover:text-foreground transition-colors"
                    >
                      {expandedKey === p.product_key ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">{p.display_name}</p>
                      <p className="text-[11px] text-muted-dark truncate">{p.product_description?.slice(0, 80)}</p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {p.icp_job_titles?.length ? (
                        <Badge tone="grey">{p.icp_job_titles.length} ICP roles</Badge>
                      ) : null}
                      <button
                        onClick={() => setModalProduct(p)}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[11px] font-semibold text-muted-dark hover:bg-surface-hover hover:text-foreground transition-colors"
                      >
                        <Edit3 size={11} />
                        Edit
                      </button>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {expandedKey === p.product_key && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden border-t border-border"
                      >
                        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
                          {p.sender_name && (
                            <DetailBlock label="Sender">
                              <p className="text-xs text-foreground">{p.sender_name}, {p.sender_title}</p>
                            </DetailBlock>
                          )}
                          {p.cal_link && (
                            <DetailBlock label="Booking link">
                              <a href={p.cal_link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline break-all">
                                {p.cal_link}
                              </a>
                            </DetailBlock>
                          )}
                          {p.pain_points?.length ? (
                            <DetailBlock label="Pain points" className="col-span-full">
                              <ul className="space-y-1">
                                {p.pain_points.map((pp, pi) => (
                                  <li key={pi} className="flex items-start gap-1.5 text-xs text-foreground">
                                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary/60" />
                                    {pp}
                                  </li>
                                ))}
                              </ul>
                            </DetailBlock>
                          ) : null}
                          {p.social_proof?.length ? (
                            <DetailBlock label="Social proof" className="col-span-full">
                              <ul className="space-y-1">
                                {p.social_proof.map((sp, si) => (
                                  <li key={si} className="flex items-start gap-1.5 text-xs text-foreground">
                                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-success/60" />
                                    {sp}
                                  </li>
                                ))}
                              </ul>
                            </DetailBlock>
                          ) : null}
                          {(p.icp_job_titles?.length || p.icp_industries?.length || p.icp_locations?.length) ? (
                            <DetailBlock label="ICP targeting" className="col-span-full">
                              <div className="space-y-2">
                                {p.icp_job_titles?.length ? (
                                  <div>
                                    <p className="mb-1 text-[10px] font-bold text-muted-dark uppercase tracking-wider">Roles</p>
                                    <div className="flex flex-wrap gap-1">{chips(p.icp_job_titles)}</div>
                                  </div>
                                ) : null}
                                {p.icp_industries?.length ? (
                                  <div>
                                    <p className="mb-1 text-[10px] font-bold text-muted-dark uppercase tracking-wider">Industries</p>
                                    <div className="flex flex-wrap gap-1">{chips(p.icp_industries)}</div>
                                  </div>
                                ) : null}
                                {p.icp_locations?.length ? (
                                  <div>
                                    <p className="mb-1 text-[10px] font-bold text-muted-dark uppercase tracking-wider">Locations</p>
                                    <div className="flex flex-wrap gap-1">{chips(p.icp_locations)}</div>
                                  </div>
                                ) : null}
                              </div>
                            </DetailBlock>
                          ) : null}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>

      <AnimatePresence>
        {modalProduct !== null && (
          <ProductModal
            open={!!modalProduct}
            product={modalProduct === "new" ? null : modalProduct}
            onClose={() => setModalProduct(null)}
            onSave={handleSave}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

function DetailBlock({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-dark">{label}</p>
      {children}
    </div>
  );
}
