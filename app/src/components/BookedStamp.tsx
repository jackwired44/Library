// A small red "BOOKED" stamp shown above a lead/contact's name or company
// when their disposition is Meeting booked — per Jack, "like a stamp."
// Deliberately red (not the disposition's own blue) so it reads as a
// distinct marker, not a restatement of the row/badge color already
// showing the same status. Shared by Scanner.tsx, Contacts.tsx, and
// Companies.tsx for the same treatment wherever a lead/contact shows up.
export default function BookedStamp() {
  return (
    <div
      style={{
        display: "inline-block",
        fontSize: 9.5,
        fontWeight: 800,
        color: "#B5443B",
        border: "1px solid #B5443B",
        borderRadius: 3,
        padding: "0 4px",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        marginBottom: 2,
        transform: "rotate(-3deg)",
      }}
    >
      Booked
    </div>
  );
}
