"use client";
import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
};

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  searchKeys,
  searchPlaceholder = "Search...",
  toolbar,
  onRowClick,
}: {
  columns: Column<T>[];
  data: T[];
  searchKeys?: string[];
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
  onRowClick?: (row: T) => void;
}) {
  const [q, setQ] = React.useState("");
  const filtered = React.useMemo(() => {
    if (!q || !searchKeys) return data;
    const lower = q.toLowerCase();
    return data.filter((row: any) =>
      searchKeys.some((k: any) => String(row[k] ?? "").toLowerCase().includes(lower))
    );
  }, [q, data, searchKeys]);

  return (
    <Card>
      {(searchKeys || toolbar) && (
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          {searchKeys ? (
            <div className="relative max-w-xs flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="pl-9" />
            </div>
          ) : (
            <div />
          )}
          {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
        </div>
      )}
      {/* Below 640px each row becomes a stacked card: first column as the title, the
          other columns as label/value pairs, and header-less columns (row actions) as a footer. */}
      <ul className="divide-y sm:hidden" aria-label="Results">
        {filtered.map((row, i) => {
          const [first, ...rest] = columns;
          const actions = rest.filter((c) => !c.header);
          const fields = rest.filter((c) => c.header);
          const cell = (c: Column<T>) => (c.render ? c.render(row) : String(row[c.key] ?? ""));
          return (
            <li
              key={row.id ?? i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`space-y-2 p-4 ${onRowClick ? "cursor-pointer active:bg-accent/40" : ""}`}
            >
              {first && <div className="flex items-center gap-2 text-sm font-medium">{cell(first)}</div>}
              {fields.length > 0 && (
                <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                  {fields.map((c) => (
                    <React.Fragment key={c.key}>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{c.header}</dt>
                      <dd className="min-w-0 break-words text-right">{cell(c)}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              )}
              {actions.length > 0 && <div className="flex flex-wrap justify-end gap-2 pt-1">{actions.map((c) => <React.Fragment key={c.key}>{cell(c)}</React.Fragment>)}</div>}
            </li>
          );
        })}
        {filtered.length === 0 && <li className="py-10 text-center text-sm text-muted-foreground">No results found.</li>}
      </ul>
      <div className="hidden sm:block">
      <Table>
        <TableHeader>
          <TableRow className="border-border/50 hover:bg-transparent">
            {columns.map((c: any) => (
              <TableHead key={c.key} className={`text-[11px] font-semibold uppercase tracking-wider text-muted-foreground ${c.className ?? ""}`}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row, i) => (
            <TableRow
              key={row.id ?? i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-border/40 transition-colors hover:bg-accent/40 ${onRowClick ? "cursor-pointer" : ""}`}
            >
              {columns.map((c: any) => (
                <TableCell key={c.key} className={c.className}>
                  {c.render ? c.render(row) : String(row[c.key] ?? "")}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length} className="py-10 text-center text-sm text-muted-foreground">
                No results found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>
    </Card>
  );
}
