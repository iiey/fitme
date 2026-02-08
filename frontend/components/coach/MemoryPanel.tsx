"use client"

import { Trash2 } from "lucide-react"

import { deleteMemory, useCoachMemory } from "@/lib/coach/api"

export function MemoryPanel({ athleteId }: { athleteId: string | null }) {
  const { data: memory = [], mutate } = useCoachMemory(athleteId, true)

  async function forget(id: number) {
    await deleteMemory(id, athleteId)
    void mutate()
  }

  return (
    <div className="border-b border-gray-200 bg-surface dark:border-gray-700">
      <div className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-gray-400">
        What FitBuddy remembers
      </div>
      {memory.length === 0 ? (
        <p className="px-4 pb-3 text-xs text-gray-400">
          Nothing yet. Tell FitBuddy about your goals, injuries, or preferences and it will
          remember.
        </p>
      ) : (
        <ul className="max-h-56 overflow-y-auto pb-2">
          {memory.map((m) => (
            <li key={m.id} className="group flex items-start gap-2 px-4 py-1.5 text-sm">
              <span className="flex-1">{m.content}</span>
              <button
                type="button"
                onClick={() => forget(m.id)}
                aria-label="Forget this"
                className="rounded p-1 text-gray-400 opacity-0 transition-opacity hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
