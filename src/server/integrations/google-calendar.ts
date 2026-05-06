import { google } from "googleapis";
import { getGoogleAuth } from "../auth/google.js";

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  durationMinutes: number;
  isFocus: boolean;
  isAllDay: boolean;
  isCreatedToday: boolean;
  responseStatus: "accepted" | "declined" | "tentative" | "needsAction" | null;
  attendeeCount: number;
  meetUrl: string | null;
  htmlLink: string;
  badges: ("new" | "respond" | "tentative" | "declined" | "focus")[];
  sourceColor: string | null;
  sourceLabel: string | null;
};

export type CalendarConfig = {
  calendarId: string;
  color: string | null;
  label: string | null;
};

const SKIP_TYPES = new Set(["birthday", "workingLocation", "fromGmail"]);

export async function listCalendarEvents(
  identityId: string | null,
  calConfig: CalendarConfig,
  startIso: string,
  endIso: string,
): Promise<CalendarEvent[]> {
  const auth = await getGoogleAuth(identityId);
  const cal  = google.calendar({ version: "v3", auth });

  const res = await cal.events.list({
    calendarId:  calConfig.calendarId,
    timeMin:     startIso,
    timeMax:     endIso,
    singleEvents: true,
    orderBy:     "startTime",
    maxResults:  100,
  });

  const items    = res.data.items || [];
  const todayIso = new Date().toISOString().slice(0, 10);

  return items
    .filter(e => !e.eventType || !SKIP_TYPES.has(e.eventType))
    .map(e => normalize(e, todayIso, calConfig))
    .filter(Boolean) as CalendarEvent[];
}

function normalize(
  e: any,
  todayIso: string,
  source: CalendarConfig,
): CalendarEvent | null {
  const start = e.start?.dateTime || e.start?.date;
  const end   = e.end?.dateTime   || e.end?.date;
  if (!start || !end) return null;

  const isAllDay = !e.start?.dateTime;
  const startMs  = new Date(start).getTime();
  const endMs    = new Date(end).getTime();
  const durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000));

  const me             = (e.attendees || []).find((a: any) => a.self);
  const responseStatus = me?.responseStatus || null;
  const attendeeCount  = (e.attendees || []).filter((a: any) => !a.resource && !a.self).length;
  const isFocus        = e.eventType === "focusTime" || /\bfocus\b/i.test(e.summary || "");
  const meetUrl        = extractMeetUrl(e);
  const createdIso     = e.created ? new Date(e.created).toISOString().slice(0, 10) : null;
  const isCreatedToday = createdIso === todayIso;

  const badges: CalendarEvent["badges"] = [];
  if (isCreatedToday)                      badges.push("new");
  if (responseStatus === "needsAction")    badges.push("respond");
  if (responseStatus === "tentative")      badges.push("tentative");
  if (responseStatus === "declined")       badges.push("declined");
  if (isFocus)                             badges.push("focus");

  return {
    id:             e.id,
    title:          e.summary || "(untitled)",
    start:          new Date(start).toISOString(),
    end:            new Date(end).toISOString(),
    durationMinutes,
    isFocus,
    isAllDay,
    isCreatedToday,
    responseStatus,
    attendeeCount,
    meetUrl,
    htmlLink:       e.htmlLink || "",
    badges,
    sourceColor:    source.color,
    sourceLabel:    source.label,
  };
}

function extractMeetUrl(e: any): string | null {
  if (e.hangoutLink) return e.hangoutLink;
  const entry = e.conferenceData?.entryPoints?.find((p: any) => p.entryPointType === "video");
  if (entry?.uri) return entry.uri;
  if (e.location && /https?:\/\/(zoom\.us|meet\.google\.com|teams\.microsoft\.com)/i.test(e.location)) {
    const m = e.location.match(/https?:\/\/\S+/);
    return m ? m[0] : null;
  }
  if (e.description) {
    const m = e.description.match(
      /https?:\/\/(?:[^\s<"]*\.)?(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com)\/\S+/i,
    );
    return m ? m[0] : null;
  }
  return null;
}
