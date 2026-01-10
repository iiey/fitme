"use client";

import clsx from "clsx";

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  render: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  sort,
  order,
  onSort,
  onRowClick,
  getRowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  sort?: string;
  order?: "asc" | "desc";
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  getRowKey: (row: T) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
            {columns.map((column) => (
              <th
                key={column.key}
                className={clsx(
                  "px-3 py-2 font-semibold",
                  column.align === "right" && "text-right",
                  column.align === "center" && "text-center",
                  column.sortable && onSort && "cursor-pointer select-none hover:text-gray-900",
                )}
                onClick={() => column.sortable && onSort?.(column.key)}
              >
                {column.header}
                {column.sortable && sort === column.key && (
                  <span className="ml-1">{order === "asc" ? "▲" : "▼"}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={getRowKey(row)}
              className={clsx(
                "border-b border-gray-100 transition-colors",
                onRowClick && "cursor-pointer hover:bg-surface-muted",
              )}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={clsx(
                    "px-3 py-2",
                    column.align === "right" && "text-right",
                    column.align === "center" && "text-center",
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-400">No activities match your filters.</p>
      )}
    </div>
  );
}
