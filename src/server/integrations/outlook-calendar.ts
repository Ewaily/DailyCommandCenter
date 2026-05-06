import { getMicrosoftToken } from "../auth/microsoft.js";
import type { CalendarEvent } from "./google-calendar.js";
import { getIdentity } from "../lib/workspace-config.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function graphGet(path: string, accessToken: string): Promise<any> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Graph API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function listOutlookCalendarEvents(
  identityId: string,
  startIso: string,
  endIso: string,
): Promise<CalendarEvent[]> {
  const token  = await getMicrosoftToken(identityId);
  const identity = getIdentity(identityId);
  const sourceColor = identity?.displayColor ?? "#0078D4";
  const sourceLabel = identity?.label ?? identity?.account ?? "Outlook";

  const params = new URLSearchParams({
    startDateTime: startIso,
    endDateTime:   endIso,
    $select:       "id,subject,start,end,isAllDay,responseStatus,attendees,onlineMeeting,webLink,bodyPreview,createdDateTime",
    $orderby:      "start/dateTime",
    $top:          "100",
  });

  const data = await graphGet(`/me/calendarView?${params}`, token);
  const items: any[] = data.value || [];
  const todayIso = new Date().toISOString().slice(0, 10);

  return items.map(e => normalizeOutlook(e, todayIso, sourceColor, sourceLabel)).filter(Boolean) as CalendarEvent[];
}

function normalizeOutlook(
  e: any,
  todayIso: string,
  sourceColor: string,
  sourceLabel: string,
): CalendarEvent | null {
  const startStr = e.start?.dateTime ?? e.start?.date;
  const endStr   = e.end?.dateTime   ?? e.end?.date;
  if (!startStr || !endStr) return null;

  const isAllDay = !!e.isAllDay;
  const startMs = new Date(startStr).getTime();
  const endMs   = new Date(endStr).getTime();
  const durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000));

  const responseStatus = mapResponseStatus(e.responseStatus?.response);
  const attendeeCount  = (e.attendees ?? []).filter((a: any) => a.type !== "resource" && !a.emailAddress?.name?.match(/room|resource/i)).length;

  const isFocus = /\bfocus\b/i.test(e.subject || "");
  const meetUrl = e.onlineMeeting?.joinUrl ?? extractLinkFromBody(e.bodyPreview ?? "");

  const createdIso = e.createdDateTime ? new Date(e.createdDateTime).toISOString().slice(0, 10) : null;
  const isCreatedToday = createdIso === todayIso;

  const badges: CalendarEvent["badges"] = [];
  if (isCreatedToday) badges.push("new");
  if (responseStatus === "needsAction") badges.push("respond");
  if (responseStatus === "tentative")   badges.push("tentative");
  if (responseStatus === "declined")    badges.push("declined");
  if (isFocus)                          badges.push("focus");

  return {
    id:             `outlook-${e.id}`,
    title:          e.subject || "(untitled)",
    start:          new Date(startStr).toISOString(),
    end:            new Date(endStr).toISOString(),
    durationMinutes,
    isFocus,
    isAllDay,
    isCreatedToday,
    responseStatus,
    attendeeCount,
    meetUrl,
    htmlLink:       e.webLink ?? "",
    badges,
    sourceColor,
    sourceLabel,
  };
}

function mapResponseStatus(r?: string): CalendarEvent["responseStatus"] {
  if (!r) return null;
  const map: Record<string, CalendarEvent["responseStatus"]> = {
    accepted:        "accepted",
    declined:        "declined",
    tentativelyAccepted: "tentative",
    notResponded:    "needsAction",
    none:            null,
    organizer:       "accepted",
  };
  return map[r] ?? null;
}

function extractLinkFromBody(body: string): string | null {
  const m = body.match(/https?:\/\/(?:[^\s<"]*\.)?(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com)\/\S+/i);
  return m ? m[0] : null;
}
