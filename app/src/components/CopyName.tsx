import { useState } from "react";

/** Copies text to the clipboard, falling back to execCommand inside the
 *  sandboxed artifact frame, where navigator.clipboard can be refused. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* sandboxed frame: fall back */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

/** ⧉ beside a contact's name: copies "First Last", nothing else. Per Jack:
 *  "copy first last name if i want to one by one". Shows ✓ for a moment. */
export default function CopyName({ name }: { name: string }) {
  const [done, setDone] = useState(false);
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return (
    <button type="button" className="copy-name" aria-label={`Copy ${clean}`} title={`Copy "${clean}"`}
            onClick={async (e) => {
              e.stopPropagation();
              if (await copyText(clean)) { setDone(true); setTimeout(() => setDone(false), 1200); }
            }}>{done ? "✓" : "⧉"}</button>
  );
}
