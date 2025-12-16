"use client";

import { ComponentType, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Popover } from "@/components/ui";

type ColKey =
  | "date"
  | "description"
  | "debit"
  | "credit"
  | "balance"
  | "reference"
  | "transactionId"
  | "identifier";

const allColumns: Record<ColKey, string> = {
  date: "Date",
  description: "Description",
  debit: "Debit",
  credit: "Credit",
  balance: "Balance",
  reference: "Reference",
  transactionId: "Transaction ID",
  identifier: "Identifier",
};

const typeOptions = [
  "Direct Debit",
  "Direct Credit",
  "NPP Direct Credit",
  "BPay Out",
  "NPP Receivable",
  "DE Receivable",
  "DE Direct Debit",
  "BPay Receivable",
] as const;

type TxType = (typeof typeOptions)[number];

function monthDays(year: number, monthIndex: number) {
  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0).getDate();
  const prefix = first.getDay();
  const days = Array(prefix).fill(null).concat([...Array(last)].map((_, i) => i + 1));
  while (days.length % 7) days.push(null);
  while (days.length < 42) days.push(null);
  return days;
}

export default function TransactionsPage() {
  const data: any[] = [];
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<"Last 7 days" | "Custom">("Last 7 days");
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [start, setStart] = useState<Date | null>(null);
  const [end, setEnd] = useState<Date | null>(null);
  const [pickedTypes, setPickedTypes] = useState<TxType[]>([]);
  const [cols, setCols] = useState<Record<ColKey, boolean>>({
    date: true,
    description: true,
    debit: true,
    credit: true,
    balance: true,
    reference: false,
    transactionId: false,
    identifier: false,
  });
  const [NewPaymentMenu, setNewPaymentMenu] = useState<ComponentType | null>(null);
  const pathname = usePathname() || "/";
  const envPrefix = useMemo(() => (pathname.startsWith("/sandbox") ? "/sandbox" : ""), [pathname]);

  useEffect(() => {
    let mounted = true;
    import("@/components/payments/new-payment-menu")
      .then((mod) => {
        if (mounted) setNewPaymentMenu(() => mod.default);
      })
      .catch(() => {
        if (mounted) setNewPaymentMenu(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  function toggleType(t: TxType) {
    setPickedTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  function resetFilters() {
    setPreset("Last 7 days");
    setPickedTypes([]);
    setStart(null);
    setEnd(null);
    setYear(today.getFullYear());
    setMonth(today.getMonth());
  }

  const shownColumns = useMemo(
    () => (Object.keys(allColumns) as ColKey[]).filter((k) => cols[k]),
    [cols]
  );

  function NewPaymentButton() {
    if (NewPaymentMenu) return <NewPaymentMenu />;
    return (
      <Link
        href={`${envPrefix}/payments/new/single`}
        className="bg-[#6d44c9] rounded-lg h-9 px-3 inline-flex items-center text-sm"
      >
        + New payment
      </Link>
    );
  }

  const days = monthDays(year, month);

  return (
    <>
      <h1 className="text-2xl font-semibold mb-6">Transactions</h1>

      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search transactions..."
            className="w-full bg-panel border border-outline/40 rounded-lg h-9 px-3 text-sm placeholder:text-subt/70"
          />
        </div>

        <Popover
          button={() => (
            <button className="ml-3 inline-flex items-center gap-2 bg-panel border border-outline/40 rounded-lg px-3 h-9 text-sm">
              Date
              <span className="text-subt">
                {preset === "Custom" && start && end
                  ? `${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`
                  : "Last 7 days"}
              </span>
            </button>
          )}
          align="start"
          className="w-[320px]"
        >
          <div className="text-sm">
            <div className="mb-2">
              <label className="text-subt block mb-1">Filter by Date</label>
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as any)}
                className="w-full h-9 bg-surface border border-outline/40 rounded-lg px-2 text-sm"
              >
                <option>Last 7 days</option>
                <option>Custom</option>
              </select>
            </div>

            {preset === "Custom" && (
              <div className="bg-panel border border-outline/40 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-3">
                  <select
                    value={month}
                    onChange={(e) => setMonth(parseInt(e.target.value, 10))}
                    className="flex-1 h-9 bg-surface border border-outline/40 rounded-lg px-2"
                  >
                    {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => (
                      <option key={m} value={i}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <select
                    value={year}
                    onChange={(e) => setYear(parseInt(e.target.value, 10))}
                    className="w-[110px] h-9 bg-surface border border-outline/40 rounded-lg px-2"
                  >
                    {Array.from({ length: 7 }).map((_, i) => {
                      const y = today.getFullYear() - 3 + i;
                      return (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div className="grid grid-cols-7 gap-1 text-xs text-subt mb-2">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                    <div key={d} className="text-center">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {days.map((d, i) => (
                    <button
                      key={i}
                      disabled={!d}
                      onClick={() => {
                        const picked = new Date(year, month, Number(d));
                        if (!start || (start && end)) {
                          setStart(picked);
                          setEnd(null);
                        } else if (picked < start) {
                          setEnd(start);
                          setStart(picked);
                        } else {
                          setEnd(picked);
                        }
                      }}
                      className={`h-8 rounded text-sm ${
                        d
                          ? "bg-surface border border-outline/40 hover:bg-surface/80"
                          : "bg-transparent"
                      }`}
                    >
                      {d ?? ""}
                    </button>
                  ))}
                </div>

                <button className="mt-3 w-full h-9 rounded bg-[#6d44c9] text-sm">Apply</button>
              </div>
            )}
          </div>
        </Popover>

        <Popover
          button={() => (
            <button className="ml-2 inline-flex items-center gap-2 bg-panel border border-outline/40 rounded-lg px-3 h-9 text-sm">
              Type
            </button>
          )}
          align="start"
          className="w-[320px]"
        >
          <div className="text-sm">
            <div className="text-subt mb-2">Filter by Type</div>
            <div className="max-h-64 overflow-auto space-y-2 pr-1">
              {typeOptions.map((t) => (
                <label key={t} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={pickedTypes.includes(t)}
                    onChange={() => toggleType(t)}
                  />
                  <span>{t}</span>
                </label>
              ))}
            </div>
            <button className="mt-3 w-full h-9 rounded bg-[#6d44c9] text-sm">Apply</button>
          </div>
        </Popover>

        <button className="ml-2 inline-flex items-center gap-2 bg-panel border border-outline/40 rounded-lg px-3 h-9 text-sm">
          + Add filter
        </button>

        <button
          onClick={resetFilters}
          className="ml-2 inline-flex items-center gap-2 bg-panel border border-outline/40 rounded-lg px-3 h-9 text-sm"
        >
          Reset filters
        </button>

        <div className="flex-1" />

        <Popover
          button={() => (
            <button className="inline-flex items-center gap-2 bg-panel border border-outline/40 rounded-lg px-3 h-9 text-sm">
              ⚙️ Edit columns
            </button>
          )}
          align="end"
          className="w-[260px]"
        >
          <div className="text-sm space-y-2">
            {(Object.keys(allColumns) as ColKey[]).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={cols[k]}
                  onChange={() => setCols((c) => ({ ...c, [k]: !c[k] }))}
                />
                <span>{allColumns[k]}</span>
              </label>
            ))}
          </div>
        </Popover>

        <button className="ml-2 inline-flex items-center gap-2 bg-panel border border-outline/40 rounded-lg px-3 h-9 text-sm">
          ⬇️ Export
        </button>

        <div className="ml-2">
          <NewPaymentButton />
        </div>
      </div>

      <div className="bg-panel rounded-xl2 border border-outline/40 overflow-hidden">
        <div
          className="grid px-4 py-2 text-xs text-subt border-b border-outline/30"
          style={{ gridTemplateColumns: `repeat(${shownColumns.length}, minmax(0, 1fr))` }}
        >
          {shownColumns.map((k) => (
            <div key={k} className="uppercase tracking-wide">
              {allColumns[k]}
            </div>
          ))}
        </div>

        {data.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="text-2xl mb-2">↔︎</div>
            <div className="text-white font-medium">No transactions found</div>
            <div className="text-subt text-sm mt-1">
              Try changing the filters or creating a new payment.
            </div>
            <div className="mt-4">
              <NewPaymentButton />
            </div>
          </div>
        ) : (
          <div className="divide-y divide-outline/20"></div>
        )}
      </div>
    </>
  );
}
