// What Apollo's own setup says, read live on 2026-11-20 (read-only:
// phone_calls_search facets, contact_stages_index, emailer_campaigns_search),
// next to what THIS platform does with each one. Per Jack: "make sure we have
// the rules of dispositions that are in apollo and the triggers and everything
// stored here so i can fully manage it all over easier".
// Apollo's per-disposition automations (what an outcome sets in Apollo) are
// not readable through the connector; what is shown for them is what was
// observed on real contacts, and says so.
import { OUTCOME, FINISH_OUTCOMES } from "./apolloSequences";

export const APOLLO_RULES_AT = "2026-11-20";

export type OutcomeBucket = "reached" | "not-reached" | "none";
export interface OutcomeRule {
  id: string;
  name: string;
  bucket: OutcomeBucket;
  callsLogged: number; // team-wide, on the read date
  inApollo: string;    // what was observed Apollo doing
  platform: string[];  // what this platform does with it
}

const finishes = (id: string) => id in FINISH_OUTCOMES;
const P_FINISH = "Sequence Scanner: an active lead with this outcome is flagged as slipped through and can be finished (stopped) in one click.";

export const OUTCOME_RULES: OutcomeRule[] = [
  { id: OUTCOME.meetingBooked, name: "Meeting Booked", bucket: "reached", callsLogged: 132,
    inApollo: "Sequences end with reason \"talked on phone\" or \"scheduled appointment / interested\".",
    platform: [P_FINISH, "Never recycled. Home and Reps count it as a meeting.", "Recycle: left out."] },
  { id: OUTCOME.qualified, name: "Qualified, Pending Review", bucket: "reached", callsLogged: 53,
    inApollo: "Ends the sequence (\"talked on phone\").",
    platform: [P_FINISH, "Counts as a successful conversation; never recycled."] },
  { id: OUTCOME.infoRequested, name: "Info Requested", bucket: "reached", callsLogged: 210,
    inApollo: "Ends the sequence (\"talked on phone\").",
    platform: [P_FINISH + " Per Jack: we reach out that way instead.", "Successful conversation; never recycled."] },
  { id: OUTCOME.callBack, name: "Call Back Scheduled", bucket: "reached", callsLogged: 139,
    inApollo: "Ends the sequence (\"talked on phone\").",
    platform: [P_FINISH, "Sequence Scanner flags a call back whose note has no day, date or time.", "Never recycled."] },
  { id: OUTCOME.notInterested, name: "Not interested", bucket: "reached", callsLogged: 464,
    inApollo: "Ends the sequence; often also moves the contact stage to Not Interested.",
    platform: [P_FINISH, "Recycle: comes back after 6 months.", "Stage Not Interested is flagged in Sequence Scanner too."] },
  { id: OUTCOME.doNotContact, name: "Do Not Contact", bucket: "reached", callsLogged: 4,
    inApollo: "Ends the sequence.",
    platform: [P_FINISH, "Never recycled, never pushed to a recycled sequence."] },
  { id: OUTCOME.gatekeeper, name: "Gatekeeper / Front Desk", bucket: "not-reached", callsLogged: 325,
    inApollo: "Sequence carries on to the next step.",
    platform: ["Counts as an unanswered attempt (recycle after 3, 22 days rest).", "Recycle tab: fine to push."] },
  { id: OUTCOME.leftVm, name: "Left Voicemail", bucket: "not-reached", callsLogged: 176,
    inApollo: "Sequence carries on to the next step.",
    platform: ["Counts as an unanswered attempt.", "Recycle tab: fine to push (a voicemail note saying \"call back\" is still not a conversation)."] },
  { id: OUTCOME.noAnswer, name: "No Answer", bucket: "not-reached", callsLogged: 32521,
    inApollo: "Sequence carries on to the next step.",
    platform: ["Counts as an unanswered attempt.", "Recycle tab: fine to push."] },
  { id: OUTCOME.wrongNumber, name: "Wrong Number", bucket: "not-reached", callsLogged: 180,
    inApollo: "Sequence carries on.",
    platform: ["Dead number: never recycled, left out of the Recycle tab."] },
  { id: "other", name: "No Disposition", bucket: "none", callsLogged: 5451,
    inApollo: "Call logged with no outcome.",
    platform: ["Read from the call note: \"spoke with / talked to / discussed\" counts as a conversation."] },
];
export const finishesSequence = (id: string) => finishes(id);

