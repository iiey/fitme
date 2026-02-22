"use client"

import { Pencil, Trash2 } from "lucide-react"
import { useState } from "react"

import type { CoachSession } from "@/lib/coach/types"

interface SessionMenuProps {
  sessions: CoachSession[]
  activeSessionId: number | null
  onSelect: (id: number) => void
  onRename: (session: CoachSession) => void
  onDelete: (session: CoachSession) => void
  // Batch-delete the given session ids (multi-select and "Clear all").
  onDeleteMany: (ids: number[]) => Promise<void> | void
}

export function SessionMenu({
  sessions,
  activeSessionId,
  onSelect,
  onRename,
  onDelete,
  onDeleteMany,
}: SessionMenuProps) {
  // Ids ticked for batch delete. Kept local to the menu since it is ephemeral
  // UI state; the parent owns the actual sessions and the delete request.
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const selectedCount = sessions.filter((s) => selected.has(s.id)).length
  const allSelected = sessions.length > 0 && selectedCount === sessions.length
  const someSelected = selectedCount > 0 && !allSelected

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(sessions.map((s) => s.id)))
  }

  async function deleteSelected() {
    const ids = sessions.filter((s) => selected.has(s.id)).map((s) => s.id)
    if (ids.length === 0) return
    if (!window.confirm(`Delete ${ids.length} chat${ids.length > 1 ? "s" : ""}?`)) return
    await onDeleteMany(ids)
    setSelected(new Set())
  }

  async function clearAll() {
    if (sessions.length === 0) return
    if (!window.confirm("Delete all chats? This cannot be undone.")) return
    await onDeleteMany(sessions.map((s) => s.id))
    setSelected(new Set())
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-surface">
      {sessions.length > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
          <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected
              }}
              onChange={toggleAll}
              className="h-3.5 w-3.5 rounded border-gray-300 text-brand focus:ring-brand"
            />
            {selectedCount > 0 ? `${selectedCount} selected` : "Select all"}
          </label>
          <div className="flex items-center gap-1">
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={deleteSelected}
                className="rounded px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 dark:hover:bg-red-950/40"
              >
                Delete ({selectedCount})
              </button>
            )}
            <button
              type="button"
              onClick={clearAll}
              className="rounded px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Clear all
            </button>
          </div>
        </div>
      )}
      <ul className="flex-1 overflow-y-auto">
        {sessions.length === 0 && (
          <li className="px-4 py-2 text-xs text-gray-400">No previous chats.</li>
        )}
        {sessions.map((session) => (
          <li
            key={session.id}
            className={`group flex items-center gap-1 px-2 ${
              session.id === activeSessionId ? "bg-gray-100 dark:bg-gray-800" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={selected.has(session.id)}
              onChange={() => toggle(session.id)}
              aria-label={`Select "${session.title}"`}
              className="ml-1 h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-brand focus:ring-brand"
            />
            <button
              type="button"
              onClick={() => onSelect(session.id)}
              className="flex-1 truncate px-2 py-2 text-left text-sm"
              title={session.title}
            >
              {session.title}
            </button>
            <button
              type="button"
              onClick={() => onRename(session)}
              aria-label="Rename chat"
              className="rounded p-1.5 text-gray-400 opacity-0 transition-opacity hover:bg-gray-200 group-hover:opacity-100 dark:hover:bg-gray-700"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(session)}
              aria-label="Delete chat"
              className="rounded p-1.5 text-gray-400 opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
