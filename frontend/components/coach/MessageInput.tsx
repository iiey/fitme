"use client"

import { Send } from "lucide-react"
import { useState } from "react"

interface MessageInputProps {
  disabled: boolean
  onSend: (text: string) => void
}

export function MessageInput({ disabled, onSend }: MessageInputProps) {
  const [text, setText] = useState("")

  function submit() {
    const value = text.trim()
    if (!value || disabled) return
    onSend(value)
    setText("")
  }

  return (
    <div className="flex items-end gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
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
        rows={1}
        placeholder="Ask your coach…"
        className="max-h-32 flex-1 resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand dark:border-gray-700 dark:bg-gray-900"
      />
      <button
        type="button"
        onClick={submit}
        disabled={disabled || !text.trim()}
        aria-label="Send"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  )
}
