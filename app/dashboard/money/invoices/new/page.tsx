"use client";
import { InvoiceBuilder } from "@/components/money/invoice-builder";

export default function NewInvoicePage({ searchParams }: { searchParams: { edit?: string; from?: string } }) {
  return <InvoiceBuilder editId={searchParams.edit} fromId={searchParams.from} />;
}
