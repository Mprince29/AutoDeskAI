"use client";

import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  FileText,
  GitBranch,
  Inbox,
  Mail,
  MessageSquareReply,
  Package,
  PanelLeftOpen,
  PenLine,
  Plus,
  RefreshCcw,
  Send,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import type { Product as CatalogProduct } from "@/services/sales.service";
import type { Project as SidebarProject } from "../state/types";
import { useOutreachStore } from "../state/store";

const projectNav = [
  { id: "products", label: "Product Details", icon: Package },
  { id: "brief", label: "Brief", icon: PenLine },
  { id: "leads", label: "Leads", icon: Inbox },
  { id: "drafts", label: "Draft & Validate", icon: Send },
  { id: "tracking", label: "Tracking", icon: BarChart3 },
  { id: "follow-up", label: "Follow Up", icon: MessageSquareReply },
];

const globalNav = [
  { id: "templates", label: "Templates", icon: FileText },
  { id: "sequences", label: "Sequences", icon: GitBranch },
  { id: "escalations", label: "Escalations", icon: AlertTriangle },
  { id: "reengagement", label: "Re-engagement", icon: RefreshCcw },
];

const easing = [0.22, 1, 0.36, 1] as const;

const normalizeSidebarValue = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const productBelongsToProject = (project: SidebarProject, catalogProduct: CatalogProduct) => {
  return (
    catalogProduct.product_key === project.id ||
    normalizeSidebarValue(catalogProduct.display_name) === normalizeSidebarValue(project.name)
  );
};

