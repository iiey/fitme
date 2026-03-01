"use client"

import clsx from "clsx"
import { ArrowLeft, BicepsFlexed, Pin, Plus, Sparkles, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useAthleteContext } from "@/lib/athlete-context"
import {
  deleteSession,
  deleteSessions,
  fetchCoachInsights,
  fetchSessionMessages,
  generatePlan,
  renameSession,
  streamChat,
  useCoachSessions,
  useCoachSkills,
} from "@/lib/coach/api"
import { contextLabel, useCoachContext } from "@/lib/coach/context"
import type { CoachInsights, CoachSession, CoachStatus, ThreadItem } from "@/lib/coach/types"

import { InsightsCard } from "./InsightsCard"
import { MemoryPanel } from "./MemoryPanel"
import { MessageBubble } from "./MessageBubble"
import { MessageInput } from "./MessageInput"
import { PlanCard } from "./PlanCard"
import { PlanForm } from "./PlanForm"
import { SessionMenu } from "./SessionMenu"

type Panel = "sessions" | "memory" | "plan" | null

const PINNED_KEY = "fitme-coach-pinned"

// Sent to the model when the athlete taps "Today's insights": the deterministic
// snapshot card is shown immediately, and this asks for an analysis below it.
const INSIGHTS_PROMPT =
  "Give me today's insights: briefly analyze my recent activities and current training load, and what they mean for my training today."

interface CoachDrawerProps {
  open: boolean
  onClose: () => void
  status: CoachStatus
}

