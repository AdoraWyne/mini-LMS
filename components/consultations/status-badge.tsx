import { Badge } from "@/components/ui/badge";
import type { ConsultationDto } from "@/lib/api/mappers";
import { statusLabel, type StatusLabel } from "@/lib/consultations/display";

const VARIANT: Record<StatusLabel, "default" | "secondary" | "destructive" | "outline"> = {
  Scheduled: "default",
  "Awaiting completion": "outline",
  Completed: "secondary",
  Cancelled: "destructive",
};

/** Pure: the label comes from statusLabel() (decisions 6c, 6d), the badge only styles it. */
export function StatusBadge({
  consultation,
  now,
}: {
  consultation: Pick<ConsultationDto, "status" | "scheduledAt">;
  now: Date;
}) {
  const label = statusLabel(consultation, now);
  return <Badge variant={VARIANT[label]}>{label}</Badge>;
}
