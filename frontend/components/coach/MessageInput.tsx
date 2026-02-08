"use client"

import { Brain, ClipboardList, Send } from "lucide-react"
import { useState } from "react"

interface MessageInputProps {
  disabled: boolean
  onSend: (text: string) => void
  onTogglePlan: () => void
  onToggleMemory: () => void
  planActive: boolean
  memoryActive: boolean
}

export function MessageInput({
  disabled,
  onSend,
  onTogglePlan,
  onToggleMemory,
  planActive,
  memoryActive,
}: MessageInputProps) {
  const [text, setText] = useState("")

  function submit() {
    const value = text.trim()
    if (!value || disabled) return
    onSend(value)
    setText("")
  }

  return (
    <div className="border-t border-gray-200 p-3 dark:border-gray-700">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends; Shift+Enter inserts a newline.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        rows={3}
        placeholder="Ask your coach…"
        className="max-h-48 w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand dark:border-gray-700 dark:bg-gray-900"
      />
      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onTogglePlan}
            aria-label="Build a training plan"
            title="Build a training plan"
            className={`rounded-md p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${
              planActive ? "text-brand" : "text-gray-500"
            }`}
          >
            <ClipboardList className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggleMemory}
            aria-label="What FitBuddy remembers"
            title="Memory"
            className={`rounded-md p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${
              memoryActive ? "text-brand" : "text-gray-500"
            }`}
          >
            <Brain className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !text.trim()}
          aria-label="Send"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
