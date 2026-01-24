"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mutate } from "swr";

import { importFromPath, uploadExport } from "@/lib/api";
import type { ImportResult } from "@/lib/types";

type Mode = "upload" | "path";

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const refreshData = useCallback(() => {
    // Revalidate every cached endpoint so the UI reflects the new import.
    mutate((key) => typeof key === "string" && key.startsWith("/api/"), undefined, {
      revalidate: true,
    });
  }, []);

  const runImport = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const importResult =
        mode === "upload" && file
          ? await uploadExport(file)
          : await importFromPath(path.trim());
      setResult(importResult);
      refreshData();
      // New data was imported: surface the summary briefly, then close automatically.
      // If everything was skipped (e.g. re-importing an old zip), keep the dialog
      // open so the user can read the skip count and dismiss it themselves.
      if (importResult.added > 0 || importResult.updated > 0) {
        closeTimer.current = setTimeout(onClose, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }, [mode, file, path, refreshData, onClose]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }, []);

  const canSubmit = mode === "upload" ? !!file : path.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-surface p-6 text-foreground shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Import Strava data</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 flex gap-1 rounded-lg bg-surface-muted p-1 text-sm">
          <button
            onClick={() => setMode("upload")}
            className={tabClass(mode === "upload")}
          >
            Upload .zip
          </button>
          <button onClick={() => setMode("path")} className={tabClass(mode === "path")}>
            Server path
          </button>
        </div>

        {mode === "upload" ? (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
              dragOver
                ? "border-brand bg-brand/5"
                : "border-gray-300 hover:border-brand dark:border-gray-600"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <span className="text-3xl">📦</span>
            <p className="mt-2 text-sm font-medium">
              {file ? file.name : "Drop your export_*.zip here or click to choose"}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              The archive from Strava → Settings → Download your account
            </p>
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">
              Path to export (.zip or folder) on the server
            </label>
            <input
              type="text"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              placeholder="/data/export_12345.zip"
              className="w-full rounded-lg border border-gray-300 bg-surface px-3 py-2 text-sm text-foreground placeholder:text-gray-400 focus:border-brand focus:outline-none dark:border-gray-600"
            />
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        {result && (
          <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/40 dark:text-green-300">
            Import complete - added <strong>{result.added}</strong>, updated{" "}
            <strong>{result.updated}</strong>, skipped <strong>{result.skipped}</strong>
            {result.deduped > 0 && (
              <>
                , de-duplicated <strong>{result.deduped}</strong>
              </>
            )}
            .
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              onClick={runImport}
              disabled={!canSubmit || busy}
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {busy && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              )}
              {busy ? "Importing…" : "Import"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function tabClass(active: boolean): string {
  return active
    ? "flex-1 rounded-md bg-surface px-3 py-1.5 font-medium shadow-sm"
    : "flex-1 rounded-md px-3 py-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100";
}
