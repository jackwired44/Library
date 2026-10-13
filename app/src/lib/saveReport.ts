// Where every row of a Save went.
//
// Per Jack: "i just saved 12k of them and only 10.6 saved." Rows and leads
// are different numbers on purpose — one person is one lead, however many
// rows they appear on — but a bare "Saved 10,600" next to "Save 12,000
// rows" reads as 1,400 lost. So the report accounts for every row:
//   rows = people in this upload + repeat rows + rows that name nobody
// and splits the people into new vs already stored.
export interface SaveReport {
  /** Rows handed to Save. */
  rows: number;
  /** Distinct people (lead keys) among them. */
  stored: number;
  /** Rows that were the same person as an earlier row in this upload —
   *  same email, or same first name + company when there is no email. */
  repeats: number;
  /** Rows with no email, company, phone or full name — nobody to store. */
  unkeyable: number;
  /** People not in All leads before this save. */
  added: number;
  /** People already in All leads; their record was updated, not duplicated. */
  updated: number;
  /** Stored as Bad Lead because they are not a fit. */
  discarded: number;
}

export function saveReportText(r: SaveReport): string {
  const bits = [`✓ ${r.rows.toLocaleString()} rows → ${r.stored.toLocaleString()} lead${r.stored === 1 ? "" : "s"} in All leads`];
  bits.push(`${r.added.toLocaleString()} new · ${r.updated.toLocaleString()} already stored, updated`);
  if (r.repeats) bits.push(`${r.repeats.toLocaleString()} row${r.repeats === 1 ? " was" : "s were"} the same person again`);
  if (r.unkeyable) bits.push(`${r.unkeyable.toLocaleString()} named nobody (no email, company, phone or full name)`);
  if (r.discarded) bits.push(`${r.discarded.toLocaleString()} marked Bad Lead (not a fit)`);
  return bits.join(" · ");
}
