export function formatJakartaDDMMYYYY_12h(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);

  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const raw = fmt.format(d);
  const [datePart, timePartRaw] = raw.split(",").map((s) => s.trim());
  const [DD, MM, YYYY] = (datePart || "").split("/");
  const timePart = (timePartRaw || "").toUpperCase();

  return `${DD}-${MM}-${YYYY}  ${timePart}`;
}
