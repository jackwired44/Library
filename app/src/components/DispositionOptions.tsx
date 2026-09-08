// The <option> list for every disposition <select> in the app, grouped
// into Jack's two buckets: did we reach the person, or not. One shared
// component so the three pickers (Scanner's per-row and bulk selectors,
// the Lead Library's per-lead editor) can't drift apart in either order
// or grouping.
//
// The grouping is not cosmetic — a "Reached them" outcome ends that
// contact's active sequences (see lib/sequences.ts's
// isTerminalDisposition), so seeing which bucket you're picking from
// matters at the moment you pick.
import { groupedDispositionOptions, type CustomDisposition } from "../lib/dispositions";
import { DISPOSITION_GROUP_LABEL } from "../lib/detection";

export default function DispositionOptions({ dispositions }: { dispositions: CustomDisposition[] }) {
  const { none, reached, notReached } = groupedDispositionOptions(dispositions);
  return (
    <>
      {none.map((o) => (
        <option key={o.key} value={o.key}>{o.label}</option>
      ))}
      <optgroup label={DISPOSITION_GROUP_LABEL.reached}>
        {reached.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </optgroup>
      <optgroup label={DISPOSITION_GROUP_LABEL["not-reached"]}>
        {notReached.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </optgroup>
    </>
  );
}
