import { notFound } from "next/navigation";
import { BriefWorkspace } from "../../features/brief/brief-workspace";
import { LeadHub } from "../../features/leads/lead-hub";
import { ApprovalWorkspace } from "../../features/drafts/approval-workspace";
import { TrackingDashboard } from "../../features/tracking/tracking-dashboard";
import { FollowUpWorkspace } from "../../features/follow-up/follow-up-workspace";
import { TemplatesTab } from "../../features/templates/templates-tab";
import { SequencesTab } from "../../features/sequences/sequences-tab";
import { EscalationsTab } from "../../features/escalations/escalations-tab";
import { ReengagementTab } from "../../features/reengagement/reengagement-tab";
import { ProductsTab } from "../../features/products/products-tab";

const validSections = new Set([
  "brief",
  "leads",
  "drafts",
  "tracking",
  "follow-up",
  "templates",
  "sequences",
  "escalations",
  "reengagement",
  "products",
]);

export default async function OutreachProjectRoutePage({
  params,
}: {
  params: Promise<{ projectId: string; slug?: string[] }>;
}) {
  const { slug } = await params;
  const section = slug?.[0] ?? "brief";

  if (!validSections.has(section)) {
    notFound();
  }

  if (section === "products" && slug && slug.length > 2) {
    notFound();
  }

  switch (section) {
    case "brief":
      return <BriefWorkspace />;
    case "leads":
      return <LeadHub />;
    case "drafts":
      return <ApprovalWorkspace />;
    case "tracking":
      return <TrackingDashboard />;
    case "follow-up":
      return <FollowUpWorkspace />;
    case "templates":
      return <TemplatesTab />;
    case "sequences":
      return <SequencesTab />;
    case "escalations":
      return <EscalationsTab />;
    case "reengagement":
      return <ReengagementTab />;
    case "products":
      return <ProductsTab />;
    default:
      notFound();
  }
}