export function OutreachShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [textVisible, setTextVisible] = useState(true);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [product, setProduct] = useState("");
  const [regionFocus, setRegionFocus] = useState("");
  const [isPendingCreate, setIsPendingCreate] = useState(false);

  const { user, preferences } = useAuth();

  const projects = useOutreachStore((state) => state.projects);
  const projectId = useOutreachStore((state) => state.projectId);
  const googleWorkspace = useOutreachStore((state) => state.googleWorkspace);
  const productsCatalog = useOutreachStore((state) => state.productsCatalog);
  const selectedProductKey = useOutreachStore((state) => state.selectedProductKey);

  const setActiveTab = useOutreachStore((state) => state.setActiveTab);
  const setGoogleWorkspaceService = useOutreachStore((state) => state.setGoogleWorkspaceService);
  const setSelectedProductKey = useOutreachStore((state) => state.setSelectedProductKey);
  const hydrateWorkspace = useOutreachStore((state) => state.hydrateWorkspace);
  const resetDemo = useOutreachStore((state) => state.resetDemo);
  const selectProject = useOutreachStore((state) => state.selectProject);
  const createProduct = useOutreachStore((state) => state.createProduct);
  const addAction = useOutreachStore((state) => state.addAction);
  const setUserEmail = useOutreachStore((state) => state.setUserEmail);

  const pathParts = pathname.split("/").filter(Boolean);
  const routeProjectId = pathParts[2] ?? "";
  const currentSection = pathParts[3] ?? "brief";
  const routeProductKey = currentSection === "products" ? pathParts[4] ?? null : null;

  const activeProject = projects.find((projectItem) => projectItem.id === routeProjectId || projectItem.id === projectId) ?? projects[0];

  useEffect(() => {
    if (collapsed) {
      setTextVisible(false);
    } else {
      const t = setTimeout(() => setTextVisible(true), 100);
      return () => clearTimeout(t);
    }
  }, [collapsed]);

  useEffect(() => {
    if (!user?.email) return;
    setUserEmail(user.email);
    void hydrateWorkspace().catch(() => undefined);
  }, [hydrateWorkspace, setUserEmail, user?.email]);

  useEffect(() => {
    if (!routeProjectId || projects.length === 0) return;
    if (projectId === routeProjectId) {
      setExpandedProjectId(routeProjectId);
      return;
    }
    void selectProject(routeProjectId).catch(() => undefined);
    setExpandedProjectId(routeProjectId);
  }, [projectId, projects.length, routeProjectId, selectProject]);

  useEffect(() => {
    if (expandedProjectId && projects.some((projectItem) => projectItem.id === expandedProjectId)) {
      return;
    }

    const defaultExpandedProjectId = routeProjectId || activeProject?.id || projects[0]?.id || null;
    if (defaultExpandedProjectId) {
      setExpandedProjectId(defaultExpandedProjectId);
    }
  }, [activeProject?.id, expandedProjectId, projects, routeProjectId]);

  useEffect(() => {
    setSelectedProductKey(routeProductKey);
  }, [routeProductKey, setSelectedProductKey]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    setActiveTab(currentSection);
  }, [currentSection, setActiveTab]);

  useEffect(() => {
    const gmailConnected = Boolean(preferences?.gmail_connected);
    const calendarConnected = Boolean(preferences?.calendar_connected);
    const workspaceConnected = gmailConnected || calendarConnected;

    if (googleWorkspace.gmail !== gmailConnected) {
      void setGoogleWorkspaceService("gmail", gmailConnected);
    }
    if (googleWorkspace.calendar !== calendarConnected) {
      void setGoogleWorkspaceService("calendar", calendarConnected);
    }
    if (googleWorkspace.drive !== workspaceConnected) {
      void setGoogleWorkspaceService("drive", workspaceConnected);
    }
    if (googleWorkspace.sheets !== workspaceConnected) {
      void setGoogleWorkspaceService("sheets", workspaceConnected);
    }
  }, [
    googleWorkspace.calendar,
    googleWorkspace.drive,
    googleWorkspace.gmail,
    googleWorkspace.sheets,
    preferences?.calendar_connected,
    preferences?.gmail_connected,
    setGoogleWorkspaceService,
  ]);

  const currentProjectBasePath = activeProject ? `/playground/outreach-v2/${activeProject.id}` : "/playground/outreach-v2";
  const canCreate = projectName.trim().length > 0;
  const currentSectionLabel = [...projectNav, ...globalNav].find((item) => item.id === currentSection)?.label ?? "Brief";

  const handleCreateProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectName.trim()) return;

    try {
      setIsPendingCreate(true);
      const createdProduct = await createProduct({
        display_name: projectName.trim(),
        product_description: product.trim() || undefined,
        icp_locations: regionFocus
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      });
      setCreating(false);
      setProjectName("");
      setProduct("");
      setRegionFocus("");
      addAction(`Created product "${createdProduct.display_name}"`);

      const nextProjects = useOutreachStore.getState().projects;
      const matchedProject =
        nextProjects.find((projectItem) => productBelongsToProject(projectItem, createdProduct)) ??
        activeProject ??
        nextProjects[0];

      if (matchedProject) {
        setExpandedProjectId(matchedProject.id);
        router.push(`/playground/outreach-v2/${matchedProject.id}/products/${createdProduct.product_key}`);
      } else {
        router.push("/playground/outreach-v2");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsPendingCreate(false);
    }
  };

  const navigateTo = (path: string, productKey?: string | null) => {
    setSelectedProductKey(productKey ?? null);
    setMobileNavOpen(false);
    router.push(path);
  };

  const renderSidebarNavigation = ({ mobile = false }: { mobile?: boolean } = {}) => (
    <div className={cn("flex-1 space-y-5 overflow-y-auto p-3", mobile && "pb-6")}>
      <div className="space-y-2">
        <div className="flex items-center justify-between px-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-dark">Product</p>
          <button
            onClick={() => setCreating((value) => !value)}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-foreground"
            aria-label={creating ? "Cancel product creation" : "Create product"}
          >
            {creating ? <X size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
          </button>
        </div>

        {creating && (!collapsed || mobile) && (
          <motion.form
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: easing }}
            className="space-y-2.5 rounded-lg border border-border bg-background p-2.5 shadow-sm"
            onSubmit={handleCreateProject}
          >
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted" htmlFor="new-project-name">
                Product Name
              </label>
              <input
                id="new-project-name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="e.g. Fintech founders"
                className="mt-1 min-h-8 w-full rounded-md border border-border bg-surface px-2.5 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted" htmlFor="new-project-product">
                Product Offer
              </label>
              <input
                id="new-project-product"
                value={product}
                onChange={(event) => setProduct(event.target.value)}
                placeholder="Product or offer description"
                className="mt-1 min-h-8 w-full rounded-md border border-border bg-surface px-2.5 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted" htmlFor="new-project-region">
                Audience / ICP
              </label>
              <input
                id="new-project-region"
                value={regionFocus}
                onChange={(event) => setRegionFocus(event.target.value)}
                placeholder="Region or audience profile"
                className="mt-1 min-h-8 w-full rounded-md border border-border bg-surface px-2.5 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <button
              type="submit"
              disabled={!canCreate || isPendingCreate}
              className="min-h-8 w-full rounded-md bg-primary text-xs font-bold text-white transition hover:bg-primary-hover disabled:opacity-50 active:scale-95"
            >
              {isPendingCreate ? "Creating..." : "Create Product"}
            </button>
          </motion.form>
        )}

        <div className="space-y-1">
          {projects.map((projectItem) => {
            const isOpen = expandedProjectId === projectItem.id;
            const isCurrent = projectItem.id === routeProjectId;
            const matchedProducts = productsCatalog
              .filter((catalogProduct) => productBelongsToProject(projectItem, catalogProduct))
              .sort((left, right) => left.display_name.localeCompare(right.display_name));
            const showNestedProducts = matchedProducts.length > 1;

            return (
              <div key={projectItem.id} className="space-y-0.5">
                <button
                  onClick={() => {
                    setExpandedProjectId(isOpen ? null : projectItem.id);
                    if (!isCurrent) {
                      navigateTo(`/playground/outreach-v2/${projectItem.id}/brief`);
                    }
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-hover",
                    isCurrent && "bg-surface-hover text-foreground font-semibold"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold">{projectItem.name}</span>
                    <span className="block truncate text-[11px] font-medium text-muted">{projectItem.regionFocus}</span>
                  </div>
                  <ChevronDown
                    size={13}
                    className={cn("ml-2 shrink-0 text-muted transition-transform duration-200", isOpen && "rotate-180")}
                    aria-hidden
                  />
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: easing }}
                      className="overflow-hidden"
                    >
                      <div className="ml-3 mt-1 space-y-1 border-l border-border pl-2 pb-1.5">
                        {showNestedProducts
                          ? matchedProducts.map((catalogProduct) => (
                              <button
                                key={catalogProduct.product_key}
                                onClick={() => {
                                  navigateTo(
                                    `/playground/outreach-v2/${projectItem.id}/products/${catalogProduct.product_key}`,
                                    catalogProduct.product_key
                                  );
                                }}
                                className={cn(
                                  "flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-[12px] text-muted transition hover:bg-surface-hover hover:text-foreground",
                                  currentSection === "products" &&
                                    selectedProductKey === catalogProduct.product_key &&
                                    "bg-surface-hover text-foreground font-semibold ring-1 ring-primary/20"
                                )}
                              >
                                <Package size={13} aria-hidden />
                                <span className="truncate">{catalogProduct.display_name}</span>
                              </button>
                            ))
                          : null}

                        {projectNav.map((item) => {
                          const Icon = item.icon;
                          const targetProductKey = matchedProducts[0]?.product_key ?? projectItem.id;
                          const active = item.id === "products"
                            ? currentSection === "products" && isCurrent && (selectedProductKey === targetProductKey || routeProductKey === targetProductKey)
                            : currentSection === item.id && isCurrent;
                          return (
                            <button
                              key={item.id}
                              onClick={() => {
                                if (item.id === "products") {
                                  navigateTo(`/playground/outreach-v2/${projectItem.id}/products/${targetProductKey}`, targetProductKey);
                                  return;
                                }
                                navigateTo(`/playground/outreach-v2/${projectItem.id}/${item.id}`);
                              }}
                              className={cn(
                                "flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-[12px] text-muted transition hover:bg-surface-hover hover:text-foreground",
                                active && "bg-surface-hover text-foreground font-bold"
                              )}
                            >
                              <Icon size={13} aria-hidden />
                              <span>{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-1">
        <p className="mb-1.5 px-2.5 text-[11px] font-bold uppercase tracking-wider text-muted-dark">Global</p>
        {globalNav.map((item) => {
          const Icon = item.icon;
          const active = currentSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                if (!activeProject?.id) return;
                navigateTo(`/playground/outreach-v2/${activeProject.id}/${item.id}`);
              }}
              disabled={!activeProject?.id}
              className={cn(
                "flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12px] text-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50",
                active && "bg-surface-hover text-foreground font-bold"
              )}
            >
              <Icon size={14} aria-hidden />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      <aside
        className={cn(
          "hidden shrink-0 border-r border-border/40 bg-surface/20 transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] lg:block",
          collapsed ? "w-[56px]" : "w-[248px]"
        )}
      >
        <div className="flex h-full flex-col overflow-hidden">
          <div
            className={cn(
              "flex h-12 items-center border-b border-border/40 px-3",
              collapsed ? "justify-center" : "justify-between"
            )}
          >
            {!collapsed ? (
              <>
                <Link href="/playground" className="flex min-w-0 items-center gap-2">
                  <Mail className="size-5 shrink-0 text-primary" />
                  <AnimatePresence initial={false}>
                    {textVisible && (
                      <motion.div
                        key="logo-text"
                        className="min-w-0"
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -6 }}
                        transition={{ duration: 0.18, ease: easing }}
                      >
                        <p className="text-[15px] font-bold tracking-tight">Outreach Intelligence</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Link>
                <button
                  onClick={() => setCollapsed((value) => !value)}
                  aria-label="Collapse sidebar"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-foreground"
                >
                  <ChevronLeft size={15} aria-hidden />
                </button>
              </>
            ) : (
              <button
                onClick={() => setCollapsed((value) => !value)}
                aria-label="Expand sidebar"
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-surface-hover hover:text-foreground"
              >
                <ChevronLeft size={15} className="rotate-180" aria-hidden />
              </button>
            )}
          </div>
          {renderSidebarNavigation()}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="border-b border-border/40 bg-background/95 px-4 py-2 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-bold uppercase tracking-[0.18em] text-muted-dark">
                {activeProject?.name ?? "Outreach"}
              </p>
              <p className="truncate text-sm font-semibold text-foreground">{currentSectionLabel}</p>
            </div>
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open workspace navigation"
              className="inline-flex shrink-0 items-center justify-center rounded-lg text-muted transition hover:text-primary"
            >
              <PanelLeftOpen size={20} aria-hidden />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-background/40">
          {children}
        </div>
      </div>

      <AnimatePresence>
        {mobileNavOpen && (
          <>
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-40 bg-black/45 lg:hidden"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.24, ease: easing }}
              className="fixed inset-y-0 left-0 z-50 flex w-full flex-col border-r border-border bg-background shadow-2xl lg:hidden"
            >
              <div className="flex h-14 items-center justify-between border-b border-border/40 px-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">Outreach Navigation</p>
                  <p className="truncate text-[11px] text-muted-dark">Projects, products, and workflow pages</p>
                </div>
                <button
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close navigation"
                  className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground"
                >
                  <X size={16} aria-hidden />
                </button>
              </div>
              {renderSidebarNavigation({ mobile: true })}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
