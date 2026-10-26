// Gifting records Jack asked to have loaded directly ("add these"), so
// they're in the Gifting folder the moment the app opens rather than
// waiting to be typed in. Same approach and same trade-off as the CRM deals
// seed (lib/crmSeed.ts): these addresses and phone numbers ship in the page
// source, visible to anyone the Artifact is shared with.
//
// Applied once per browser and only for companies with no gifting record
// yet — it never overwrites a record, and a record Jack later deletes
// does not come back (see App.tsx's seeding effect). Off in the test build,
// same flag as the CRM seed.
import { createGiftAccount, createPerson, type GiftAccount } from "./gifting";

export const GIFTING_SEED_FLAG = "giftingSeedApplied:v1";

export function giftingSeedAccounts(): GiftAccount[] {
  const out: GiftAccount[] = [];

  const sigma = createGiftAccount("Sigma Pi Phi Fraternity");
  if (sigma) {
    out.push({
      ...sigma,
      address: "260 Peachtree Street NW, Suite 1604, Atlanta, GA 30303",
      city: "Atlanta",
      state: "GA",
      deliveryNotes: "Courier contact: James, 330-807-7014",
      people: [createPerson({ name: "James", role: "Courier contact", phone: "330-807-7014" })],
    });
  }

  const inseption = createGiftAccount("inSeption Group");
  if (inseption) {
    out.push({
      ...inseption,
      address: "800 Adams Avenue, Suite 305, Audubon, PA 19403",
      city: "Audubon",
      state: "PA",
      people: [createPerson({ name: "Stacey Arcangelo", role: "Executive Assistant, Office Manager", phone: "267-421-5683" })],
    });
  }

  return out;
}
