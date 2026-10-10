'use strict';
/**
 * AB-15 deterministic, OFFLINE release readiness attestations.
 * This script checks repository invariants; it NEVER approves release or
 * issues payment grants. A green CI is a validated HOLD, not a GO.
 */
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
function read(name){return fs.readFileSync(path.join(root,name),'utf8');}
const definitions=[
  {
    id:'performance-purchase-guard',group:'B',file:'services/api/app/models.py',
    pattern:/UniqueConstraint\("user_id", "performance_id",/,
    about:'Server guard spans all sellers and sales for the same account/performance'
  },{
    id:'local-performance-scope',group:'B',file:'apps/desktop/electron/booking/payment-attempts.cjs',
    pattern:/\['purchase-scope-v2',p\.accountId,p\.performanceId\]/,
    about:'Local purchase scope never partitions by seller, sale or plan'
  },{
    id:'legacy-journal-deny',group:'B',file:'apps/desktop/electron/booking/payment-attempts.cjs',
    pattern:/throw new JournalUnavailable\('legacy_scope_unresolved'\)/,
    about:'Unmappable legacy real purchase history never resets the payment latch'
  },{
    id:'durable-preclaim',group:'B',file:'apps/desktop/electron/booking/runner.cjs',
    pattern:/this\.ledger\.recordClaimRequested/,
    about:'Local claim latch is durable before the remote claim request'
  },
  {
    id:'live-host-kill-switch',group:'A',file:'apps/desktop/electron/booking/capability-policy.cjs',
    pattern:/const RELEASE_APPROVED = false;/,
    about:'Host-controlled live capability release remains hard-disabled'
  },{
    id:'provider-action-deny',group:'A',file:'apps/desktop/electron/booking/provider-runtime.cjs',
    pattern:/return deny\('live_release_unavailable'\)/,
    about:'Provider permission cannot override the host release block'
  },{
    id:'vendor-fixture-non-authority',group:'A',file:'services/api/app/provider_verification.py',
    pattern:/"liveExecutionAvailable": False/,
    about:'A fixture pass never becomes a vendor live payment authorization'
  },{
    id:'restricted-vendor-policy',group:'A',file:'services/api/app/automation_policies.py',
    pattern:/PROTECTED = frozenset\(RESTRICTED\)/,
    about:'Restricted provider baseline remains protected'
  },{
    id:'mock-only-executor',group:'B',file:'apps/desktop/electron/booking/payment-executor.cjs',
    pattern:/adapter instanceof ScenarioAdapter/,
    about:'The executor accepts only offline fixture adapter instances'
  },{
    id:'real-runner-no-payment',group:'B',file:'apps/desktop/electron/booking/controller.cjs',
    pattern:/payment: ctx\.rehearsal \? \{ verified: true, submit: \(\) => adapter\.pay\(\) \} : null/,
    about:'No real-provider payment executor is attached in Desktop host'
  },{
    id:'durable-commit-before-submit',group:'B',file:'apps/desktop/electron/booking/runner.cjs',
    pattern:/this\.ledger\.recordCommitIntent/,
    about:'BookingRunner records a durable intent before a payment step'
  },{
    id:'unknown-not-replayable',group:'B',file:'apps/desktop/electron/booking/payment-attempts.cjs',
    pattern:/noAutomaticRetry:true/,
    about:'Unknown/recovered attempts cannot be automatically replayed'
  },{
    id:'reconciliation-no-provider',group:'B',file:'apps/desktop/electron/booking/reconciliation.cjs',
    pattern:/throw FAIL\('official_receipt_provider_unavailable'\)/,
    about:'Unverified official merchant receipts cannot be inferred'
  },{
    id:'server-lease-non-payment',group:'B',file:'services/api/app/booking_leases.py',
    pattern:/"autonomousCheckoutAvailable": False/,
    about:'Server lease state does not authorize real checkout'
  },{
    id:'ai-rehearsal-only',group:'C',file:'services/api/app/ai_planner.py',
    pattern:/rehearsal: Literal\[True\]/,
    about:'OpenRouter planner accepts rehearsal requests only'
  },{
    id:'ai-no-direct-execution',group:'C',file:'apps/desktop/electron/booking/ai-planner.cjs',
    pattern:/advisoryOnly:true,source:'openrouter'/,
    about:'AI outputs are non-executing proposals'
  },{
    id:'window-main-frame-ipc',group:'C',file:'apps/desktop/electron/main.cjs',
    pattern:/event\.senderFrame !== dashboard\.webContents\.mainFrame/,
    about:'Privileged dashboard IPC requires the main frame'
  },{
    id:'account-api-origin',group:'C',file:'apps/desktop/electron/account.cjs',
    pattern:/!isPackaged && u\.protocol === "http:"/,
    about:'Packaged client never sends bearer tokens to arbitrary HTTP origins'
  },{
    id:'deny-renderer-permissions',group:'D',file:'apps/desktop/electron/main.cjs',
    pattern:/session\.defaultSession\.setPermissionRequestHandler/,
    about:'Default renderer cannot request device-level permissions'
  },{
    id:'deny-unreviewed-webviews',group:'D',file:'apps/desktop/electron/main.cjs',
    pattern:/wc\.on\("will-attach-webview", event => event\.preventDefault\(\)\)/,
    about:'Provider pages cannot attach Electron webviews'
  },{
    id:'electron-sandbox',group:'D',file:'apps/desktop/electron/main.cjs',
    pattern:/contextIsolation: true, sandbox: true/,
    about:'Electron privileged local windows use context isolation and sandbox'
  },{
    id:'locked-node-install',group:'D',file:'.github/workflows/ci.yml',
    pattern:/npm ci --no-audit --no-fund/,
    about:'CI resolves Node dependency tree exclusively from committed npm lock'
  },{
    id:'release-check-in-ci',group:'D',file:'.github/workflows/ci.yml',
    pattern:/node scripts\/release-readiness\.cjs/,
    about:'Every dev/PR CI run evaluates host release-deny invariants'
  }
];
function evaluate({source=read}={}){
  const checks=definitions.map(d=>{
    let passed=false;
    try{passed=d.pattern.test(source(d.file));}catch{passed=false;}
    return {id:d.id,group:d.group,passed,description:d.about};
  });
  const failures=checks.filter(c=>!c.passed).map(c=>c.id);
  const gates=[
    {id:'A',name:'Provider permission & signed capability evidence',status:'HOLD',
      blockers:['Written vendor approval per provider/country/action unavailable',
        'No approved live host adapter or signed release evidence']},
    {id:'B',name:'Payment and reconciliation',status:'HOLD',
      blockers:['No vendor-authorized tokenized/hosted payment integration',
        'No authoritative live merchant receipt / bank 3DS / idempotency certification',
        'No production PCI DSS and incident/security approval']},
    {id:'C',name:'Operations and security sign-off',status:'HOLD',
      blockers:['Real provider operator go/no-go and payment support staffing unverified',
        'Threat model, external penetration test, observability/rollback drill not signed off']},
    {id:'D',name:'Packaging & distribution',status:'HOLD',
      blockers:['Signed/notarized macOS packaged app and hardware QA not evidenced',
        'SBOM, vulnerability triage and provenance attestations remain manual',
        'Production alert thresholds and deployment rollback not exercised']}
  ];
  return {
    schemaVersion:1,project:'TixBam',stage:'AB-15',environment:'CI / offline fixtures',
    status:'HOLD',automaticCheckoutAvailable:false,livePaymentEnabled:false,
    staticChecksPassed:failures.length===0,failedChecks:failures,checks,gates,
    policy:'Passing tests verifies the OFF state; it never authorizes any live purchase.'
  };
}
if(require.main===module){
  const result=evaluate();
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.staticChecksPassed)process.exitCode=1;
}
module.exports={evaluate,definitions};
