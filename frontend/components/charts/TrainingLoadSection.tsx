"use client";

import { useState } from "react";

import { EChart } from "@/components/charts/EChart";
import { trainingLoadDetailChart } from "@/components/charts/options";
import type { TrainingLoadAnalysis } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  green: "text-green-600",
  red: "text-red-600",
  yellow: "text-yellow-600",
  orange: "text-orange-500",
  neutral: "text-gray-900 dark:text-gray-100",
};

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex cursor-help" aria-label={text}>
      <svg
        className="h-3.5 w-3.5 text-gray-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-gray-700">
        {text}
      </span>
    </span>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tip,
  colorClass,
}: {
  label: string;
  value: string;
  sub: string;
  tip?: string;
  colorClass?: string;
}) {
  return (
    <div className="card flex flex-col gap-1 p-3">
      <span className="card-title flex items-center text-xs">
        {label}
        {tip && <InfoTip text={tip} />}
      </span>
      <span className={`text-xl font-bold ${colorClass ?? "text-gray-900 dark:text-gray-100"}`}>
        {value}
      </span>
      <span className="text-[11px] text-gray-400">{sub}</span>
    </div>
  );
}

function DetailModal({
  analysis,
  onClose,
}: {
  analysis: TrainingLoadAnalysis;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-5xl overflow-hidden">
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <h2 className="text-lg font-semibold">
            Training Load Analysis ({analysis.display_days}-day history)
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="p-5">
          <EChart option={trainingLoadDetailChart(analysis)} height={400} />
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard
              label="CTL (Fitness)"
              value={String(analysis.ctl)}
              sub="42-day fitness trend"
              tip="Chronic Training Load — exponentially weighted average of daily training load over 42 days. Higher = fitter baseline."
              colorClass={STATUS_COLORS.neutral}
            />
            <MetricCard
              label="ATL (Fatigue)"
              value={String(analysis.atl)}
              sub="7-day fatigue level"
              tip="Acute Training Load — exponentially weighted average over 7 days. Reflects recent training stress."
              colorClass={STATUS_COLORS.neutral}
            />
            <MetricCard
              label="TSB (Form)"
              value={String(analysis.tsb)}
              sub={analysis.tsb_status}
              tip="Training Stress Balance = CTL − ATL. Positive means fresh, negative means fatigued. Best race form at +10 to +25."
              colorClass={STATUS_COLORS[analysis.tsb_color] ?? STATUS_COLORS.neutral}
            />
            <MetricCard
              label="A:C Ratio"
              value={String(analysis.ac_ratio)}
              sub={analysis.ac_status}
              tip="Acute-to-Chronic ratio (ATL/CTL). Optimal range 0.8–1.3. Above 1.3 = injury risk, below 0.8 = under-training."
              colorClass={STATUS_COLORS[analysis.ac_color] ?? STATUS_COLORS.neutral}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function TrainingLoadSection({
  analysis,
}: {
  analysis: TrainingLoadAnalysis;
}) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="card-title">Training Load Analysis</h2>
          <button
            onClick={() => setShowDetail(true)}
            className="text-sm font-medium text-brand hover:underline"
          >
            View details
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard
            label="CTL (Fitness)"
            value={String(analysis.ctl)}
            sub="42-day fitness trend"
            tip="Chronic Training Load — exponentially weighted average of daily training load over 42 days."
          />
          <MetricCard
            label="ATL (Fatigue)"
            value={String(analysis.atl)}
            sub="7-day fatigue level"
            tip="Acute Training Load — exponentially weighted average over 7 days."
          />
          <MetricCard
            label="TSB (Form)"
            value={String(analysis.tsb)}
            sub={analysis.tsb_status}
            tip="Training Stress Balance = CTL − ATL. Positive = fresh, negative = fatigued."
            colorClass={STATUS_COLORS[analysis.tsb_color] ?? STATUS_COLORS.neutral}
          />
          <MetricCard
            label="A:C Ratio"
            value={String(analysis.ac_ratio)}
            sub={analysis.ac_status}
            tip="Acute-to-Chronic ratio. Optimal 0.8–1.3."
            colorClass={STATUS_COLORS[analysis.ac_color] ?? STATUS_COLORS.neutral}
          />
          <MetricCard
            label="Rest Days"
            value={`${analysis.rest_days} / 7`}
            sub="Rest days in last 7 days"
          />
          <MetricCard
            label="Monotony"
            value={String(analysis.monotony)}
            sub={analysis.monotony < 1.5 ? "Good training variety" : analysis.monotony < 2 ? "Moderate variety" : "Low variety – risk"}
            tip="Standard deviation of last 7 days of load divided by the mean. Below 1.5 = good variety. Above 2.0 = injury risk."
            colorClass={
              analysis.monotony < 1.5
                ? STATUS_COLORS.green
                : analysis.monotony < 2
                  ? STATUS_COLORS.yellow
                  : STATUS_COLORS.red
            }
          />
          <MetricCard
            label="Weekly Strain"
            value={String(analysis.strain)}
            sub="Overall weekly training stress"
            tip="Weekly load × monotony. High strain with high monotony increases overtraining risk."
          />
          <MetricCard
            label="Weekly TRIMP"
            value={String(analysis.weekly_trimp)}
            sub="Last 7 days training load"
            tip="Sum of daily training load (TRIMP/TSS) over the last 7 days."
          />
        </div>
      </div>

      {showDetail && (
        <DetailModal analysis={analysis} onClose={() => setShowDetail(false)} />
      )}
    </>
  );
}
