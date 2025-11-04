export type PublicField = { label: string; value: string };

export function bankToPublicFields(bank: any): PublicField[] {
  // Defaults match the superAdmin editor; can be overridden via fields.core.*.label
  const CORE_DEFAULT = {
    holderName: "Account Holder Name",
    bankName:   "Bank Name",
    accountNo:  "Account / PayID Value",
    iban:       "IBAN",
    label:      "Label",
  } as const;

  const DEFAULT_CORE_ORDER: Record<string, number> = {
    holderName: 10,
    bankName: 20,
    accountNo: 30,
    iban: 40,
    label: 50,
  };

  const cfg = (bank?.fields || {}) as any;
  const core = cfg.core || {};
  const extras = Array.isArray(cfg.extra) ? cfg.extra : [];

  const coreLabel = (k: string) => {
    const custom = core?.[k]?.label;
    if (typeof custom === "string" && custom.trim()) return String(custom);
    if (k in CORE_DEFAULT) return (CORE_DEFAULT as any)[k];
    // Fallback prettify for unknown core/promoted keys
    return String(k)
      .replace(/[_\-]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const coreVisibleDefault = (k: string) => (k === "iban" ? false : true);

  type Item = { order: number; label: string; value: string };

  const items: Item[] = [];

  // Gather known core keys first (respect visibility + custom labels)
  (["holderName","bankName","accountNo","iban","label"] as const).forEach((k) => {
    const vis = (core?.[k]?.visible ?? coreVisibleDefault(k));
    const val = bank?.[k];
    if (!vis) return;
    if (val === undefined || val === null || String(val) === "") return;
    const order = Number(core?.[k]?.order ?? DEFAULT_CORE_ORDER[k] ?? 999);
    items.push({ order, label: coreLabel(k), value: String(val) });
  });

  // Any additional core keys configured (promoted columns) that map to real columns on the row
  let unknownCounter = 0;
  Object.keys(core)
    .filter((k) => !(k in CORE_DEFAULT))
    .forEach((k) => {
      const vis = (core?.[k]?.visible ?? coreVisibleDefault(k));
      const val = bank?.[k];
      if (!vis) return;
      if (val === undefined || val === null || String(val) === "") return;
      const order = Number(core?.[k]?.order ?? 1000 + (unknownCounter++));
      items.push({ order, label: coreLabel(k), value: String(val) });
    });

  // Extra fields — only visible ones; order respected
  extras
    .filter((e: any) => e && e.visible)
    .forEach((e: any, i: number) => {
      const order = Number(e.order ?? 10000 + i);
      items.push({
        order,
        label: String(e.label || e.key),
        value: String(e.value ?? ""),
      });
    });

  // Unified sort by order asc; stable by label to break ties
  items.sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label));

  // Emit label/value only
  return items.map(({ label, value }) => ({ label, value }));
}