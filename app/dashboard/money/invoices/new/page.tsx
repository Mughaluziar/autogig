"use client";;
import { use } from "react";
import { InvoiceBuilder } from "@/components/money/invoice-builder";

export default function NewInvoicePage(props: { searchParams: Promise<{ edit?: string; from?: string }> }) {
  const searchParams = use(props.searchParams);
  return <InvoiceBuilder editId={searchParams.edit} fromId={searchParams.from} />;
}
