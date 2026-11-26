import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ConsultationDto } from "@/lib/api/mappers";
import { StatusBadge } from "./status-badge";

/**
 * Pure: given the same consultations and `now`, renders the same table. No fetching here.
 * The Actions column is filled in 6c.
 */
export function ConsultationTable({
  consultations,
  now,
}: {
  consultations: ConsultationDto[];
  now: Date;
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
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {consultations.map((consultation) => (
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
            <TableCell className="text-right">{/* 6c: row actions */}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
