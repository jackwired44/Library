// A small green "On CRM" badge — per Jack, a way to mark a contact as
// already logged in the real CRM (Dynamics 365/HubSpot), separate from
// disposition/outreachStatus. Uses the app's brand accent green rather
// than a status color, since this is a tracking marker ("handled"), not
// a lead-qualification signal. Shared by Scanner.tsx, Contacts.tsx, and
// Companies.tsx — same pattern as BookedStamp.
export default function OnCrmBadge() {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 9.5,
        fontWeight: 800,
        color: "#0B7A56",
        background: "#E1F5EC",
        border: "1px solid #A9E4CC",
        borderRadius: 999,
        padding: "1px 7px",
        letterSpacing: 0.3,
        whiteSpace: "nowrap",
      }}
    >
      ✓ On CRM
    </span>
  );
}
