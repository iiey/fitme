"use client"

import clsx from "clsx"
import { Brain, ClipboardList, Globe, Send, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import type { CoachSkill } from "@/lib/coach/types"

interface MessageInputProps {
  disabled: boolean
  skills: CoachSkill[]
  onSend: (text: string, skillId: string | null) => void
  onToggleWeb: () => void
  onTogglePlan: () => void
  onToggleMemory: () => void
  webActive: boolean
  planActive: boolean
  memoryActive: boolean
}

// A bare "/query" at the very start of the input (no spaces yet) opens the menu.
const SLASH = /^\/(\S*)$/

export function MessageInput({
  disabled,
  skills,
  onSend,
  onToggleWeb,
  onTogglePlan,
  onToggleMemory,
  webActive,
  planActive,
  memoryActive,
}: MessageInputProps) {
  const [text, setText] = useState("")
  const [pendingSkill, setPendingSkill] = useState<CoachSkill | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const slashMatch = pendingSkill ? null : text.match(SLASH)
  const isSlash = slashMatch !== null
  const query = (slashMatch?.[1] ?? "").toLowerCase()
  const filtered = useMemo(
    () =>
      isSlash
        ? skills.filter(
            (skill) => skill.name.toLowerCase().includes(query) || skill.id.includes(query),
          )
        : [],
    [skills, query, isSlash],
  )
  const showMenu = menuOpen && isSlash && filtered.length > 0

  // Keep the highlight in range as the filtered list changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset highlight whenever the filtered query changes
  useEffect(() => setHighlight(0), [query, isSlash])

  // Close the menu when clicking outside the composer (mirrors SportFilter).
  useEffect(() => {
    if (!showMenu) return
    function onClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [showMenu])

  function selectSkill(skill: CoachSkill) {
    setPendingSkill(skill)
    setText("")
    setMenuOpen(false)
    textareaRef.current?.focus()
  }

  function clearSkill() {
    setPendingSkill(null)
    textareaRef.current?.focus()
  }

  function submit() {
    const value = text.trim()
    if (!value || disabled) return
    onSend(value, pendingSkill?.id ?? null)
    // Per-message scope: the skill applies to this send only, then clears.
    setText("")
    setPendingSkill(null)
    setMenuOpen(false)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showMenu) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setHighlight((index) => (index + 1) % filtered.length)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setHighlight((index) => (index - 1 + filtered.length) % filtered.length)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        selectSkill(filtered[highlight])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setMenuOpen(false)
        return
      }
    }
    // Enter sends; Shift+Enter inserts a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-gray-200 p-3 dark:border-gray-700">
      <div ref={containerRef} className="relative">
        {showMenu && (
          <div
            role="listbox"
            className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          >
            {filtered.map((skill, index) => (
              <button
                key={skill.id}
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                // mousedown (not click) so the textarea does not blur first.
                onMouseDown={(event) => {
                  event.preventDefault()
                  selectSkill(skill)
                }}
                className={clsx(
                  "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left",
                  index === highlight
                    ? "bg-gray-100 dark:bg-gray-800"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800/60",
                )}
              >
                <span className="text-xs font-medium">
                  <span className="text-brand">/{skill.id}</span> {skill.name}
                </span>
                <span className="truncate text-xs text-gray-500">{skill.description}</span>
              </button>
            ))}
          </div>
        )}

        {pendingSkill && (
          <div className="mb-1 flex">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
              {pendingSkill.name}
              <button
                type="button"
                onClick={clearSkill}
                aria-label={`Remove ${pendingSkill.name} skill`}
                className="rounded-full hover:bg-brand/20"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => {
            const value = event.target.value
            setText(value)
            setMenuOpen(!pendingSkill && SLASH.test(value))
          }}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder={
            pendingSkill ? `Ask about ${pendingSkill.name}…` : "Ask your coach…  (/ for skills)"
          }
          className="max-h-48 w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand dark:border-gray-700 dark:bg-gray-900"
        />
      </div>
      <div className="mt-1 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleWeb}
            aria-label="Search the web"
            aria-pressed={webActive}
            title="Use websearch (duckduckgo) to response to questions"
            className={`rounded-md p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${
              webActive ? "text-brand" : "text-gray-500"
            }`}
          >
            <Globe className="h-4 w-4" />
          </button>
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
