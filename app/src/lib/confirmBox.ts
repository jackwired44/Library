/** "Are you sure?" that works inside the claude.ai artifact frame.
 *
 *  Per Jack: "make sure the delete button works in lists". The artifact
 *  frame blocks the browser's own confirm() popup, and a blocked confirm()
 *  answers false at once, so every Delete read as Cancel and nothing
 *  happened. The browser popup is still used where it works (the local
 *  bundle, the test browser); when it comes back false faster than anyone
 *  could click, it was blocked, and the same question is asked in the page
 *  instead. */
export async function confirmAction(message: string, okLabel = "OK"): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const t = performance.now();
    if (window.confirm(message)) return true;
    if (performance.now() - t > 60) return false; // a person clicked Cancel
  } catch { /* blocked: ask in the page */ }
  return askInPage(message, okLabel);
}

function askInPage(message: string, okLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "name-file-backdrop";
    wrap.innerHTML = `
      <div class="name-file" role="alertdialog" aria-modal="true" aria-label="Confirm">
        <div class="name-file-msg"></div>
        <div class="name-file-actions">
          <button type="button" class="btn btn-sm btn-ghost" data-act="cancel">Cancel</button>
          <button type="button" class="btn btn-sm btn-primary" data-act="ok"></button>
        </div>
      </div>`;
    wrap.querySelector<HTMLElement>(".name-file-msg")!.textContent = message;
    const ok = wrap.querySelector<HTMLButtonElement>('[data-act="ok"]')!;
    ok.textContent = okLabel;
    const done = (v: boolean) => { wrap.remove(); resolve(v); };
    wrap.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest("[data-act]")?.getAttribute("data-act");
      if (act === "ok") done(true);
      else if (act === "cancel" || e.target === wrap) done(false);
    });
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(true); }
      else if (e.key === "Escape") { e.preventDefault(); done(false); }
    });
    document.body.appendChild(wrap);
    ok.focus();
  });
}
