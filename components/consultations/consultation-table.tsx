import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ConsultationDto } from "@/lib/api/mappers";
import { StatusBadge } from "./status-badge";

/**
 * Pure: given the same props, renders the same table. No fetching or mutations here:
 * the page passes `renderActions` (the dashboard's per-row controls). Without it there's
 * no Actions column, so a read-only view can reuse this table.
 */
export function ConsultationTable({
  consultations,
  now,
  renderActions,
}: {
  consultations: ConsultationDto[];
  now: Date;
  renderActions?: (consultation: ConsultationDto) => ReactNode;
}) {
  return (
    // shadcn's <Table> already wraps itself in an overflow-x-auto container; min-w makes
    // narrow screens scroll sideways instead of squashing the columns.
    <Table className="min-w-[640px]">
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Status</TableHead>
          {renderActions && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {consultations.map((consultation) => (
          // Key by id, never the index: rescheduling re-sorts the list, and an index key would
          // move a row's state (open dialog, pending request) onto a different booking.
          <TableRow key={consultation.id}>
            {/* Shown in the viewer's own timezone (decision 10). */}
            <TableCell className="whitespace-nowrap">
              {new Date(consultation.scheduledAt).toLocaleString()}
            </TableCell>
            <TableCell className="whitespace-nowrap">
              {consultation.firstName} {consultation.lastName}
            </TableCell>
            <TableCell className="max-w-xs">
              {/* Up to 1000 characters: clamp to 2 lines, full text on hover. */}
              <p className="line-clamp-2" title={consultation.reason}>
                {consultation.reason}
              </p>
            </TableCell>
            <TableCell>
              <StatusBadge consultation={consultation} now={now} />
            </TableCell>
            {renderActions && <TableCell className="text-right">{renderActions(consultation)}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
