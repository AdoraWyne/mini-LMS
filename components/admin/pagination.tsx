import { Button } from "@/components/ui/button";

/** Pure: Previous / Next + "Page X of Y", disabled at the ends and while a page is loading. */
export function Pagination({
  page,
  totalPages,
  loading,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 text-sm">
      <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={loading || page <= 1}>
        Previous
      </Button>
      <span aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page + 1)}
        disabled={loading || page >= totalPages}
      >
        Next
      </Button>
    </nav>
  );
}
