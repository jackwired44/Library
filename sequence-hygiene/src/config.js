// Sequence Hygiene: default settings. Every list here is editable in the Settings screen;
// these are only the starting values. No prospect data lives in this file.
(function (root) {
  const DEFAULTS = {
    // Apollo call outcome ids (Jack's workspace).
    outcomes: {
      notInterested: "66203bd7183e310422980485",
      meetingBooked: "6a024dabd777bd000d626376",
      infoRequested: "6a0f3f736d2f76001c1d81e9",
      callBack: "6a73be64a0f3de000c6be57f",
      pendingReview: "6aa2c9e5aaca8f0020ba173e",
      doNotContact: "6a989d8ec49089001c19afd7",
      wrongNumber: "6a7df36eda04890018573da9",
      gatekeeper: "6a7df381b85a6000143a839e",
      leftVoicemail: "6a85f9f01aba53000c122e8c",
      noAnswer: "66203bd7183e31042298047d",
    },
    outcomeLabels: {
      "66203bd7183e310422980485": "Not interested",
      "6a024dabd777bd000d626376": "Meeting booked",
      "6a0f3f736d2f76001c1d81e9": "Info requested",
      "6a73be64a0f3de000c6be57f": "Call back scheduled",
      "6aa2c9e5aaca8f0020ba173e": "Qualified / pending review",
      "6a989d8ec49089001c19afd7": "Do not contact",
      "6a7df36eda04890018573da9": "Wrong number",
      "6a7df381b85a6000143a839e": "Gatekeeper",
      "6a85f9f01aba53000c122e8c": "Left voicemail",
      "66203bd7183e31042298047d": "No answer",
    },
    // Apollo contact stages that remove (rule 8). Follow Up and Open are fine.
    removeStages: {
      "6a73bd6b59c987000cc2c50c": "Meeting Logged",
      "66203bd7183e31042298045e": "Not Interested",
      "6a65319835213500203822f0": "Open Deal",
      "6a73ee5976e5ba001c169964": "Review + Email",
    },
    // Every Apollo contact stage, so the Rules page can switch each one on or off for rule 8.
    allStages: {
      "6a73bd924f135d0014ac11a0": "Follow Up",
      "6a73bd6b59c987000cc2c50c": "Meeting Logged",
      "66203bd7183e31042298045e": "Not Interested",
      "6a65319835213500203822ef": "Open",
      "6a65319835213500203822f0": "Open Deal",
      "6a73ee5976e5ba001c169964": "Review + Email",
    },
    disabledRules: [],
    // Words searched in Apollo call notes to find calls where someone was reached, for the company check.
    // Trellus writes its AI summary into the note, so these find conversations no matter the disposition.
    callKeywords: ["Wired CIO", "spoke", "meeting", "interested", "demo", "pricing", "evaluating", "call back"],
    callKeywordPages: 5,
    okStages: {
      "6a73bd924f135d0014ac11a0": "Follow Up",
      "6a65319835213500203822ef": "Open",
    },
    users: {
      "68bf4ba5f68a0600194acd11": "Jack",
      "6a738903389433001cdab5da": "Carly",
    },
    // Call duration thresholds for "No Disposition" calls (rule 2). Seconds.
    longCallSec: 240,
    midCallSec: 120,
    // Rule 11: end reasons that mean we made contact.
    contactEndReasons: ["talked on phone", "replied", "interested", "meeting", "appointment"],
    // Rule 17 keyword lists. A bare CRM/sales does not count without Dynamics/D365 beside it.
    keywords: {
      dynamics: ["Dynamics", "D365", "Business Central", "ERP", "F&O", "Finance and Operations", "supply chain",
        "NAV", "GP", "AX", "Power Apps", "Power Automate", "Power Platform", "Dataverse"],
      m365: ["Microsoft 365", "M365", "Office 365", "O365", "Azure", "Copilot", "Intune", "Defender", "Entra",
        "Teams", "licensing"],
    },
    freeDomains: ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
      "ymail.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "gmx.com",
      "mail.com", "zoho.com", "yandex.com", "comcast.net", "att.net", "sbcglobal.net", "verizon.net",
      "bellsouth.net", "cox.net", "charter.net", "earthlink.net", "alltel.net"],
    // Rule 15 tie-break: first title pattern that matches wins.
    titlePriority: ["CFO", "Controller", "Chief Financial", "VP Finance", "Director of Finance", "CEO", "President",
      "Owner", "COO", "CIO", "CTO", "IT Director", "Director of IT", "VP", "Director", "Manager"],
    // Product -> sequences that count as "my live call sequence" for rules 13 and 14.
    // Ids are picked in Settings; empty until then.
    callSequences: { dynamics: [], m365: [] },
    // Outlook mailboxes to search besides your own (needs delegated access in Microsoft 365).
    extraMailboxes: [],
    // Lookback for Outlook calendar, in months.
    calendarMonths: 12,
    // Apollo rate budgets per tool, per rolling hour and per day.
    budgets: {
      apollo_contacts_search: { hour: 400, day: 2000 },
      apollo_phone_calls_search: { hour: 400, day: 4000 },
      apollo_emailer_messages_search: { hour: 400, day: 4000 },
    },
    // Wrong Number: "review" (default) or "remove".
    wrongNumber: "review",
  };
  const api = { DEFAULTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SH_CONFIG = api;
})(typeof window !== "undefined" ? window : globalThis);
