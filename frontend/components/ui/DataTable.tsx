"use client"

import clsx from "clsx"

export interface Column<T> {
  key: string
  header: string
  sortable?: boolean
  align?: "left" | "right" | "center"
  render: (row: T) => React.ReactNode
}

/**
 * Optional row-selection support. When provided, a leading checkbox column is
 * reserved so that toggling ``enabled`` shows/hides the checkboxes without
 * shifting the existing data columns.
 */
export interface TableSelection {
  enabled: boolean
  selectedKeys: Set<string>
  onToggleRow: (key: string) => void
  allSelected: boolean
  someSelected: boolean
  onToggleAll: () => void
}

export function DataTable<T>({
  columns,
  rows,
  sort,
  order,
  onSort,
  onRowClick,
  getRowKey,
  selection,
}: {
  columns: Column<T>[]
  rows: T[]
  sort?: string
  order?: "asc" | "desc"
  onSort?: (key: string) => void
  onRowClick?: (row: T) => void
  getRowKey: (row: T) => string
  selection?: TableSelection
}) {
  // A fixed-width leading cell holds space for the checkbox so the layout stays
  // stable whether or not selection mode is active.
  const selectCellClass = "w-10 px-3 py-2 align-middle"

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-300 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700">
            {selection && (
              <th className={selectCellClass}>
                {selection.enabled && (
                  <input
                    type="checkbox"
                    aria-label="Select all activities"
                    checked={selection.allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selection.someSelected && !selection.allSelected
                    }}
                    onChange={selection.onToggleAll}
                    className="h-4 w-4 cursor-pointer accent-brand"
                  />
                )}
              </th>
            )}
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
          {rows.map((row) => {
            const key = getRowKey(row)
            return (
              <tr
                key={key}
                className={clsx(
                  "border-b border-gray-300 transition-colors dark:border-gray-700",
                  onRowClick && "cursor-pointer hover:bg-surface-muted",
                )}
                onClick={() => onRowClick?.(row)}
              >
                {selection && (
                  <td className={selectCellClass}>
                    {selection.enabled && (
                      <input
                        type="checkbox"
                        aria-label="Select activity"
                        checked={selection.selectedKeys.has(key)}
                        onChange={() => selection.onToggleRow(key)}
                        onClick={(event) => event.stopPropagation()}
                        className="h-4 w-4 cursor-pointer accent-brand"
                      />
                    )}
                  </td>
                )}
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
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-400">No activities match your filters.</p>
      )}
    </div>
  )
}
