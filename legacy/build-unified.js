const fs = require("fs");

const unifiedScript = fs.readFileSync("./unified-tool.js", "utf8");
// Inlined rather than loaded via <script src="cdnjs...">: keeps the whole
// platform working as one self-contained file with no runtime dependency
// on any CDN being reachable.
const papaParseLib = fs.readFileSync("./papaparse.min.js", "utf8");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Wired CIO Unified Lead Scanner</title>
<script>
${papaParseLib}
</script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: 'Hanken Grotesk', system-ui, -apple-system, "Segoe UI", sans-serif;
    background:
      radial-gradient(1100px 480px at 12% -8%, rgba(44,194,149,0.06), transparent 60%),
      radial-gradient(900px 420px at 100% 0%, rgba(122,90,224,0.04), transparent 55%),
      #F6FAFA;
    background-attachment: fixed;
    color: #081E22;
    -webkit-font-smoothing: antialiased;
    line-height: 1.45;
  }
  .lf-display { font-family: 'Fraunces', Georgia, "Times New Roman", serif; letter-spacing: -0.01em; }
  .lf-mono { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
  .lf-row { transition: background 0.12s ease; }
  .lf-row:hover { background: #F8FAF9; }
  .lf-row:nth-child(even) { background: rgba(20,30,40,0.012); }
  .lf-row:nth-child(even):hover { background: #F8FAF9; }
  .lf-btn { transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease, opacity 0.12s ease; cursor: pointer; }
  .lf-btn:hover:not(:disabled) { filter: brightness(0.96); }
  .lf-btn:active:not(:disabled) { transform: translateY(1px); }
  .lf-btn:disabled { cursor: not-allowed; }
  .wc-card { transition: box-shadow 0.15s ease, border-color 0.15s ease, transform 0.15s ease; }
  .wc-card-hover:hover { box-shadow: 0 4px 16px rgba(16,24,32,0.08); border-color: #D8DDE3; transform: translateY(-1px); }
  .lf-dropzone { transition: border-color 0.15s ease, background 0.15s ease; cursor: pointer; }
  ::-webkit-scrollbar { height: 8px; width: 8px; }
  ::-webkit-scrollbar-thumb { background: #D3D7DE; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #B9C0CA; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  input, select, button { font-family: inherit; }
  input:focus, select:focus { outline: 2px solid #A9C2B7; outline-offset: 1px; }
  input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid #7FAD91; outline-offset: 1px; }
  select { cursor: pointer; }
  @keyframes wc-modal-in {
    from { opacity: 0; transform: scale(0.97) translateY(6px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes wc-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .wc-modal-panel { animation: wc-modal-in 0.16s cubic-bezier(0.2, 0.8, 0.3, 1); }
  .wc-modal-backdrop { animation: wc-fade-in 0.14s ease; backdrop-filter: blur(2px); }

  #platform-nav {
    position: sticky;
    top: 0;
    z-index: 500;
    background:
      radial-gradient(120% 160% at 88% -40%, rgba(44,194,149,0.16), transparent 58%),
      linear-gradient(140deg, #0C4651 0%, #081E22 78%);
    color: #EAF0F1;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 13px 28px;
    box-shadow: 0 1px 0 rgba(255,255,255,0.07), 0 2px 10px rgba(0,0,0,0.22);
    border-bottom: 1px solid rgba(44,194,149,0.35);
  }
  #platform-nav .plat-brand-mark {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  #platform-nav .plat-brand-mark svg { width: 100%; height: 100%; }
  #platform-nav .plat-brand-text {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 700;
    font-size: 16.5px;
    letter-spacing: -0.01em;
  }
  #platform-nav .plat-brand-sub {
    font-size: 11.5px;
    color: #9FB8BC;
    font-weight: 500;
    letter-spacing: 0.01em;
  }
</style>
</head>
<body>

<div id="platform-nav">
  <div class="plat-brand-mark"><svg xmlns="http://www.w3.org/2000/svg" viewBox="430.11 118.66 584.32 584.32"><path fill="#2cc295" d="M 815.777344 478.105469 C 814.621094 480.734375 812.09375 482.417969 809.148438 482.417969 C 806.203125 482.417969 801.785156 479.683594 801.785156 475.15625 L 801.785156 322.5 C 801.785156 304.511719 787.164062 289.886719 769.175781 289.886719 L 759.074219 289.886719 C 746.242188 289.886719 734.566406 297.460938 729.304688 309.246094 L 653.984375 478.210938 C 652.828125 480.839844 650.304688 482.523438 647.359375 482.523438 C 644.414062 482.523438 639.996094 479.789062 639.996094 475.261719 L 639.996094 322.605469 C 639.996094 304.617188 625.371094 289.992188 607.382812 289.992188 L 597.390625 289.992188 C 584.558594 289.992188 572.878906 297.566406 567.621094 309.351562 L 518.808594 418.871094 L 560.679688 436.863281 L 594.339844 361.21875 L 594.339844 501.25 C 594.339844 527.339844 615.589844 548.59375 641.785156 548.59375 C 667.976562 548.59375 677.445312 537.546875 685.019531 520.503906 L 756.023438 361.21875 L 756.023438 499.988281 C 756.023438 523.34375 772.332031 544.070312 795.367188 547.960938 C 817.039062 551.644531 837.972656 540.070312 846.703125 520.609375 L 890.253906 423.078125 L 871.214844 353.851562 L 815.671875 478.3125 Z M 815.777344 478.105469 " fill-opacity="1" fill-rule="nonzero"></path><path fill="#2cc295" d="M 722.046875 676.105469 C 649.988281 676.105469 582.558594 647.699219 532.167969 596.148438 C 481.78125 544.59375 455.0625 476.527344 456.746094 404.351562 C 458.324219 334.914062 486.832031 269.792969 536.796875 220.976562 C 586.765625 172.261719 652.40625 145.433594 721.730469 145.433594 C 791.054688 145.433594 725.308594 145.433594 727.097656 145.433594 C 729.515625 145.433594 731.9375 145.539062 734.460938 145.644531 C 796.527344 148.484375 851.015625 180.679688 883.835938 234.019531 C 916.761719 287.464844 921.183594 353.433594 895.722656 410.664062 L 866.269531 476.839844 L 824.824219 458.324219 L 854.277344 392.148438 C 873.632812 348.699219 870.265625 298.40625 845.230469 257.796875 C 820.40625 217.503906 779.273438 193.09375 732.460938 190.992188 C 730.460938 190.886719 728.464844 190.78125 726.359375 190.78125 L 722.046875 190.78125 C 603.492188 190.78125 504.820312 287.046875 502.085938 405.511719 C 500.714844 465.269531 522.914062 521.765625 564.570312 564.585938 C 606.332031 607.300781 662.296875 630.867188 722.046875 630.867188 C 781.796875 630.867188 779.695312 625.078125 806.835938 613.71875 L 808.203125 613.085938 L 808.625 612.769531 C 841.550781 598.566406 870.792969 576.472656 893.199219 548.699219 L 893.410156 548.382812 L 948.742188 548.382812 L 948.007812 549.539062 C 944.640625 555.117188 941.0625 560.375 937.488281 565.425781 L 936.121094 567.320312 L 935.699219 567.953125 C 885.835938 635.707031 805.886719 676.105469 721.941406 676.105469 Z M 722.046875 676.105469 " fill-opacity="1" fill-rule="nonzero"></path><path fill="#2cc295" d="M 987.875 410.769531 C 987.875 412.875 987.875 414.980469 987.875 417.1875 C 986.296875 486.625 957.789062 551.855469 907.71875 600.566406 C 857.855469 649.277344 792.105469 676.210938 722.785156 676.210938 C 653.460938 676.210938 719.3125 676.210938 717.417969 676.210938 C 715 676.210938 712.578125 676.105469 710.160156 676 L 712.160156 630.65625 C 714.15625 630.761719 716.15625 630.867188 718.261719 630.867188 L 722.46875 630.867188 C 841.023438 630.867188 939.695312 534.601562 942.535156 416.136719 C 942.535156 414.347656 942.535156 412.664062 942.535156 410.875 L 987.875 410.875 Z M 987.875 410.769531 " fill-opacity="1" fill-rule="nonzero"></path></svg></div>
  <div>
    <div class="plat-brand-text">Wired CIO</div>
    <div class="plat-brand-sub">Unified Lead Scanner</div>
  </div>
</div>

<div id="app"><div style="max-width:1240px;margin:0 auto;padding:56px 28px;text-align:center;color:#9AA1AC;font-size:13.5px;">Loading…</div></div>

<script>
${unifiedScript}
</script>

</body>
</html>
`;

fs.writeFileSync("./wired-cio-unified-lead-scanner.html", html, "utf8");
console.log("Built wired-cio-unified-lead-scanner.html, length:", html.length);
