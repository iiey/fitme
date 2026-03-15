"use client"

import type React from "react"

import { EmptyState } from "@/components/ui/States"
import type { ActivityProfile, ActivitySection } from "@/lib/activityProfiles"

import { SECTION_COMPONENTS, type SectionProps, sectionHasData } from "./sections"

// When both members are present and listed adjacently, a pair renders as a
// two-column row. The heart-rate trace sits beside the route map, and the
// heart-rate curve takes the column next to the HR zones.
const COLUMN_PAIRS: Partial<Record<ActivitySection, ActivitySection>> = {
  map: "heartRate",
  hrCurve: "hrZones",
  // Fallback for HR-only sports (no map, no curve): keep HR beside its zones.
  heartRate: "hrZones",
  pace: "paceZones",
  elevation: "power",
}

// Always-on sections (note panel, details) don't count toward "has any metric".
const ALWAYS_ON = new Set<ActivitySection>(["map", "details"])

interface RendererProps extends SectionProps {
  profile: ActivityProfile
}

export function ActivitySectionRenderer({ profile, ...sectionProps }: RendererProps) {
  const { activity } = sectionProps
  const hasAnyMetric = profile.sections.some(
    (s) => !ALWAYS_ON.has(s) && sectionHasData[s](activity),
  )

  const renderOne = (section: ActivitySection): React.ReactNode => {
    const Component = SECTION_COMPONENTS[section]
    return <Component key={section} {...sectionProps} />
  }

  const nodes: React.ReactNode[] = []
  const sections = profile.sections

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]

    // Show the empty-state notice in place of the (absent) metric sections,
    // just above the always-on Details card.
    if (section === "details" && !hasAnyMetric) {
      nodes.push(
        <EmptyState
          key="no-metrics"
          message={`No detailed metrics were recorded for this ${activity.sport_label} session.`}
        />,
      )
    }

    const partner = COLUMN_PAIRS[section]
    if (partner && sections[i + 1] === partner) {
      i++ // consume the partner regardless of whether it renders
      const leftHas = sectionHasData[section](activity)
      const rightHas = sectionHasData[partner](activity)
      if (leftHas && rightHas) {
        nodes.push(
          <div key={section} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {renderOne(section)}
            {renderOne(partner)}
          </div>,
        )
      } else if (leftHas) {
        nodes.push(renderOne(section))
      } else if (rightHas) {
        nodes.push(renderOne(partner))
      }
      continue
    }

    if (sectionHasData[section](activity)) {
      nodes.push(renderOne(section))
    }
  }

  return <div className="space-y-6">{nodes}</div>
}
