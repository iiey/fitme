"use client"

import { useEffect, useRef, useState } from "react"

/**
 * A compact note field that opens a roomy textarea in a modal when clicked,
 * so longer notes are comfortable to write and read. Edits are committed on
 * Save; Cancel discards them.
 */
export function NoteField({
  value,
  onChange,
  placeholder = "Optional note",
  label = "Note",
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function openEditor() {
    setDraft(value)
    setOpen(true)
  }

  function save() {
    onChange(draft)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const el = textareaRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={openEditor}
        className="min-h-[2.5rem] w-full whitespace-pre-wrap break-words rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
      >
        {value ? value : <span className="text-gray-400">{placeholder}</span>}
      </button>

      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss is a mouse convenience; the dialog closes via Escape and a close button
        // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-dismiss is a mouse convenience; the dialog closes via Escape and a close button
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <div className="card flex w-full max-w-lg flex-col overflow-hidden">
            <header className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
              <h2 className="text-lg font-semibold">{label}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
                aria-label="Close"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </header>
            <div className="p-5">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={placeholder}
                rows={6}
                className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
              />
            </div>
            <footer className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
              >
                Save
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}
