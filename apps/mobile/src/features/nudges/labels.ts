import type { NudgeSettings } from '@life-os/core';

export const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** Subtitles shared by onboarding (0f) and Me → Nudges. */
export function nudgeSubtitles(n: NudgeSettings) {
  return {
    morningBriefing: `${n.morningBriefing.weekdayTime} weekdays, ${n.morningBriefing.weekendTime} weekends`,
    eveningCheckIn: n.eveningCheckIn.time,
    urgentBillAlerts: 'Bill due tomorrow',
    monthlyStatementImport: `${ordinal(n.monthlyStatementImport.dayOfMonth)} of the month, ${n.monthlyStatementImport.time}`,
  };
}
