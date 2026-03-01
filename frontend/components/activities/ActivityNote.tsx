"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { mutate } from "swr"

import { updateActivityNote } from "@/lib/api"

export function ActivityNote({
  activityId,
  athleteId,
  note,
  children,
}: {
  activityId: string
  athleteId: string | null
  note: string | null
  children?: React.ReactNode
}) {
  const hasNote = !!note
  const [open, setOpen] = useState(hasNote)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note ?? "")
  const [saving, setSaving] = useState(false)

  const save = useCallback(async () => {
    if (!athleteId) return
    setSaving(true)
    try {
      const value = draft.trim() || null
      await updateActivityNote(athleteId, activityId, value)
      mutate(
        (key: unknown) =>
          typeof key === "string" && key.startsWith(`/api/activities/${activityId}`),
      )
      setEditing(false)
      if (!value) setOpen(false)
    } finally {
      setSaving(false)
    }
  }, [athleteId, activityId, draft])

  const cancel = useCallback(() => {
    setDraft(note ?? "")
    setEditing(false)
    if (!hasNote) setOpen(false)
  }, [note, hasNote])

  const beginEdit = useCallback(() => {
    setDraft(note ?? "")
    setOpen(true)
    setEditing(true)
  }, [note])

  if (!children) {
    return (
      <div className="card p-4">
        {editing ? (
          <NoteEditor
            draft={draft}
            setDraft={setDraft}
            save={save}
            cancel={cancel}
            saving={saving}
          />
        ) : (
          <NoteDisplay note={note} onEdit={beginEdit} />
        )}
      </div>
    )
  }

  const panelOpen = open || editing

  return (
    <div className="relative flex gap-6">
      {children}
      <div
        className={`hidden transition-all duration-300 ease-in-out lg:block ${
          panelOpen ? "w-[33%] min-w-[260px] opacity-100" : "w-0 min-w-0 overflow-hidden opacity-0"
        }`}
      >
        {panelOpen && (
          <div className="card flex h-full flex-col p-4">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="card-title">Note</h2>
              {!editing && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Close note"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </header>
            <div className="flex flex-1 flex-col">
              {editing ? (
                <NoteEditor
                  draft={draft}
                  setDraft={setDraft}
                  save={save}
                  cancel={cancel}
                  saving={saving}
                />
              ) : (
                <NoteDisplay note={note} onEdit={beginEdit} />
              )}
            </div>
          </div>
        )}
      </div>
      {!panelOpen && (
        <button
          type="button"
          onClick={beginEdit}
          className="absolute right-3 top-3 hidden items-center gap-1.5 rounded-lg bg-gray-900/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-gray-900/80 lg:flex"
          aria-label="Add note"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Note
        </button>
      )}
      <div className="contents lg:hidden">
        {(hasNote || editing) && (
          <div className="card p-4">
            {editing ? (
              <NoteEditor
                draft={draft}
                setDraft={setDraft}
                save={save}
                cancel={cancel}
                saving={saving}
              />
            ) : (
              <NoteDisplay note={note} onEdit={beginEdit} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function NoteDisplay({ note, onEdit }: { note: string | null; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex w-full flex-1 items-start text-left rounded-lg border border-dashed border-gray-200 dark:border-gray-700 px-4 py-3 text-sm text-gray-400 dark:text-gray-500 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
    >
      {note ? (
        <span className="text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{note}</span>
      ) : (
        "Add a note…"
      )}
    </button>
  )
}

function NoteEditor({
  draft,
  setDraft,
  save,
  cancel,
  saving,
}: {
  draft: string
  setDraft: (v: string) => void
  save: () => void
  cancel: () => void
  saving: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Focus the editor when it opens (replaces the autoFocus attribute, flagged for a11y).
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])
  return (
    <div className="flex flex-1 flex-col gap-2">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Write a note about this activity…"
        className="w-full flex-1 resize-none rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  )
}