export interface StageRule { id: string; name: string; category: string; ignoresTriggers: boolean }
export const CONTACT_STAGES: StageRule[] = [
  { id: "6a73bd924f135d0014ac11a0", name: "Follow Up Stage", category: "in progress", ignoresTriggers: false },
  { id: "6a73bd6b59c987000cc2c50c", name: "Meeting Logged", category: "succeeded", ignoresTriggers: false },
  { id: "66203bd7183e31042298045e", name: "Not Interested", category: "failed", ignoresTriggers: true },
  { id: "6a65319835213500203822ef", name: "Open", category: "in progress", ignoresTriggers: false },
  { id: "6a65319835213500203822f0", name: "Open Deal", category: "succeeded", ignoresTriggers: false },
  { id: "6a73ee5976e5ba001c169964", name: "Review + Email", category: "in progress", ignoresTriggers: false },
];

export interface SequenceRule {
  name: string;
  owner: "Jack" | "Carly";
  steps: string[];
  finishOnReply: boolean;
  finishOnInterested: boolean;
  pauseOnOutOfOffice: boolean;
  replyWaitDays: number;          // days_to_wait_before_mark_as_response
  sameCompanyReplyDelayDays: number;
  excludedAccountStages: number;  // count; names not readable through the connector
  maxEmailsPerDay?: number;
  note?: string;
}
const COMMON = { finishOnReply: true, finishOnInterested: true, pauseOnOutOfOffice: true, replyWaitDays: 5, sameCompanyReplyDelayDays: 30 };
export const SEQUENCE_RULES: SequenceRule[] = [
  { name: "Jack M365 Sequence", owner: "Jack", ...COMMON, excludedAccountStages: 4,
    steps: ["Call (day 0)", "Auto email (same day)", "Call (+1 day)", "Auto email (same day)", "Call (+2 days)", "LinkedIn connect (+1 hour)"] },
  { name: "Carly M365 Sequence", owner: "Carly", ...COMMON, excludedAccountStages: 4,
    steps: ["Call (day 0)", "Auto email (+1 hour)", "Call (+1 day)", "Call (+2 days)", "Call (+1 day)", "LinkedIn message (+1 day)"] },
  { name: "Jacks Dynamics Sequence", owner: "Jack", ...COMMON, excludedAccountStages: 4,
    steps: ["Call (+3 days)", "Auto email (+30 min)", "Call (+3 days)", "Call (+3 days)", "Auto email (+30 min)", "LinkedIn message (+3 days)"],
    note: "For opps that had or were looking at Microsoft Dynamics in the last year." },
  { name: "Carly Dynamics Sequence", owner: "Carly", ...COMMON, excludedAccountStages: 0, maxEmailsPerDay: 175,
    steps: ["Call (+3 days)", "Auto email (same day)", "Call (+3 days)", "Call (+3 days)", "LinkedIn message (+3 days)"],
    note: "Microsoft Dynamics leads only." },
  { name: "Jack Main Recycled", owner: "Jack", ...COMMON, excludedAccountStages: 0,
    steps: ["Call (day 0)", "Auto email (+1 day)", "Call (+1 day)", "Call (+2 days)", "Call (+1 day)"] },
  { name: "Carly Main Recycled", owner: "Carly", ...COMMON, excludedAccountStages: 0,
    steps: ["Call (day 0)", "Auto email (+1 day)", "Call (+1 day)", "Call (+2 days)", "Call (+1 day)"],
    note: "For leads that end with no answer, gatekeeper or left voicemail from the main sequence; pushed four business days after their tasks finish. Still no answer: a 5-week email campaign, then back to the database." },
];

export const PLATFORM_RULES: string[] = [
  "Recycle: Ready after 3 unanswered calls, or a sequence that ended with no conversation; then 22 days rest. Sequence Scanner → Recycle pushes finished leads 4 business days after they finish.",
  "A lead is never pushed while active or paused in any sequence, or if it replied, unsubscribed, bounced, has a deal or is at stage Not Interested.",
  "One contact per company per sequence: Sequence Scanner → Same company lists every company with two or more.",
  "Duplicates: same email (confirmed), same phone at one company, or first-name-only vs full name at one company.",
  "A call of 4 minutes or more is a real conversation (Trellus calls log 0 seconds, so this only catches calls with a real duration).",
];
