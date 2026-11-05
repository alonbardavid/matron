import { useEffect, type ReactNode } from "react";
import { Group, Pagination, Table, Text, UnstyledButton } from "@mantine/core";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { IconChevronDown } from "@frontend/ds/icons";

interface DataTableProps<T> {
  data: T[];
  // Column value types differ per column; TanStack's own typing for a mixed list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  rowId: (row: T) => string;
  emptyText: ReactNode;
  /** The sort and the page are the caller's, so they can live in the URL. */
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  /** One-based. */
  page: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  /** Narrower than this and the table scrolls sideways rather than squeezing. */
  minWidth?: number;
}

/**
 * A sorted, paged table of what Cloudflare reports: TanStack Table does the
 * sorting and paging, Mantine draws it. Click a header to sort by it.
 */
export function DataTable<T>({
  data,
  columns,
  rowId,
  emptyText,
  sorting,
  onSortingChange,
  page,
  onPageChange,
  pageSize = 10,
  minWidth = 760,
}: DataTableProps<T>) {
  const pagination = { pageIndex: page - 1, pageSize };
  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination },
    onSortingChange: (updater) =>
      onSortingChange(typeof updater === "function" ? updater(sorting) : updater),
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(pagination) : updater;
      onPageChange(next.pageIndex + 1);
    },
    getRowId: rowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });
  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const pageCount = Math.max(1, table.getPageCount());
  // A page the URL names past the end, after rows left: back to the last one.
  useEffect(() => {
    if (page > pageCount) onPageChange(pageCount);
  }, [page, pageCount, onPageChange]);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <>
      <Table.ScrollContainer minWidth={minWidth}>
        <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
          <Table.Thead>
            {table.getHeaderGroups().map((group) => (
              <Table.Tr key={group.id}>
                {group.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const direction = header.column.getIsSorted();
                  const label = header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext());
                  return (
                    <Table.Th
                      key={header.id}
                      style={{ width: header.column.columnDef.size }}
                    >
                      {sortable ? (
                        <UnstyledButton
                          onClick={header.column.getToggleSortingHandler()}
                          fz="sm"
                          fw={600}
                          aria-sort={
                            direction === "asc"
                              ? "ascending"
                              : direction === "desc"
                                ? "descending"
                                : "none"
                          }
                        >
                          <Group gap={4} wrap="nowrap">
                            {label}
                            <IconChevronDown
                              size={14}
                              style={{
                                opacity: direction ? 1 : 0.3,
                                transform:
                                  direction === "asc" ? "rotate(180deg)" : undefined,
                              }}
                            />
                          </Group>
                        </UnstyledButton>
                      ) : (
                        label
                      )}
                    </Table.Th>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Thead>
          <Table.Tbody>
            {rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={columns.length}>
                  <Text c="dimmed" size="sm" py="md" ta="center">
                    {emptyText}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              rows.map((row) => (
                <Table.Tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <Table.Td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {total > pageSize && (
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed">
            {first}–{last} of {total}
          </Text>
          <Pagination size="sm" total={pageCount} value={page} onChange={onPageChange} />
        </Group>
      )}
    </>
  );
}
