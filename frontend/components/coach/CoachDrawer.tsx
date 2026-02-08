"use client"

import { ChevronDown, Sparkles, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useAthleteContext } from "@/lib/athlete-context"
import {
  deleteSession,
  fetchSessionMessages,
  renameSession,
  streamChat,
  useCoachSessions,
} from "@/lib/coach/api"
import { contextLabel, useCoachContext } from "@/lib/coach/context"
import type { ChatMessage, CoachSession, CoachStatus } from "@/lib/coach/types"

import { MessageBubble } from "./MessageBubble"
import { MessageInput } from "./MessageInput"
import { SessionMenu } from "./SessionMenu"

interface CoachDrawerProps {
  open: boolean
  onClose: () => void
  status: CoachStatus
}

export function CoachDrawer({ open, onClose, status }: CoachDrawerProps) {
  const { athleteId } = useAthleteContext()
  const context = useCoachContext()
  const { data: sessions = [], mutate: mutateSessions } = useCoachSessions(athleteId, open)

  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Close on Escape; abort any in-flight stream when the drawer closes.
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort()
      return
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  // Keep the latest message in view as it streams.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  const activeTitle =
    sessions.find((s) => s.id === activeSessionId)?.title ?? (activeSessionId ? "Chat" : "New chat")

  function newChat() {
    abortRef.current?.abort()
    setStreaming(false)
    setActiveSessionId(null)
    setMessages([])
    setError(null)
    setMenuOpen(false)
  }

  async function selectSession(id: number) {
    setMenuOpen(false)
    setError(null)
    setActiveSessionId(id)
    try {
      const loaded = await fetchSessionMessages(id, athleteId)
      setMessages(loaded.map((m) => ({ id: m.id, role: m.role, content: m.content })))
    } catch {
      setMessages([])
      setError("Could not load this chat.")
    }
  }

  function appendDelta(text: string) {
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (!last || last.role !== "assistant") return prev
      return [...prev.slice(0, -1), { ...last, content: last.content + text }]
    })
  }

  async function handleSend(text: string) {
    if (streaming) return
    setError(null)
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ])
    setStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await streamChat(
        { message: text, session_id: activeSessionId, context },
        athleteId,
        {
          onSession: (id) => {
            setActiveSessionId(id)
            void mutateSessions()
          },
          onDelta: appendDelta,
          onDone: () => {
            setStreaming(false)
            void mutateSessions()
          },
          onError: (message) => {
            setStreaming(false)
            setError(message)
            // Drop the empty assistant placeholder.
            setMessages((prev) => {
              const last = prev[prev.length - 1]
              return last && last.role === "assistant" && !last.content ? prev.slice(0, -1) : prev
            })
          },
        },
        controller.signal,
      )
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Chat failed")
      }
      setStreaming(false)
    }
  }

  async function handleRename(session: CoachSession) {
    const title = window.prompt("Rename chat", session.title)
    if (title === null) return
    try {
      await renameSession(session.id, title, athleteId)
      void mutateSessions()
    } catch {
      setError("Could not rename chat.")
    }
  }

  async function handleDelete(session: CoachSession) {
    if (!window.confirm(`Delete "${session.title}"?`)) return
    try {
      await deleteSession(session.id, athleteId)
      if (session.id === activeSessionId) newChat()
      void mutateSessions()
    } catch {
      setError("Could not delete chat.")
    }
  }

  const quickPrompts =
    context.view === "activity"
      ? ["Analyze this activity", "How was my pacing?", "How does this compare to recent efforts?"]
      : ["How's my training load?", "Summarize my last week", "What should I do tomorrow?"]

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-label="FitBuddy"
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-gray-200 bg-surface shadow-xl transition-transform duration-200 dark:border-gray-700 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-5 w-5 shrink-0 text-brand" />
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex min-w-0 items-center gap-1 text-left"
              title={status.model ?? undefined}
            >
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-semibold">FitBuddy</span>
                <span className="max-w-[200px] truncate text-xs text-gray-400">{activeTitle}</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800">
              {contextLabel(context)}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {menuOpen && (
          <SessionMenu
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={selectSession}
            onNew={newChat}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        )}

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Sparkles className="h-8 w-8 text-gray-300 dark:text-gray-600" />
              <p className="text-sm font-medium">How can I help with your training?</p>
              <div className="flex flex-col gap-2">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => handleSend(prompt)}
                    className="rounded-full border border-gray-300 px-3 py-1.5 text-xs transition-colors hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => <MessageBubble key={index} message={message} />)
          )}
          {error && <p className="text-center text-sm text-red-600">{error}</p>}
        </div>

        <MessageInput disabled={streaming} onSend={handleSend} />
      </aside>
    </>
  )
}
