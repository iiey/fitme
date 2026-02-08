"use client"

import { useEffect, useState } from "react"

import {
  deleteCoachConfig,
  saveCoachConfig,
  useCoachConfig,
  useCoachStatus,
  verifyCoachConfig,
} from "@/lib/coach/api"
import type { CoachProvider } from "@/lib/coach/types"

const PROVIDERS: { value: CoachProvider; label: string }[] = [
  { value: "ollama", label: "Ollama (local)" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai_compatible", label: "OpenAI-compatible" },
]

const MODEL_PLACEHOLDER: Record<CoachProvider, string> = {
  ollama: "e.g. llama3.1",
  openai: "e.g. gpt-4o",
  anthropic: "e.g. claude-sonnet-4-6",
  openai_compatible: "model id from your provider",
}

const INPUT_CLASS =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"

export function CoachSettingsSection() {
  const { data: status, isLoading: statusLoading, mutate: mutateStatus } = useCoachStatus()
  const { data: config, mutate: mutateConfig } = useCoachConfig()

  const [provider, setProvider] = useState<CoachProvider>("ollama")
  const [model, setModel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434")
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Seed the form from the saved config once it loads.
  useEffect(() => {
    if (config) {
      setProvider(config.provider)
      setModel(config.model)
      setEnabled(config.enabled)
      if (config.base_url) setBaseUrl(config.base_url)
    }
  }, [config])

  // The coach backend is not installed: hide the whole section.
  if (statusLoading) return null
  if (!status) return null

  const needsKey = provider === "openai" || provider === "anthropic"
  const needsBaseUrl = provider === "ollama" || provider === "openai_compatible"
  const hasKey = apiKey.trim().length > 0 || (config?.has_api_key ?? false)
  const canSubmit =
    model.trim().length > 0 && (!needsKey || hasKey) && (!needsBaseUrl || baseUrl.trim().length > 0)

  function buildPayload() {
    return {
      provider,
      model: model.trim(),
      api_key: apiKey.trim(),
      base_url: needsBaseUrl ? baseUrl.trim() : null,
      enabled,
    }
  }

  async function handleVerify() {
    setBusy(true)
    setError(null)
    setNotice(null)
    setVerifyResult(null)
    try {
      const result = await verifyCoachConfig(buildPayload())
      setVerifyResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify connection")
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    setBusy(true)
    setError(null)
    setNotice(null)
    setVerifyResult(null)
    try {
      await saveCoachConfig(buildPayload())
      setApiKey("")
      setNotice("Saved and verified. The coach is ready.")
      await Promise.all([mutateConfig(), mutateStatus()])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save coach settings")
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    if (!confirm("Remove the FitBuddy configuration?")) return
    setBusy(true)
    setError(null)
    setNotice(null)
    setVerifyResult(null)
    try {
      await deleteCoachConfig()
      setApiKey("")
      setNotice("Coach configuration removed.")
      await Promise.all([mutateConfig(), mutateStatus()])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove coach settings")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Chat with your fitness buddy about training. It connects to a local model via Ollama or to a
        cloud provider with your own API key. The coach icon appears once a configuration is saved
        and verified.
      </p>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">Provider</span>
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as CoachProvider)
            setVerifyResult(null)
          }}
          disabled={busy}
          className={INPUT_CLASS}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">Model</span>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={MODEL_PLACEHOLDER[provider]}
          disabled={busy}
          className={INPUT_CLASS}
        />
      </label>

      {needsBaseUrl && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Base URL</span>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:11434"
            disabled={busy}
            className={INPUT_CLASS}
          />
          <span className="mt-1 block text-xs text-gray-400">
            For Ollama, the default is <code className="font-mono">http://localhost:11434</code>.
          </span>
        </label>
      )}

      {(needsKey || provider === "openai_compatible") && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">
            API key{" "}
            {provider === "openai_compatible" && (
              <span className="font-normal text-gray-400">(optional)</span>
            )}
            {config?.has_api_key && (
              <span className="font-normal text-gray-400">(stored - leave blank to keep)</span>
            )}
          </span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config?.has_api_key ? "••••••••••••" : "Your API key"}
            disabled={busy}
            className={INPUT_CLASS}
          />
        </label>
      )}

      <div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={busy}
            className="h-4 w-4 rounded border-gray-300 text-brand"
          />
          Enable coach
        </label>
      </div>

      <p className="text-xs text-gray-400">
        Cloud providers (OpenAI, Anthropic) receive the training data the coach analyzes. Use Ollama
        to keep everything on your machine.
      </p>

      {verifyResult && (
        <p className={`text-sm ${verifyResult.ok ? "text-green-600" : "text-red-600"}`}>
          {verifyResult.ok ? "Connection OK." : `Verification failed: ${verifyResult.message}`}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-green-600">{notice}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleVerify}
          disabled={busy || !canSubmit}
          title="Test these settings now without saving them. Nothing is stored and the coach stays hidden — use this to try a model or base URL."
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {busy ? "Working…" : "Verify"}
        </button>
        <button
          onClick={handleSave}
          disabled={busy || !canSubmit}
          title="Verify these settings and, if they work, save them. On success the configuration is stored and the coach icon appears."
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          {config ? "Save & verify" : "Connect"}
        </button>
        {config && (
          <button
            onClick={handleRemove}
            disabled={busy}
            title="Remove the coach configuration and hide the coach"
            className="ml-auto rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/30"
          >
            Remove
          </button>
        )}
      </div>

      <p className="text-xs text-gray-400">
        <strong>Verify</strong> tests these settings without saving.{" "}
        <strong>{config ? "Save & verify" : "Connect"}</strong> tests them and, if they work, saves
        the configuration so the coach becomes available.
      </p>
    </div>
  )
}
