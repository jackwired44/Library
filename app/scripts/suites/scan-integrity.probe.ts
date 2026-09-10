import { scanParsedFiles, buildExportRow, EXPORT_LABELS, type ParsedFile } from "../../src/lib/detection";
let pass=0, fail=0;
const ok=(n:string,c:boolean,d=''):void=>{ c?(pass++,console.log('  PASS',n)):(fail++,console.log('  FAIL',n,d)); };

const HEAD = ["First Name","Last Name","Title","Company","Email","Phone","Comments"];
const mk=(i:number,c:string,co=`Company ${i} Inc`)=>({ "First Name":`First${i}`,"Last Name":`Last${i}`,Title:"IT Director",
  Company:co, Email:`p${i}@co${i}corp.com`, Phone:`(312) 555-${1000+i}`, Comments:c });
const F=(name:string,rows:Record<string,unknown>[]):ParsedFile=>({name,fields:HEAD,data:rows});
const RICH="Dynamics 365 Business Central for 40 users, engaging an implementation partner this year.";
const THIN="They use Dynamics 365.";
const NONE="We cater weddings across the tri-state area.";

// 1. The accounting identity, on a batch containing all three kinds.
{
  const f=F("mixed.csv",[...Array.from({length:10},(_,i)=>mk(i,RICH)),
                         ...Array.from({length:5},(_,i)=>mk(i,RICH)),      // exact repeats
                         ...Array.from({length:7},(_,i)=>mk(100+i,NONE))]);
  const s=scanParsedFiles([f]);
  ok('read = processed + no signal + duplicates',
     s.rowsScanned === s.results.length + s.noSignalRows.length + s.duplicatesRemoved,
     `${s.rowsScanned} vs ${s.results.length}+${s.noSignalRows.length}+${s.duplicatesRemoved}`);
  ok('every merged duplicate is itemized', s.duplicateRows.length === s.duplicatesRemoved,
     `${s.duplicateRows.length} vs ${s.duplicatesRemoved}`);
  ok('no surviving row is still flagged duplicate', s.results.every(r=>!r.isDuplicate));
  ok('each merged row names a survivor still in the batch',
     s.duplicateRows.length>0 && s.duplicateRows.every(d=>d.company && d.mergedIntoSourceFile));
}

// 2. File order must not change ANY outcome. This is the bug Jack hit.
{
  const A=F("rich.csv",Array.from({length:40},(_,i)=>mk(i,RICH)));
  const B=F("thin.csv",Array.from({length:40},(_,i)=>mk(i,THIN)));
  const sig=(fs:ParsedFile[])=>{const s=scanParsedFiles(fs);
    return {strong:s.results.filter(r=>r.tier==="signal").length,
            mention:s.results.filter(r=>r.tier==="mention").length,
            dq:s.results.filter(r=>r.tier==="dq").length,
            processed:s.results.length, dupes:s.duplicatesRemoved, nosig:s.noSignalRows.length};};
  const one=sig([A,B]), two=sig([B,A]);
  ok('file order does not change the tier split', JSON.stringify(one)===JSON.stringify(two),
     `${JSON.stringify(one)} vs ${JSON.stringify(two)}`);
  ok('the merge keeps the strong copy, not the first-seen', one.strong===40 && one.mention===0,
     JSON.stringify(one));
}

// 3. Scanning is deterministic across repeated runs.
{
  const f=F("d.csv",[...Array.from({length:30},(_,i)=>mk(i,RICH)),...Array.from({length:10},(_,i)=>mk(i,THIN))]);
  const sigOf=()=>scanParsedFiles([f]).results.map(r=>`${r.row.__f.company}:${r.tier}:${r.category}`).join('|');
  ok('same input, same output, three times in a row', sigOf()===sigOf() && sigOf()===sigOf());
}

// 4. A downloaded export re-uploads without losing Strong Signal.
{
  const f=F("orig.csv",Array.from({length:25},(_,i)=>mk(i,RICH)));
  const a=scanParsedFiles([f]);
  const strong=a.results.filter(r=>r.tier==="signal");
  const ex:ParsedFile={name:"export.csv",fields:[...EXPORT_LABELS],
    data:strong.map(buildExportRow) as unknown as Record<string,unknown>[]};
  const b=scanParsedFiles([ex]);
  ok('export round-trip keeps every Strong Signal lead',
     b.results.filter(r=>r.tier==="signal").length===strong.length,
     `${b.results.filter(r=>r.tier==="signal").length}/${strong.length}`);
}

// 5. Combining separate batches loses only true duplicates.
{
  const A=F("a.csv",Array.from({length:50},(_,i)=>mk(i,RICH)));
  const B=F("b.csv",Array.from({length:50},(_,i)=>mk(30+i,RICH)));
  const C=F("c.csv",Array.from({length:50},(_,i)=>mk(60+i,RICH)));
  const sum=[A,B,C].reduce((n,f)=>n+scanParsedFiles([f]).results.filter(r=>r.tier==="signal").length,0);
  const comb=scanParsedFiles([A,B,C]);
  const strong=comb.results.filter(r=>r.tier==="signal").length;
  ok('combined shortfall is exactly the duplicate count',
     sum-strong===comb.duplicatesRemoved, `sum ${sum}, combined ${strong}, dupes ${comb.duplicatesRemoved}`);
  ok('no lead is lost outside the merge', comb.noSignalRows.length===0);
}

// 6. A row missing name or company is never keyed, so never merged away.
{
  const rows=[{...mk(1,RICH),"First Name":"","Last Name":""},{...mk(2,RICH),Company:""},
              {...mk(1,RICH),"First Name":"","Last Name":""}];
  const s=scanParsedFiles([F("nokey.csv",rows)]);
  ok('unkeyable rows are never merged', s.duplicatesRemoved===0, `${s.duplicatesRemoved}`);
}

console.log(`\n${pass}/${pass+fail} passed`);
process.exit(fail?1:0);
