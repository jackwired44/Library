// Seeded CRM deals — every deal in the HubSpot pipeline at the time of the
// pull (2026-09-14), regardless of stage: open, won, lost or closed. Each
// one began at the Intro Discovery stage, so each is an intro meeting that
// was booked.
//
// This ships INSIDE the published page rather than waiting for a manual
// import, at Jack's explicit request, so the Outbound success numbers are
// populated the moment the app opens. Consequence, stated plainly because
// it is a real one: these company and contact names are in the page source
// and are visible to anyone the Artifact is shared with, instead of living
// only in the viewer's own browser after they import a file.
//
// Loading is idempotent — it runs through importCrmDeals, which uses the
// same email-first / name+company dedup ladder as every other import, so a
// contact already on file is matched rather than duplicated and a later
// real import never blanks a field this seed filled in.
// The seed is a production data load, not app logic, so the test build
// switches it off: the regression suites assert on a clean Contacts
// directory, and 221 pre-loaded records would silently shift every count
// they check. Set at build time by `npm run build:test`.
export const CRM_SEED_ENABLED = String(import.meta.env?.VITE_APP_DISABLE_SEED || "") !== "1";

export const CRM_SEED_SOURCE = "HubSpot deals (2026-09-14)";

export const CRM_SEED_CSV = `Company,First Name,Last Name,Email,Job Title,Create Date,Deal Stage
400 Capital Management,,,,,2026-07-02,Closed lost
919 Capital Partners,Monali,Chokshi,mchokshi@919cp.com,Corporate Controller,2026-07-27,Closed lost
AC2 ADVANCED COMPUTER CONC,,,,,2026-07-02,Closed lost
Action Door Repair,,,,,2026-07-02,Closed lost
AD BUSINESS SERVICES,,,,,2026-07-02,Closed lost
AeroCore Technologies,,,,,2026-07-02,Closed lost
Algas-SDI,,,,,2026-07-02,Closed lost
Alliance Elevator Solutions,,,,,2026-07-02,Closed lost
Allied Wine Corp.,,,,,2026-07-02,Closed lost
Alrehab Perfumes,,,,,2026-07-02,Closed lost
American Freedom Insurance,,,,,2026-07-02,Closed lost
American Security Force,Monica,Hernandez,monicah@americansecurityforce.com,COO,2026-07-27,Closed lost
Amuze Products,,,,,2026-07-02,Closed won
Aphena Pharma,Paul,Kroll,pkroll@aphenapharma.com,Marketing and Media Specialist,2026-08-25,Closed lost
Applied Climate Solutions,Nick,Hanson,nickh@appliedclimate.com,Principal,2026-08-24,Closed lost
Applied Climate Solutions,Colin,White,colinw@appliedclimate.com,Principal Owner,2026-08-24,Closed lost
Applied Climate Solutions,Edward,Kovarik,eddyk@appliedclimate.com,Senior Project Manager,2026-08-24,Closed lost
Arc Health and Wellness,,,,,2026-08-10,Closed lost
Artis Construction,,,,,2026-07-02,Closed lost
Associates of Cape Cod,Christopher,Ferrer,cferrer@acciusa.com,Associate Director IT/IS,2026-07-02,Closed lost
Atlas Produce,,,,,2026-07-02,Closed lost
Automec Inc.,,,,,2026-07-21,Closed won
AZ-County of Yuma,,,,,2026-07-02,Closed lost
Aztec Discount Supplies,,,,,2026-07-02,Closed lost
Bank of Tennessee,,,,,2026-07-02,Closed lost
BB Oil Company,,,,,2026-07-29,Closed lost
BECKER ELECTRIC CO,,,,,2026-07-02,Closed lost
Becknell Industrial (Dynamics),,,,,2026-07-02,Closed lost
Becknell Industrial (MSP),,,,,2026-07-02,Closed lost
Becknell Industrial (Teams Phone),,,,,2026-07-02,Closed lost
Beef NW,,,,,2026-07-02,Closed lost
BIC Electric,Violet,Sawukaytis,vsawukaytis@bicelectrics.com,Business Associate,2026-07-31,In pipeline
Blaze Metrics,,,,,2026-07-27,Closed lost
BluCore Water,,,,,2026-07-02,Closed lost
BlytzPay,Harrison,Smith,harrison.smith@blytzpay.com,Business Intelligence Analyst,2026-08-13,Closed lost
Bodaway Gap Chapter - Navajo Nation,,,,,2026-07-02,Closed lost
Bud & Mary's,,,,,2026-07-02,Closed lost
Canyon Labs,Darcy,Grant,darcy.grant@canyonlabs.com,Project Manager,2026-07-15,Closed lost
Carolina Handling,,,,,2026-07-02,Closed lost
Cascade Peaks Accounting,Brian,Genz,brian.genz@cascadepeaksaccounting.com,Tax Preparer,2026-08-19,In pipeline
Center for Developmentally Disabled,,,,,2026-07-02,Closed lost
Center for Health Innovation Public Health Institute,,,,,2026-07-02,Closed lost
Champagne Energy Solutions,,,,,2026-07-02,Closed lost
City of Selma,Manuel,Rivera,mrivera@ci.selma.tx.us,Physician Assistant,2026-08-17,In pipeline
Columbus Light & Water,,,,,2026-07-02,Closed lost
Commercial Packaging,Steve,Gibbens,sgibbens@commercialpackaging.com,Director of IT,2026-07-15,Closed lost
Compass Medical Provider,,,,,2026-07-02,Closed lost
ConnectAbilityMN,,,,,2026-07-02,Closed won
Creative 3D Technologies,,,,,2026-07-02,In pipeline
Creative Fundraising Advisors,,,,,2026-07-02,Closed won
Delta Dental of South Dakota,Jennifer,Murray,jennifer.murray@deltadentalsd.com,Program Integrity Analyst,2026-07-29,In pipeline
"Delta Sigma Theta Sorority, Inc.",,,,,2026-07-02,Closed lost
Dennis Group,Yuri,Barros,barros@dennisgroup.com,Mechanical Engineer,2026-08-10,Closed lost
Diamond Distributions,Maggie,Lu,maggie@diamondgrocery.com,Admin,2026-07-02,Closed lost
DINGS' Motion USA,Mike,Wargocki,mwargocki@dingsmotionusa.com,,2026-07-09,Closed lost
Direct Deals,,,,,2026-07-02,Closed won
DunhamBush,,,,,2026-07-02,Closed lost
Duran Business Group,,,,,2026-07-02,Closed lost
DWI,,,,,2026-07-02,In pipeline
Dylan's Candy Bar,,,,,2026-07-02,Closed lost
EAPC Architects Engineers,,,,,2026-07-02,Closed lost
Early Learning Coalition of Orange County,,,,,2026-07-02,Closed lost
East Coast Capture,Sonia,Rocha,sonia@eastcoastcapture.com,Operations Manager,2026-08-18,In pipeline
EGI Battery,,,,,2026-07-02,Closed lost
EPC Project Service,,,,,2026-07-02,Closed lost
Estepp Energy LLC,,,,,2026-07-02,Closed lost
Executive Personnel Group,,,,,2026-07-02,Closed lost
Eyecare Medical Group,Brian,Collin,bcollin@eyecaremed.com,Senior Director of Finance Operations,2026-08-25,In pipeline
Eyecare Medical Group,Beth,Ganley,bganley@eyecaremed.com,Accounting Manager,2026-08-25,In pipeline
Fairfield Maxwell,,,,,2026-07-02,Closed lost
Famoso Nut Company,,,,,2026-07-02,Closed lost
FCL Dental,Danny,La,dla@fcldental.com,IT Director,2026-08-06,In pipeline
Fillex,Felix,Aakerberg,felix.aakerberg@fillexrx.com,Manager,2026-07-20,Closed lost
First Option Bank,Christian,Toman,ctoman@firstoptionbank.com,Chief Trust Officer,2026-09-11,Intro Discovery
First Option Bank,Jennifer,Milne,jmilne@firstoptionbank.com,,2026-09-11,Intro Discovery
Florida Department of Health,,,,,2026-07-02,Closed lost
FMW Industries,,,,,2026-07-02,Closed lost
Foothill Credit Union,Eric,Vasserman,evasserman@foothillcu.org,Director of IT,2026-08-04,Closed lost
ForDoz Pharma,,,,,2026-07-02,Closed lost
Fresno County Superintendent of Schools,,,,,2026-07-02,Closed lost
Garmark Partners,,,,,2026-07-02,Closed lost
Git-R-Done Site Services Inc.,,,,,2026-07-02,Closed lost
Glitc,,,,,2026-07-20,Closed lost
Go Big Accounting,,,,,2026-07-02,Closed lost
Gourmet Land,,,,,2026-07-02,Closed lost
GruntWorx,,,,,2026-07-02,Closed won
Hadron Energy,,,,,2026-07-02,Closed lost
Hatchik Supply,Chris,Masselli,technicalservices@hatchiksupply.com,,2026-07-02,Closed lost
HD Nursing,Nicole,Lashbrook,nlashbrook@hdnursing.com,Director of Operations,2026-07-02,Closed lost
Health and Life Organization,,,,,2026-07-02,Closed lost
Healthcare Education Insurance Company,,,,,2026-07-02,Closed lost
HealthGrowth Pharmacy Solutions,,,,,2026-07-02,Closed lost
Heart To Heart,Nellie,Rincon,nellier@h2hnj.com,,2026-07-09,Closed lost
Heinzelsales,,,,,2026-07-02,Closed lost
HERREGAN DISTRIBUTORS,,,,,2026-07-02,Closed lost
HMD Development,,,,,2026-07-02,Closed lost
Holden Farms Inc,,,,,2026-08-11,In pipeline
HOME OIL CO,,,,,2026-07-02,Closed lost
Howard County Economic Development Authority,,,,,2026-07-02,Closed lost
"Innovative Completion Systems, Inc.",,,,,2026-07-02,Closed lost
Inside Edge Consulting Group,,,,,2026-07-02,Closed lost
IntraCare,,,,,2026-07-02,Closed lost
"IV Solutions Health Care Utility, Inc.",Siva,Rajendran,srajendran@solutionshcu.com,,2026-08-26,Closed lost
"J&J Amusements, Inc.",,,,,2026-07-02,Closed lost
Jackson County Memorial Hospital,,,,,2026-07-02,Closed lost
JBJ Management,,,,,2026-07-02,Closed lost
JH Law Group,Mary,Wallace,mwallace@taxandtrust.com,Chief Technology Officer,2026-08-10,In pipeline
Jonathan Charles,Megan,Sanchez,megan@jonathancharles.com,Director Marketing/Sales,2026-07-02,Closed lost
Jorah Claims Solutions,Janet,Erdman,janet.erdman@jorahcs.com,SVP of Business Analytics,2026-09-03,Closed lost
KE Group Americas,,,,,2026-07-02,Closed lost
Kelleybean,,,,,2026-07-02,Closed lost
Kenai Defense,,,,,2026-07-02,Closed lost
Kenco Engineering,,,,,2026-07-02,Closed lost
Kentucky Correctional Industries,Michael,McKinney,michaeld.mckinney@ky.gov,Dentist,2026-08-24,In pipeline
Kramer Consulting Services,,,,,2026-07-02,Closed lost
Kuwait Health Office,,,,,2026-07-02,Closed lost
Lamda Beacon,Rodrigo,Ibanez-Meier,rodrigo@lambdabeacon.com,,2026-08-03,Closed lost
Landoe Systems,Tamara,Cook,tamara.cook@landoesystems.com,,2026-08-12,Closed lost
Laplace Interventional,,,,,2026-07-02,Closed lost
LC Food Distributor,,,,,2026-07-02,Closed lost
Lequities,,,,,2026-07-02,Closed lost
LexPro Research,Ryan,Dwyer,rdwyer@lexproresearch.com,CTO,2026-07-14,In pipeline
Liberation Bioindustries,Donald,Farias,donald.farias@liberation.bio,Sr. Electrical Controls Engineer,2026-07-02,Closed lost
Linear Solutions,,,,,2026-07-02,Closed lost
Live Line Safety,,,,,2026-07-02,Closed lost
Load Trail,,,,,2026-07-02,Closed lost
Lynker,Patrick,Hansen,phansen@lynker.com,Director of IT,2026-07-02,Closed won
Manutech Inc,Abner,Baptiste,abaptiste@manutech.us,General Manager,2026-08-21,In pipeline
Marex Enviromentals,,,,,2026-07-02,Closed lost
Marine Layer Advisors,Cheryl,Marie,cheryl@marinelayeradvisors.com,Head of Technical Operations,2026-07-02,Closed lost
Marine Solutions,,,,,2026-07-02,Closed lost
Medical Outfitters,,,,,2026-07-02,Closed lost
Meiwa Mold,,,,,2026-07-02,Closed won
Met Boston Limo,,,,,2026-08-03,Closed lost
Monarch Supply,,,,,2026-07-02,Closed lost
Mountain Pipe & Threading,Traci,Young,traci@inter-mountain.com,,2026-07-17,Closed lost
My Own Meals,Katie,Dumlar,kdumler@myownmeals.com,Chief Financial Officer,2026-08-24,Closed lost
Myles Davis Protective Services,,,,,2026-07-02,Closed lost
Myrtha Services,,,,,2026-07-02,Closed lost
Nationwide,Jacob,Olszej,olszej@nationwide.com,,2026-08-06,Closed lost
Network Connex,,,,,2026-07-02,Closed lost
New Republic Capital,,,,,2026-07-02,Closed lost
New South Associates,Danielle,Skerritt,dskerritt@newsouthassoc.com,Program Manager,2026-07-31,Closed lost
Newcoast Real Estate,,,,,2026-07-02,Closed lost
O'Hara's Son Roofing,,,,,2026-07-02,Closed lost
OCS Products,,,,,2026-07-02,Closed lost
OCTANORM USA IN,James,Lee,jlee@octanormna.com,,2026-09-09,Intro Discovery
One Call Concepts,Brendan,Jester,brendan@occinc.com,Administrative Coordinator,2026-09-01,Closed lost
OOL Tool,,,,,2026-07-02,Closed lost
Optum,,,,,2026-07-02,Closed lost
OurCare,,,,,2026-07-02,Closed lost
Outdoor Prolink,,,,,2026-07-31,Closed lost
P&K Research,,,,,2026-07-02,Closed lost
Pacific Aviation,,,,,2026-07-02,Closed lost
Pacific Coast Producers,,,,,2026-07-02,Closed lost
Pacifica Engineering Services,,,,,2026-07-02,Closed lost
Patriot Compressor Parts,Kyle,Thedford,kthedford@patriotcompressorparts.com,IT Admin,2026-07-15,Closed lost
Paul Davis Restoration Inc,,,,,2026-07-02,Closed lost
PiggyBanx Inc,,,,,2026-07-02,Closed lost
Pilatus Biosciences,Jay,Campbell,jay.campbell@pilatusbio.com,US Site Head Corporate Strategy,2026-07-02,In pipeline
Pointe Coupee Parish School Board,,,,,2026-07-02,Closed lost
Ponticon,Hugh,McManigal,hugh.mcmanigal@ponticon.tech,Owner,2026-07-15,Closed lost
Ponticon,Patrick,Bub,patrick.bub@ponticon.tech,Chief of Staff,2026-07-15,Closed lost
Quality Subaru,,,,,2026-07-02,Closed lost
ReBuilder Medical,,,,,2026-07-02,Closed won
Rescue Capital Management,,,,,2026-07-02,Closed lost
Research Foundation of City University,,,,,2026-07-02,In pipeline
Richmond Flying Squirrels,Derrick,McCabe,derrick.mccabe@squirrelsbaseball.com,Director of Ticket Operations,2026-08-03,In pipeline
Rubber Mill Inc,,,,,2026-07-02,Closed lost
S4 Water,,,,,2026-07-02,Closed won
Sadler Healthcare,,,,,2026-07-08,Closed lost
Seneca Business Services,,,,,2026-07-02,Closed lost
Servbank,Brandon,Young,brandon.young@servbank.com,SVP Controller,2026-09-01,Closed lost
Servbank,Jonathan,Pernice,jonathan.pernice@servbank.com,Senior Data Analyst,2026-09-01,Closed lost
SFO Capital,Ashley,Bland-Guy,ashleyg@sfocapllc.com,,2026-07-20,Closed lost
Silk City Meat Co.,,,,,2026-07-02,Closed lost
Simon-Kucher,,,,,2026-07-02,Closed lost
Sinas Dramis Law Firm,,,,,2026-07-02,Closed lost
Smart Reviews,,,,,2026-07-02,Closed lost
SoCal Realty Law,,,,,2026-07-02,Closed won
Solect Energy Development,Alex,Keally,akeally@solect.com,SVP Energy Solutions,2026-09-08,Intro Discovery
Solidity Law,,,,,2026-07-02,Closed lost
Southern Georgia Regional Commission,Rachel,Strom,rstrom@sgrc.us,IT,2026-07-02,Closed lost
"Specialty Entrance Technologies, LLC",,,,,2026-07-02,Closed lost
SpikedAde,,,,,2026-08-21,Closed lost
Standing Rock Housing Authority,,,,,2026-07-02,Closed lost
Star Publications,,,,,2026-07-02,Closed won
Stedical Scientific,Scott,Moote,smoote@stedical.com,,2026-07-10,Closed won
Steiner Holdings,,,,,2026-07-02,Closed lost
Stewart Glass,,,,,2026-07-02,Closed lost
Sunny Marketing Systems,,,,,2026-07-02,Closed lost
Sunshine Spice Corp,Sebastian,Mejia,smejia@sunshinespicecorp.com,Logistics Manager,2026-09-09,Intro Discovery
SWD Inc,,,,,2026-08-10,Closed lost
Talon Precision Inc.,,,,,2026-07-02,Closed lost
Technical Training Aids,,,,,2026-07-02,Closed won
TechTrade Solutions,,,,,2026-07-02,Closed lost
The Boot Jack,,,,,2026-07-02,Closed lost
Top Tier Line Gear,,,,,2026-07-02,Closed lost
Totally Bamboo,Urvi,Shah,urvis@totallybamboo.com,EDI System Lead,2026-07-07,In pipeline
TOWN OF OAK BLUFFS,,,,,2026-07-02,Closed lost
TRI VET CONTRACTING,,,,,2026-07-02,Closed lost
Triskelle Software Solutions,,,,,2026-07-02,In pipeline
Trust Layer Advisors,,,,,2026-07-02,Closed lost
Uni-Systems Engineering,,,,,2026-07-02,In pipeline
Union Rescue Mission,,,,,2026-07-02,Closed lost
Unity Cellular,,,,,2026-07-02,Closed lost
Universal Aero Accessories,Daniel,Edwards,daniel@universal-aero.com,,2026-07-09,Closed lost
Universal Storage Group,Mark,Amos,mark@universalstoragegroup.com,IT Director,2026-09-10,Intro Discovery
Universal Storage Group,Andy,Shobert,andy@universalstoragegroup.com,Chief Financial Officer,2026-09-10,Intro Discovery
Van Leeuwen Ice Cream,Lukas,Donaldson,lukas.donaldson@vanleeuwenicecream.com,IT and Technology Manager,2026-07-13,Closed lost
Vanguard Urologic Institute,,,,,2026-07-02,Closed lost
Vanns Spices,,,,,2026-07-02,Closed lost
Vantari Health & Regualatory Sciences,Rufus,Robertson,rufus.w.robertson@gmail.com,,2026-07-08,Closed lost
Verifyd,,,,,2026-07-02,Closed lost
Vira Insight,,,,,2026-07-02,Closed lost
VisionSoft Inc.,,,,,2026-07-02,Closed lost
Wearlinq,,,,,2026-07-10,Closed lost
Western Growers,Jan,Meksavanh,jmeksavanh@wga.com,Business Intelligence Manager,2026-08-12,Closed lost
Western Michigan University,Cheng,Sun,chengkidd.sun@wmich.edu,Director of External Partnerships,2026-08-19,In pipeline
Wichita Machine Products,Sarah,Shinton,shinton@wichitamachineproducts.com,Process Improvements,2026-07-10,Closed lost
Workforce Alliance,Vincent,Villano,vvillano@workforcealliance.biz,IT,2026-07-02,Closed lost
`;
