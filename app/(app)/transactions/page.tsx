"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Popover } from "@/components/ui";

type Columns = {
  date: boolean;
  description: boolean;
  debit: boolean;
  credit: boolean;
  balance: boolean;
  reference: boolean;
  transactionId: boolean;
  identifier: boolean;
};

const defaultColumns: Columns = {
  date: true,
  description: true,
  debit: true,
  credit: true,
  balance: true,
  reference: false,
  transactionId: false,
  identifier: false,
};

const TYPES = [
  "Direct Debit",
  "Direct Credit",
  "NPP Direct Credit",
  "BPay Out",
  "NPP Receivable",
  "DE Receivable",
  "DE Direct Debit",
  "BPay Receivable",
];

export default function TransactionsPage() {
  // UI state only; data is intentionally empty (to be wired later)
  const [query, setQuery] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [cols, setCols] = useState<Columns>(defaultColumns);

  // figure out /sandbox prefix so links go to the right env
  const pathname = usePathname() || "/";
  const envPrefix = useMemo(() => (pathname.startsWith("/sandbox") ? "/sandbox" : ""), [pathname]);

  function toggleType(t: string) {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-semibold">Transactions</h1>

        {/* Top-right New payment */}
        <Link
          href={`${envPrefix}/payments/new/single`}
          className="inline-flex items-center gap-2 bg-[#6d44c9] rounded-lg h-9 px-3 text-sm"
        >
          + New payment
        </Link>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transactions..."
          className="w-full h-9 bg-panel border border-outline/40 rounded-lg px-3 text-sm placeholder:text-subt/70"
          aria-label="Search transactions"
        />

        {/* Edit columns */}
        <Popover
          align="right"
          button={() => (
            <button className="inline-flex items-center gap-2 bg-panel border border-outline/40 rounded-lg px-3 h-9 text-sm">
              ⚙️ Edit columns
            </button>
          )}
          className="w-[260px]"
        >
          <div className="text-sm space-y-2">
            {([
              ["date", "Date"],
              ["description", "Description"],
              ["debit", "Debit"],
              ["credit", "Credit"],
              ["balance", "Balance"],
              ["reference", "Reference"],
              ["transactionId", "Transaction ID"],
              ["identifier", "Identifier"],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={cols[key]}
                  onChange={() => setCols((c) => ({ ...c, [key]: !c[key] } as Columns))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </Popover>

        {/* Export (no-op for now) */}
        <button className="inline-flex items-center gap-2 bg-panel border border-outline/40 rounded-lg px-3 h-9 text-sm">
          ⬇️ Export
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 mt-3 text-sm">
        <span className="px-2 py-1 rounded bg-panel border border-outline/40">Date</span>

        <Popover
          open={dateOpen}
          onOpenChange={setDateOpen}
          button={() => (
            <button className="inline-flex items-center gap-2 px-2 py-1 rounded bg-panel border border-outline/40">
              Last 7 days ▾
            </button>
          )}
          className="w-[260px]"
        >
          {/* dummy date panel for now */}
          <div className="space-y-2 text-sm">
            <div className="text-subt">Filter by Date</div>
            <select className="w-full h-9 bg-surface border border-outline/40 rounded-lg px-2 text-sm">
              <option>Last 7 days</option>
              <option>Last 30 days</option>
              <option>Last 90 days</option>
              <option>This month</option>
              <option>Last month</option>
              <option>Custom (coming soon)</option>
            </select>
            <button
              onClick={() => setDateOpen(false)}
              className="w-full bg-[#6d44c9] rounded-lg h-9 text-sm"
            >
              Apply
            </button>
          </div>
        </Popover>

        <span className="px-2 py-1 rounded bg-panel border border-outline/40">Type</span>

        <Popover
          open={typeOpen}
          onOpenChange={setTypeOpen}
          button={() => (
            <button className="inline-flex items-center gap-2 px-2 py-1 rounded bg-panel border border-outline/40">
              + Add filter
            </button>
          )}
          className="w-[340px]"
        >
          <div className="text-sm space-y-2">
            <div className="text-subt">Filter by Type</div>
            <div className="max-h-56 overflow-auto pr-1 space-y-1">
              {TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes(t)}
                    onChange={() => toggleType(t)}
                  />
                  <span>{t}</span>
                </label>
              ))}
            </div>
            <button
              onClick={() => setTypeOpen(false)}
              className="w-full bg-[#6d44c9] rounded-lg h-9 text-sm"
            >
              Apply
            </button>
          </div>
        </Popover>
      </div>

      {/* Empty state panel (no data yet) */}
      <div className="bg-panel rounded-xl2 border border-outline/40 mt-4">
        {/* header row would go here when data is wired; for now empty */}
        <div className="px-6 py-16 text-center text-subt">
          <div className="mb-3 text-xl">↔︎</div>
          <div className="font-medium text-white">No transactions found</div>
          <div className="text-sm mt-1">
            Try changing the filters or creating a new payment.
          </div>

          <div className="mt-4">
            <Link
              href={`${envPrefix}/payments/new/single`}
              className="inline-flex items-center justify-center bg-surface border border-outline/40 rounded-lg h-9 px-4 text-sm"
            >
              + New payment
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
