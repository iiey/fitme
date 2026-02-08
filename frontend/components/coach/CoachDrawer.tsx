"use client"

import { Brain, ChevronDown, ClipboardList, Sparkles, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useAthleteContext } from "@/lib/athlete-context"
import {
  deleteSession,
  fetchSessionMessages,
  generatePlan,
  renameSession,
  streamChat,
  useCoachSessions,
} from "@/lib/coach/api"
import { contextLabel, useCoachContext } from "@/lib/coach/context"
import type { CoachSession, CoachStatus, ThreadItem } from "@/lib/coach/types"

import { MemoryPanel } from "./MemoryPanel"
import { MessageBubble } from "./MessageBubble"
import { MessageInput } from "./MessageInput"
import { PlanCard } from "./PlanCard"
import { PlanForm } from "./PlanForm"
import { SessionMenu } from "./SessionMenu"

type Panel = "sessions" | "memory" | "plan" | null

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
  const [items, setItems] = useState<ThreadItem[]>([])
  const [streaming, setStreaming] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [items])

  const activeTitle =
    sessions.find((s) => s.id === activeSessionId)?.title ?? (activeSessionId ? "Chat" : "New chat")
  const busy = streaming || planBusy

  function togglePanel(next: Panel) {
    setPanel((prev) => (prev === next ? null : next))
  }

  function newChat() {
    abortRef.current?.abort()
    setStreaming(false)
    setActiveSessionId(null)
    setItems([])
    setError(null)
    setPanel(null)
  }

  async function selectSession(id: number) {
    setPanel(null)
    setError(null)
    setActiveSessionId(id)
    try {
      const loaded = await fetchSessionMessages(id, athleteId)
      setItems(loaded.map((m) => ({ kind: "msg", id: m.id, role: m.role, content: m.content })))
    } catch {
      setItems([])
      setError("Could not load this chat.")
    }
  }

  function appendDelta(text: string) {
    setItems((prev) => {
      const last = prev[prev.length - 1]
      if (!last || last.kind !== "msg" || last.role !== "assistant") return prev
      return [...prev.slice(0, -1), { ...last, content: last.content + text }]
    })
  }

  function dropEmptyAssistant() {
    setItems((prev) => {
      const last = prev[prev.length - 1]
      return last && last.kind === "msg" && last.role === "assistant" && !last.content
        ? prev.slice(0, -1)
        : prev
    })
  }

  async function handleSend(text: string) {
    if (busy) return
    setError(null)
    setPanel(null)
    setItems((prev) => [
      ...prev,
      { kind: "msg", role: "user", content: text },
      { kind: "msg", role: "assistant", content: "" },
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
            dropEmptyAssistant()
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

  async function handleGeneratePlan(goal: string, weeks: number) {
    if (busy) return
    setError(null)
    setPlanBusy(true)
    try {
      const result = await generatePlan({ goal, weeks, context }, athleteId)
      if (result.plan) {
        setItems((prev) => [...prev, { kind: "plan", plan: result.plan! }])
      } else if (result.message) {
        setItems((prev) => [...prev, { kind: "msg", role: "assistant", content: result.message! }])
      }
      setPanel(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate plan")
    } finally {
      setPlanBusy(false)
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
              onClick={() => togglePanel("sessions")}
              className="flex min-w-0 items-center gap-1 text-left"
              title={status.model ?? undefined}
            >
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-semibold">FitBuddy</span>
                <span className="max-w-[150px] truncate text-xs text-gray-400">{activeTitle}</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 hidden rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 sm:inline">
              {contextLabel(context)}
            </span>
            <button
              type="button"
              onClick={() => togglePanel("plan")}
              aria-label="Build a training plan"
              title="Build a training plan"
              className={`rounded-md p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${
                panel === "plan" ? "text-brand" : "text-gray-500"
              }`}
            >
              <ClipboardList className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => togglePanel("memory")}
              aria-label="What FitBuddy remembers"
              title="Memory"
              className={`rounded-md p-1.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${
                panel === "memory" ? "text-brand" : "text-gray-500"
              }`}
            >
              <Brain className="h-5 w-5" />
            </button>
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

        {panel === "sessions" && (
          <SessionMenu
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={selectSession}
            onNew={newChat}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        )}
        {panel === "memory" && <MemoryPanel athleteId={athleteId} />}
        {panel === "plan" && <PlanForm busy={planBusy} onGenerate={handleGeneratePlan} />}

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {items.length === 0 ? (
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
            items.map((item, index) =>
              item.kind === "plan" ? (
                <PlanCard key={index} plan={item.plan} />
              ) : (
                <MessageBubble key={index} message={{ role: item.role, content: item.content }} />
              ),
            )
          )}
          {planBusy && <p className="text-center text-xs text-gray-400">Building your plan…</p>}
          {error && <p className="text-center text-sm text-red-600">{error}</p>}
        </div>

        <MessageInput disabled={busy} onSend={handleSend} />
      </aside>
    </>
  )
}
