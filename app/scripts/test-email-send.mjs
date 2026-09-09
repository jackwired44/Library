// Proves the send pipeline end to end WITHOUT sending anything: compose a
// real message from a real step + contact, check every blocker, then run
// it through a stand-in relay that behaves like SendGrid will.
import { composeStepEmail, isSendable, sendStepEmail, NO_SENDER, stepSendsAutomatically } from '../src/lib/emailSend.ts';

let pass=0, fail=0;
const ok=(n,c,d='')=>{c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,'::',String(d).slice(0,220)));};

const contact = {
  id:'c1', firstName:'Dana', lastName:'Whitfield', fullName:'Dana Whitfield',
  company:'Ridgeline Orthopedics', title:'IT Director', email:'dana@ridgelineortho.com',
  workPhone:'', mobilePhone:'', sourceFiles:[], timesSeen:1,
  firstSeenAt:'2026-09-01T12:00:00Z', lastSeenAt:'2026-09-01T12:00:00Z',
};
const account = { id:'a1', label:'Wired CIO Outbound', fromName:'Jack at Wired CIO', fromEmail:'jack@wiredcio.com', provider:'sendgrid', connected:false, createdAt:'' };
const sender = { name:'Jack', company:'Wired CIO' };

// 1. A manual email with real merge fields composes correctly.
const manual = {
  id:'s1', position:0, channel:'email', waitHours:0, sendMode:'manual', bodyMode:'fixed',
  subject:'Microsoft Solutions for {{account.name}}',
  body:'Hi {{contact.first_name}}, quick question about your Dynamics plans. — {{sender_first_name}}',
};
let m = composeStepEmail(manual, contact, account, sender);
ok('subject merges the company name', m.subject === 'Microsoft Solutions for Ridgeline Orthopedics', m.subject);
ok('body merges first name and sender', /Hi Dana,/.test(m.body) && /— Jack$/.test(m.body), m.body);
ok('from identity comes off the account', m.fromEmail==='jack@wiredcio.com' && m.fromName==='Jack at Wired CIO', m.fromEmail);
ok('recipient resolved', m.to==='dana@ridgelineortho.com');
ok('manual email with everything present is sendable', isSendable(m), JSON.stringify(m.blockers));

// 2. Blockers each fire for the right reason.
ok('no account -> blocked', composeStepEmail(manual, contact, null, sender).blockers.some(b=>b.code==='no_sender_account'));
ok('no email -> blocked', composeStepEmail(manual, {...contact, email:''}, account, sender).blockers.some(b=>b.code==='no_recipient'));
ok('do-not-contact -> blocked', composeStepEmail(manual, {...contact, disposition:'do-not-contact'}, account, sender).blockers.some(b=>b.code==='do_not_contact'));
ok('not-interested -> blocked', composeStepEmail(manual, {...contact, disposition:'not-interested'}, account, sender).blockers.some(b=>b.code==='do_not_contact'));
ok('empty subject -> blocked', composeStepEmail({...manual, subject:''}, contact, account, sender).blockers.some(b=>b.code==='no_subject'));
ok('empty body -> blocked', composeStepEmail({...manual, body:''}, contact, account, sender).blockers.some(b=>b.code==='no_body'));

// 3. An unresolvable token must never go out as literal text.
const badTok = {...manual, body:'Hi {{contact.first_name}}, saw {{contact.favourite_colour}}.'};
const bt = composeStepEmail(badTok, contact, account, sender);
ok('unknown merge field blocks the send', bt.blockers.some(b=>b.code==='unresolved_tokens'), JSON.stringify(bt.blockers));
ok('...and names the offending field', /favourite_colour/.test(bt.blockers.map(b=>b.message).join(' ')));

// 4. An AI-body step cannot be composed while no AI is connected.
const ai = { ...manual, sendMode:'auto', bodyMode:'ai', body:'', systemPrompt:'x', userPrompt:'y' };
const am = composeStepEmail(ai, contact, account, sender);
ok('AI-body step is blocked, not faked', am.blockers.some(b=>b.code==='ai_body_unavailable'), JSON.stringify(am.blockers));
ok('AI step is flagged as the one that would auto-send', stepSendsAutomatically(ai) === true);
ok('manual step is NOT auto-send', stepSendsAutomatically(manual) === false);

// 5. With no relay, a perfectly valid message still does not "send".
const r1 = await sendStepEmail(manual, contact, account, sender);
ok('valid message + no relay = honest refusal', r1.result.ok===false && r1.result.errorCode==='not_configured', JSON.stringify(r1.result));

// 6. THE POINT: drop in a relay that behaves like SendGrid and it sends.
const sent = [];
const fakeSendGrid = {
  id:'sendgrid', label:'SendGrid', connected:true,
  async send(msg){ sent.push(msg); return { ok:true, providerMessageId:'sg_abc123' }; },
};
const r2 = await sendStepEmail(manual, contact, account, sender, fakeSendGrid);
ok('with a relay connected, the message sends', r2.result.ok===true && r2.result.providerMessageId==='sg_abc123', JSON.stringify(r2.result));
ok('the relay received the fully composed message', sent.length===1 && sent[0].subject==='Microsoft Solutions for Ridgeline Orthopedics' && /Hi Dana,/.test(sent[0].body), JSON.stringify(sent[0]||{}));
ok('the relay got the real from/to', sent[0].to==='dana@ridgelineortho.com' && sent[0].fromEmail==='jack@wiredcio.com');

// 7. A relay NEVER sees a message that failed the checks.
const before = sent.length;
const r3 = await sendStepEmail(manual, {...contact, disposition:'do-not-contact'}, account, sender, fakeSendGrid);
ok('opted-out contact never reaches the relay', sent.length===before && r3.result.ok===false, JSON.stringify(r3.result));
const r4 = await sendStepEmail(badTok, contact, account, sender, fakeSendGrid);
ok('unresolved token never reaches the relay', sent.length===before && r4.result.ok===false);

// 8. A relay that throws is reported, not swallowed.
const boom = { id:'x', label:'x', connected:true, async send(){ throw new Error('502 from provider'); } };
const r5 = await sendStepEmail(manual, contact, account, sender, boom);
ok('a throwing relay surfaces its real error', r5.result.ok===false && /502 from provider/.test(r5.result.error||''), JSON.stringify(r5.result));

console.log(`\n${pass}/${pass+fail} passed`);
process.exit(fail?1:0);