export function CoachDrawer({ open, onClose, status }: CoachDrawerProps) {
  const { athleteId } = useAthleteContext()
  const context = useCoachContext()
  const { data: sessions = [], mutate: mutateSessions } = useCoachSessions(athleteId, open)
  const { data: skills = [] } = useCoachSkills(open)

  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  const [items, setItems] = useState<ThreadItem[]>([])
  const [streaming, setStreaming] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)
  const [insightsBusy, setInsightsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingReply, setPendingReply] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  // Sticky web-search toggle: when on, each send gives the coach free web access.
  const [webActive, setWebActive] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const pollTokenRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(420)
  const resizingRef = useRef(false)
  // When pinned, the panel stays docked while the rest of the app is used:
  // no dimming backdrop, clicks pass through, and outside actions/Escape don't
  // close it. Defaults to off and persists across reloads.
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    setPinned(localStorage.getItem(PINNED_KEY) === "true")
  }, [])

  function togglePin() {
    setPinned((prev) => {
      const next = !prev
      localStorage.setItem(PINNED_KEY, String(next))
      return next
    })
  }

  // Keep generation running even while the drawer is closed: the stream finishes
  // and the backend persists it, so reopening the session shows the full reply.
  useEffect(() => {
    if (!open || pinned) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, pinned, onClose])

  // biome-ignore lint/correctness/useExhaustiveDependencies: auto-scroll to the latest message when items change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [items])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizingRef.current) return
      // Panel is docked right: distance from cursor to viewport edge is its width.
      const next = window.innerWidth - e.clientX
      setWidth(Math.min(Math.max(next, 320), window.innerWidth * 0.95))
    }
    function onUp() {
      resizingRef.current = false
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [])

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    resizingRef.current = true
    document.body.style.userSelect = "none"
  }

  const activeTitle =
    sessions.find((s) => s.id === activeSessionId)?.title ?? (activeSessionId ? "Chat" : "New chat")
  const busy = streaming || planBusy || pendingReply || insightsBusy

  function togglePanel(next: Panel) {
    setPanel((prev) => (prev === next ? null : next))
  }

  function stopStream() {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }

  function cancelPoll() {
    pollTokenRef.current++
    setPendingReply(false)
  }

  // After reattaching to a session whose last turn is an unanswered question,
  // poll until the assistant reply (generated in the background) is persisted.
  async function pollForReply(sessionId: number) {
    const token = ++pollTokenRef.current
    setPendingReply(true)
    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        if (pollTokenRef.current !== token) return
        let messages: Awaited<ReturnType<typeof fetchSessionMessages>>
        try {
          messages = await fetchSessionMessages(sessionId, athleteId)
        } catch {
          continue
        }
        if (pollTokenRef.current !== token) return
        const last = messages[messages.length - 1]
        if (last && last.role === "assistant") {
          setItems(
            messages.map((m) => ({ kind: "msg", id: m.id, role: m.role, content: m.content })),
          )
          return
        }
      }
    } finally {
      if (pollTokenRef.current === token) setPendingReply(false)
    }
  }

  function newChat() {
    stopStream()
    cancelPoll()
    setActiveSessionId(null)
    setItems([])
    setError(null)
    setPanel(null)
  }

  async function selectSession(id: number) {
    stopStream()
    cancelPoll()
    setPanel(null)
    setError(null)
    setActiveSessionId(id)
    try {
      const loaded = await fetchSessionMessages(id, athleteId)
      setItems(loaded.map((m) => ({ kind: "msg", id: m.id, role: m.role, content: m.content })))
      // A trailing user turn means the reply is still generating; reattach to it.
      const last = loaded[loaded.length - 1]
      if (last && last.role === "user") void pollForReply(id)
    } catch {
      setItems([])
      setError("Could not load this chat.")
    }
  }

  function appendDelta(text: string) {
    setItems((prev) => {
      const last = prev[prev.length - 1]
      if (last?.kind !== "msg" || last.role !== "assistant") return prev
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

  // Append the caller's thread items plus an empty assistant bubble, then stream
  // the model's reply into it. Shared by the composer and "Today's insights".
  async function runStream(message: string, displayItems: ThreadItem[], skillId: string | null) {
    cancelPoll()
    setError(null)
    setPanel(null)
    setItems((prev) => [...prev, ...displayItems, { kind: "msg", role: "assistant", content: "" }])
    setStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await streamChat(
        { message, session_id: activeSessionId, context, skill: skillId, web: webActive },
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

  async function handleSend(text: string, skillId: string | null = null) {
    if (busy) return
    await runStream(text, [{ kind: "msg", role: "user", content: text }], skillId)
  }

  async function handleGeneratePlan(goal: string, weeks: number) {
    if (busy) return
    setError(null)
    setPlanBusy(true)
    try {
      const result = await generatePlan({ goal, weeks, context }, athleteId)
      if (result.plan) {
        const plan = result.plan
        setItems((prev) => [...prev, { kind: "plan", plan }])
      } else if (result.message) {
        const message = result.message
        setItems((prev) => [...prev, { kind: "msg", role: "assistant", content: message }])
      }
      setPanel(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate plan")
    } finally {
      setPlanBusy(false)
    }
  }

  // "Today's insights" shows the deterministic training-load snapshot as a card,
  // then asks the model to analyze recent activities and readiness below it.
  async function handleInsights() {
    if (busy) return
    setError(null)
    setPanel(null)
    setInsightsBusy(true)
    let insights: CoachInsights
    try {
      insights = await fetchCoachInsights(athleteId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load insights")
      setInsightsBusy(false)
      return
    }
    setInsightsBusy(false)
    await runStream(
      INSIGHTS_PROMPT,
      [
        { kind: "msg", role: "user", content: INSIGHTS_PROMPT },
        { kind: "insights", insights },
      ],
      null,
    )
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
    try {
      await deleteSession(session.id, athleteId)
      if (session.id === activeSessionId) newChat()
      void mutateSessions()
    } catch {
      setError("Could not delete chat.")
    }
  }

  async function handleDeleteMany(ids: number[]) {
    try {
      await deleteSessions(ids, athleteId)
      if (activeSessionId !== null && ids.includes(activeSessionId)) newChat()
      void mutateSessions()
    } catch {
      setError("Could not delete chats.")
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
        onClick={pinned ? undefined : onClose}
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity ${
          open && !pinned ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-label="FitBuddy"
        style={{ width: `${width}px` }}
        className={`fixed inset-y-0 right-0 z-50 flex max-w-[95vw] flex-col border-l border-gray-200 bg-surface shadow-xl transition-transform duration-200 dark:border-gray-700 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: mouse-only resize handle; the panel is fully usable at its default width */}
        <div
          onMouseDown={startResize}
          className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize transition-colors hover:bg-brand/40"
        />
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex min-w-0 items-center gap-2">
            <BicepsFlexed className="h-5 w-5 shrink-0 text-brand" />
            <span className="text-sm font-semibold" title={status.model ?? undefined}>
              FitBuddy
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 hidden rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 sm:inline">
              {contextLabel(context)}
            </span>
            <button
              type="button"
              onClick={togglePin}
              aria-label={pinned ? "Unpin panel" : "Pin panel"}
              aria-pressed={pinned}
              title={
                pinned
                  ? "Unpin: clicking outside or pressing Esc will close the panel again"
                  : "Pin: keep the panel open while you navigate and use the rest of the app"
              }
              className={clsx(
                "rounded-md p-1.5 transition-colors",
                pinned
                  ? "bg-brand/10 text-brand hover:bg-brand/20"
                  : "text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800",
              )}
            >
              <Pin className="h-5 w-5" strokeWidth={2} fill={pinned ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              onClick={newChat}
              aria-label="New chat"
              title="New chat"
              className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Plus className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {panel === "sessions" ? (
          <SessionMenu
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelect={selectSession}
            onRename={handleRename}
            onDelete={handleDelete}
            onDeleteMany={handleDeleteMany}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setPanel("sessions")}
              aria-label="Back to chats"
              className="flex min-w-0 items-center gap-1.5 border-b border-gray-200 px-4 py-2 text-left text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              <span className="truncate text-sm font-medium">{activeTitle}</span>
            </button>

            {panel === "memory" && <MemoryPanel athleteId={athleteId} />}
            {panel === "plan" && <PlanForm busy={planBusy} onGenerate={handleGeneratePlan} />}

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
              {items.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <Sparkles className="h-8 w-8 text-gray-300 dark:text-gray-600" />
                  <p className="text-sm font-medium">How can I help with your training?</p>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleInsights}
                      disabled={insightsBusy}
                      className="rounded-full border border-brand/40 bg-brand/5 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/10 disabled:opacity-60"
                    >
                      {insightsBusy ? "Loading insights…" : "Today's insights"}
                    </button>
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
                items.map((item, index) => {
                  const key = item.kind === "msg" && item.id != null ? item.id : index
                  if (item.kind === "plan") return <PlanCard key={key} plan={item.plan} />
                  if (item.kind === "insights")
                    return <InsightsCard key={key} insights={item.insights} />
                  return (
                    <MessageBubble key={key} message={{ role: item.role, content: item.content }} />
                  )
                })
              )}
              {pendingReply && <MessageBubble message={{ role: "assistant", content: "" }} />}
              {planBusy && <p className="text-center text-xs text-gray-400">Building your plan…</p>}
              {error && <p className="text-center text-sm text-red-600">{error}</p>}
            </div>

            <MessageInput
              disabled={busy}
              skills={skills}
              onSend={handleSend}
              onToggleWeb={() => setWebActive((prev) => !prev)}
              onTogglePlan={() => togglePanel("plan")}
              onToggleMemory={() => togglePanel("memory")}
              webActive={webActive}
              planActive={panel === "plan"}
              memoryActive={panel === "memory"}
            />
          </>
        )}
      </aside>
    </>
  )
}
