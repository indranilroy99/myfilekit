"use client";

import { Pagination } from "@ark-ui/react/pagination";
import { ChevronLeft, ChevronRight } from "lucide-react";

type MyFileKitPaginationProps = {
  count?: number;
  pageSize?: number;
  page?: number;
  siblingCount?: number;
  onPageChange?: (page: number) => void;
  className?: string;
};

const navButtonClass =
  "pagination-nav-button inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-black shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--ring)]/30 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-40";

const iconButtonClass =
  "pagination-icon-button inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--ring)]/30 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-40";

const pageItemClass =
  "pagination-page-button inline-flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-sm font-black transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--ring)]/30 data-selected:shadow-sm";

export default function Basic({
  count = 100,
  pageSize = 10,
  page,
  siblingCount = 2,
  onPageChange,
  className = "",
}: MyFileKitPaginationProps) {
  return (
    <Pagination.Root
      count={count}
      page={page}
      pageSize={pageSize}
      siblingCount={siblingCount}
      onPageChange={(details) => onPageChange?.(details.page)}
      className={`flex w-full items-center justify-between gap-3 ${className}`}
    >
      <Pagination.PrevTrigger className={navButtonClass}>
        <ChevronLeft className="h-4 w-4" />
        Previous
      </Pagination.PrevTrigger>
      <Pagination.NextTrigger className={navButtonClass}>
        Next
        <ChevronRight className="h-4 w-4" />
      </Pagination.NextTrigger>
    </Pagination.Root>
  );
}

export function NumberedPagination({
  count = 100,
  pageSize = 10,
  page,
  siblingCount = 1,
  onPageChange,
  className = "",
}: MyFileKitPaginationProps) {
  if (count <= pageSize) return null;

  return (
    <Pagination.Root
      count={count}
      page={page}
      pageSize={pageSize}
      siblingCount={siblingCount}
      onPageChange={(details) => onPageChange?.(details.page)}
      className={`flex flex-wrap items-center justify-center gap-1 ${className}`}
    >
      <Pagination.PrevTrigger className={iconButtonClass} aria-label="Previous page">
        <ChevronLeft className="h-4 w-4" />
      </Pagination.PrevTrigger>

      <Pagination.Context>
        {(pagination) =>
          pagination.pages.map((item, index) =>
            item.type === "page" ? (
              <Pagination.Item key={`${item.value}-${index}`} {...item} className={pageItemClass}>
                {item.value}
              </Pagination.Item>
            ) : (
              <Pagination.Ellipsis key={`ellipsis-${index}`} index={index} className="pagination-ellipsis inline-flex h-10 w-10 items-center justify-center">
                &#8230;
              </Pagination.Ellipsis>
            )
          )
        }
      </Pagination.Context>

      <Pagination.NextTrigger className={iconButtonClass} aria-label="Next page">
        <ChevronRight className="h-4 w-4" />
      </Pagination.NextTrigger>
    </Pagination.Root>
  );
}
