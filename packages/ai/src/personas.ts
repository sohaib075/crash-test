import { z } from "zod";
import { askJson } from "./llm";

export type Persona = { firstName: string; lastName: string; company: string; title: string };

const POOL: Persona[] = [
  { firstName: "Dana", lastName: "Okafor", company: "Northwind Logistics", title: "VP Operations" },
  { firstName: "Daniel", lastName: "Reyes", company: "Brightline Health", title: "Head of RevOps" },
  { firstName: "Aisha", lastName: "Khan", company: "Quanta Retail", title: "Director of Sales" },
  { firstName: "Tom", lastName: "Lindqvist", company: "Fjord Analytics", title: "CTO" },
  { firstName: "Priya", lastName: "Natarajan", company: "Helio Fintech", title: "Growth Lead" },
  { firstName: "Lucas", lastName: "Moreau", company: "Atelier Systems", title: "COO" },
  { firstName: "Mei", lastName: "Tanaka", company: "Kinto Labs", title: "Sales Ops Manager" },
  { firstName: "Omar", lastName: "Haddad", company: "Cedar Freight", title: "Head of Growth" },
];

const Schema = z.array(z.object({ firstName: z.string().min(1), lastName: z.string().min(1), company: z.string().min(1), title: z.string().min(1) }));

export async function personas(n: number, context: string): Promise<{ list: Persona[]; source: string }> {
  const r = await askJson(
    "personas",
    Schema,
    `Write ${n} distinct, realistic but fictional B2B buyer personas (no real brands) who fit these outbound sequences:\n${context}`,
    () => POOL.slice(0, n),
  );
  const list = r.value.slice(0, n);
  while (list.length < n) list.push(POOL[list.length % POOL.length]);
  return { list, source: r.source };
}
