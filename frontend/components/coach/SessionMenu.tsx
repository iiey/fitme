"use client"

import { Pencil, Plus, Trash2 } from "lucide-react"

import type { CoachSession } from "@/lib/coach/types"

interface SessionMenuProps {
  sessions: CoachSession[]
  activeSessionId: number | null
  onSelect: (id: number) => void
  onNew: () => void
  onRename: (session: CoachSession) => void
  onDelete: (session: CoachSession) => void
}

export function SessionMenu({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: SessionMenuProps) {
  return (
    <div className="border-b border-gray-200 bg-surface dark:border-gray-700">
      <button
        type="button"
        onClick={onNew}
        className="flex w-full items-center gap-2 px-4 py-2 text-sm font-medium text-brand transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        <Plus className="h-4 w-4" /> New chat
      </button>
      <ul className="max-h-64 overflow-y-auto">
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
