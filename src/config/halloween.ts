const warsawCalendar = new Intl.DateTimeFormat("en", {
  timeZone: "Europe/Warsaw",
  month: "numeric",
  day: "numeric",
});

/** Keep the seasonal decoration limited to October 25 through November 2 in Poland. */
export function isHalloweenSeason(date = new Date()): boolean {
  if (Number.isNaN(date.getTime())) return false;
  const parts = warsawCalendar.formatToParts(date);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return (month === 10 && day >= 25) || (month === 11 && day <= 2);
}
