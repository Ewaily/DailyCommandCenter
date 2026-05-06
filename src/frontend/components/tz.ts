let primaryTz = "Africa/Cairo";

export function setPrimaryTz(tz: string): void {
  if (tz) primaryTz = tz;
}

export function getPrimaryTz(): string {
  return primaryTz;
}
