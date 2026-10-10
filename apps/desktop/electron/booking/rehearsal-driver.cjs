'use strict';
/** AB-07 offline simulator. Uses the real host BookingRunner/FSM and an
 * isolated AB-05 journal, never actual site/browser/payment APIs.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {BookingRunner,TERMINAL}=require('./runner.cjs');
const {PaymentAttemptLedger}=require('./payment-attempts.cjs');
const {DEFINITIONS,getScenario}=require('./rehearsal-fixtures.cjs');
const ID=/^[0-9a-f-]{36}$/i;
const STATES=new Set(['running','review','awaiting_user','submitting','completed','payment_unknown','stopped','failed']);
function deterministicNumber(seed,salt){
  return crypto.createHash('sha256').update(String(seed)+':'+salt).digest().readUInt32BE(0);
}
function makePreferences(plan,kind){
  if(!plan||!Number.isSafeInteger(plan.budgetMinor)||plan.budgetMinor<100||
     !Number.isInteger(plan.quantity)||plan.quantity<1||plan.quantity>20||
     !/^[A-Z]{3}$/.test(plan.currency||''))throw Error('A positive mock budget and quantity are required.');
  return {schemaVersion:1,quantity:plan.quantity,maxTotalMinor:plan.budgetMinor,
    currency:plan.currency,requireTogether:plan.requireTogether===true,
    allowFallback:plan.allowFallback===true,checkout:'review',
    options:{performance:'practice-performance',priceTier:['practice-standard'],
      section:[],floor:[],seatMode:kind==='standing'?'standing':
        ['automatic','auto_unverified'].includes(kind)?'automatic':'',fulfillment:''}};
}
function makeSyntheticOffer(key,prefs,seed,kind){
  const qty=prefs.quantity,ticket=Math.max(1,Math.floor(prefs.maxTotalMinor/(3*qty)));
  const row=String.fromCharCode(65+deterministicNumber(seed,'row')%5);
  const start=1+deterministicNumber(seed,'seat')%10;
  const seats=Array.from({length:qty},(_,i)=>kind==='standing'?'GA-'+(i+1):
    row+'-'+(start+i*(kind==='adjacency'?2:1)));
  const serviceFeeMinor=qty*Math.max(1,Math.floor(ticket/10));
  const ticketSubtotalMinor=qty*ticket;
  return {schemaVersion:2,id:'mock-'+crypto.createHash('sha256').update(key+':'+seed).digest('hex').slice(0,20),
    eventKey:key,quantity:qty,currency:prefs.currency,totalMinor:ticketSubtotalMinor+serviceFeeMinor,
    feesIncluded:true,available:kind!=='sold_out',adjacent:kind!=='adjacency',
    totalVerified:true,availabilityVerified:true,identityVerified:true,
    restrictedView:kind==='restricted_view',realNameRequired:false,
    ageRestricted:false,accessibilityRestricted:false,
    feeBreakdown:kind==='unknown_fees'?undefined:{
      ticketSubtotalMinor,serviceFeeMinor,taxMinor:0,deliveryFeeMinor:0,extrasMinor:0},
    extras:[],
    priceTier:'practice-standard',performance:'practice-performance',section:'Mock-A',floor:'Mock',
    seatMode:kind==='standing'?'standing':
      ['automatic','auto_unverified'].includes(kind)?'automatic':'assigned',
    areaId:kind==='standing'?'Mock-Pit':undefined,
    verifiedAllocation:kind==='automatic'?true:
      kind==='auto_unverified'?false:undefined,
    fulfillment:'eticket',seats};
}
class ScenarioAdapter{
  constructor(key,prefs,scenario,seed){
    this.key=key;this.prefs=prefs;this.scenario=scenario;this.stage='options';
    this.challenge=null;this.challengeType='none';this.paymentVerified=true;
    this.readCount=0;this.payments=0;this.offers=[];this.order=null;
    this.offer=makeSyntheticOffer(key,prefs,seed,scenario.kind);
    if(['queue','captcha'].includes(scenario.kind)){
      this.challengeType=scenario.kind;
      this.challenge=scenario.kind==='queue'?'Simulated queue: user handoff required.':
        'Simulated CAPTCHA: a person must complete this challenge.';
    }
  }
  peek(){
    // Explicitly non-mutating observation: AI requests must never change
    // the price-drift test or provider state.
    return {eventKey:this.key,stage:this.stage,challenge:this.challenge,
      challengeType:this.challengeType,offers:this.offers,order:this.order,
      receipt:undefined};
  }
  async read(){
    this.readCount++;
    const page={eventKey:this.key,stage:this.stage,challenge:this.challenge,
      challengeType:this.challengeType,offers:this.offers,order:this.order,
      receipt:this.stage==='confirmation'&&!this.challenge?'REHEARSAL-NO-CHARGE':undefined};
    if(this.stage==='payment'&&this.order&&
       ['price_change','fees_change'].includes(this.scenario.kind)){
      this.paymentReads=(this.paymentReads||0)+1;
      if(this.paymentReads>=2)page.order={...this.order,
        totalMinor:this.order.totalMinor+(this.scenario.kind==='fees_change'?1000:3000)};
    }
    return page;
  }
  async selectOptions(){
    if(this.stage!=='options'||this.challenge)throw Error('Invalid practice stage');
    this.stage='offers';this.offers=this.scenario.kind==='sold_out'?[]:[this.offer];
    return true;
  }
  async reserve(offer,{signal}={}){
    if(signal?.aborted)throw Error('Cancelled synthetic recovery');
    if(this.stage!=='offers'||offer?.id!==this.offer.id)throw Error('Unknown fake offer');
    if(this.scenario.kind==='stale'){this.offers=[];throw Error('Mock inventory changed during selection');}
    this.order={...this.offer,seats:[...this.offer.seats]};this.stage='payment';
  }
  async pay(){
    this.payments++;
    if(this.payments!==1)throw Error('Duplicate mock payment attempt');
    if(['payment_timeout','unknown_charge','restart'].includes(this.scenario.kind))
      throw Error('Simulated provider response lost');
    this.stage='confirmation';
    if(this.scenario.kind==='bank_3ds'){
      this.challengeType='3ds';this.challenge='Simulated bank 3-D Secure: user approval required.';
    }
  }
  completeChallenge(){
    if(!this.challenge)return false;
    this.challenge=null;this.challengeType='none';return true;
  }
}
class RehearsalDriver{
  constructor({rootDir,plan,ownerId=null,clock=Date.now}={}){
    if(typeof rootDir!=='string'||!path.isAbsolute(rootDir)||!ID.test(plan?.id||'')||
       (ownerId!==null&&(typeof ownerId!=='string'||ownerId.length>128))||
       typeof clock!=='function')throw Error('Invalid rehearsal host binding');
    this.plan=Object.freeze({...plan});this.clock=clock;this.runner=null;
    this.adapter=null;this.events=[];this.operations=Promise.resolve();
    this.recoveryEpoch=0;
    const owner=crypto.createHash('sha256').update(ownerId||'offline').digest('hex').slice(0,24);
    this.folder=path.join(rootDir,'rehearsal-lab',owner,plan.id);
    this.manifest=path.join(this.folder,'last-run.json');
    this.last=this.#recover();
  }
  #recover(){
    try{
      const last=JSON.parse(fs.readFileSync(this.manifest,'utf8'));
      if(last.version!==1||!ID.test(last.runId||'')||!getScenario(last.scenarioId)||
         !STATES.has(last.status)||!Number.isSafeInteger(last.seed)||
         last.seed<0||last.seed>999999)throw Error('Invalid synthetic record');
      let unknown=['payment_unknown','submitting'].includes(last.status);
      const dir=path.join(this.folder,'runs',last.runId);
      try{
        if(fs.existsSync(dir))unknown=unknown||
          new PaymentAttemptLedger(dir).recovered().length>0;
      }catch{unknown=true;}
      return {...last,status:unknown?'payment_unknown':
        last.status==='completed'?'completed':'stopped',
        message:unknown?'Simulated payment status unknown after restart; never retry.':
          'Practice interrupted; start a new simulation.',recovered:true};
    }catch(err){
      if(err.code==='ENOENT')return null;
      return {version:1,scenarioId:'restart',seed:0,status:'payment_unknown',
        message:'Practice recovery record damaged; automatic resume denied.',recovered:true};
    }
  }
  #persist(record){
    fs.mkdirSync(this.folder,{recursive:true,mode:0o700});
    const data={version:1,runId:record.runId,scenarioId:record.scenarioId,
      seed:record.seed,status:record.status,updatedAt:this.clock()};
    const file=this.manifest+'.tmp',fd=fs.openSync(file,'w',0o600);
    try{fs.writeFileSync(fd,JSON.stringify(data));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(file,this.manifest);
    const dir=fs.openSync(this.folder,'r');
    try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
    this.last={...data,recovered:false};
  }
  get scenarios(){return DEFINITIONS.map(({id,title,ko,hint,hintKo})=>({id,title,ko,hint,hintKo}));}
  get state(){
    const run=this.runner?.state;
    if(!run&&!this.last)return {active:false,scenarioId:null,status:'idle',message:'Choose a scenario.',recovered:false};
    if(!run)return {active:false,scenarioId:this.last.scenarioId,status:this.last.status,
      message:this.last.message,seed:this.last.seed,recovered:true,events:[],challenge:'none'};
    return {active:!TERMINAL.has(run.status),scenarioId:this.last.scenarioId,
      seed:this.last.seed,status:run.status,phase:run.phase,message:run.message,
      challenge:this.adapter?.challengeType||'none',recovered:false,
      paymentAttempts:this.adapter?.payments||0,
      order:run.order?{quantity:run.order.quantity,totalMinor:run.order.totalMinor,
        currency:run.order.currency,seats:run.order.seats}:null,
      events:this.events.slice(-16)};
  }
  #serialize(task){const taskPromise=this.operations.then(task);this.operations=taskPromise.catch(()=>{});return taskPromise;}
  withRecoveryTask(task){
    if(typeof task!=='function')throw new TypeError('Trusted recovery task required');
    return this.#serialize(task);
  }
  start(scenarioId,seed=2027){
    return this.#serialize(async()=>{
      const scenario=getScenario(scenarioId);
      if(!scenario||!Number.isSafeInteger(seed)||seed<0||seed>999999)
        throw Error('Unknown deterministic rehearsal scenario');
      if(this.runner&&!TERMINAL.has(this.runner.state.status))
        throw Error('Stop the current scenario first.');
      const prefs=makePreferences(this.plan,scenario.kind);
      const runId=crypto.randomUUID();
      const key='rehearsal-'+crypto.createHash('sha256').update(runId+':'+scenario.id).digest('hex');
      const adapter=new ScenarioAdapter(key,prefs,scenario,seed);
      const dir=path.join(this.folder,'runs',runId);
      fs.mkdirSync(dir,{recursive:true,mode:0o700});
      const ledger=new PaymentAttemptLedger(dir,{clock:this.clock});
      const permit={accountId:'offline-rehearsal',providerId:'rehearsal',
        planId:this.plan.id,saleId:'mock-'+runId,performanceId:'practice-performance',
        eventKey:key,quantity:prefs.quantity,currency:prefs.currency,
        maxAllInMinor:prefs.maxTotalMinor,requireTogether:prefs.requireTogether,
        allowFallback:prefs.allowFallback,checkout:prefs.checkout};
      this.events=[];
      const runner=new BookingRunner({
        adapter,preferences:prefs,eventKey:key,rehearsal:true,
        notify:state=>{
          this.events.push({phase:state.phase,status:state.status,message:state.message});
          if(this.events.length>36)this.events.shift();
          this.#persist({runId,scenarioId,seed,status:state.status});
        },
        payment:{verified:true,submit:()=>adapter.pay()},
        secret:{use:async fn=>fn(null),clear(){}},ledger,purchasePermit:permit
      });
      this.runner=runner;this.adapter=adapter;
      this.#persist({runId,scenarioId,seed,status:runner.state.status});
      return this.state;
    });
  }
  next({confirm=false,completeChallenge=false}={}){
    return this.#serialize(async()=>{
      if(!this.runner||TERMINAL.has(this.runner.state.status))
        throw Error('No active rehearsal step.');
      if(completeChallenge){
        if(this.runner.state.status!=='awaiting_user'||!this.adapter.challenge)
          throw Error('No manual challenge awaits completion.');
        this.adapter.completeChallenge();
      }
      if(confirm!==true&&this.runner.state.status==='review')
        throw Error('Confirm the fake order first.');
      if(confirm===true&&this.runner.state.status!=='review')
        throw Error('Only the order review may be confirmed.');
      await this.runner.step(confirm===true);
      return this.state;
    });
  }
  stop(){
    // User cancellation supersedes queued/retrieving AI recovery steps.
    this.recoveryEpoch++;
    if(this.runner&&!TERMINAL.has(this.runner.state.status))this.runner.stop();
    return this.#serialize(async()=>{
      if(this.runner&&!TERMINAL.has(this.runner.state.status))this.runner.stop();
      return this.state;
    });
  }
  simulateRestart(){
    this.recoveryEpoch++;
    if(this.runner&&!TERMINAL.has(this.runner.state.status))this.runner.stop();
    return this.#serialize(async()=>{
      if(this.runner&&!TERMINAL.has(this.runner.state.status))this.runner.stop();
      this.runner=null;this.adapter=null;this.last=this.#recover();
      return this.state;
    });
  }
}
module.exports={ScenarioAdapter,RehearsalDriver,makePreferences,makeSyntheticOffer,deterministicNumber};
