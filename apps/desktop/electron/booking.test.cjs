const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { validatePreferences, chooseOffer, validOrder, PreferenceStore } = require('./booking/preferences.cjs');
const { CardVault, RunSecret } = require('./booking/vault.cjs');
const { BookingRunner } = require('./booking/runner.cjs');
const { RehearsalAdapter } = require('./booking/rehearsal.cjs');
const { inspectCityline, selectCityline, schemaFor } = require('./booking/cityline.cjs');
const addon = require('../addons/catalog.json')[0];
const schema = schemaFor(addon, {options:{performance:[{id:'p1',label:'Evening'}],priceTier:[{id:'800',label:'800'},{id:'500',label:'500'}]}});
const prefs = {schemaVersion:1,quantity:2,maxTotalMinor:200000,currency:'HKD',requireTogether:true,allowFallback:true,checkout:'review',options:{performance:'p1',priceTier:['800','500'],section:[],floor:[],seatMode:'',fulfillment:''}};
const offer = {id:'order1',eventKey:'event1',quantity:2,currency:'HKD',totalMinor:167000,feesIncluded:true,adjacent:true,available:true,priceTier:'800',performance:'p1',seats:['A1','A2']};
const card = {label:'Test',name:'Test User',number:'4242424242424242',expiryMonth:12,expiryYear:new Date().getFullYear()+2};

test('schema validation discards secret and unknown fields and rejects invalid/replaced options',()=> {
  const normalized=validatePreferences({...prefs,cvv:'123',cardNumber:card.number,options:{...prefs.options,cvv:'123'}},schema);
  assert.equal(JSON.stringify(normalized).includes('123'),false);
  for(const change of [{quantity:0},{quantity:7},{maxTotalMinor:NaN},{maxTotalMinor:1.2},{currency:'NZD'},{checkout:'anything'},{options:{...prefs.options,priceTier:['gone']}},{options:{...prefs.options,performance:''}},{options:{...prefs.options,priceTier:['800','800']}}]) assert.throws(()=>validatePreferences({...prefs,...change},schema));
});
test('seat selection enforces fees, quantity, adjacency, currency and explicit fallback ranks',()=> {
  assert.equal(chooseOffer([offer],prefs),offer);
  for(const change of [{quantity:1},{currency:'USD'},{totalMinor:200001},{totalMinor:0},{feesIncluded:false},{adjacent:false},{adjacent:undefined},{available:false},{performance:'p2'},{priceTier:'999'}]) assert.equal(chooseOffer([{...offer,...change}],prefs),null);
  const cheaper={...offer,priceTier:'500',totalMinor:107000};
  assert.equal(chooseOffer([cheaper,offer],prefs),offer);
  assert.equal(chooseOffer([cheaper],{...prefs,allowFallback:false}),null);
  assert.equal(chooseOffer([cheaper],prefs),cheaper);
  assert.equal(chooseOffer([offer],{...prefs,options:{...prefs.options,floor:['Balcony']}}),null);
});
test('final payment guard rejects changed order ID, event, seats and total',()=> {
  assert.equal(validOrder(offer,prefs,offer),true);
  for(const change of [{id:'other'},{eventKey:'other'},{seats:['B1','B2']},{totalMinor:167001}]) assert.equal(validOrder({...offer,...change},prefs,offer),false);
});
test('local preference persistence uses allowlisted data', t=> {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-prefs-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new PreferenceStore(path.join(dir,'prefs.json'));store.set('event1',{...prefs,cvv:'123',number:card.number},schema);
  const data=fs.readFileSync(store.file,'utf8');assert.equal(data.includes(card.number),false);assert.equal(data.includes('cvv'),false);
  assert.deepEqual(store.get('event1',schema),validatePreferences(prefs,schema));
});
test('vault encrypts local records, masks IPC summaries, excludes CVV and refuses insecure fallback',t=> {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-vault-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const key=crypto.randomBytes(32), iv=crypto.randomBytes(12);
  const storage={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'test-secret-store',encryptString:s=> {const c=crypto.createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([c.update(s),c.final()]);return Buffer.concat([c.getAuthTag(),body]);},decryptString:b=> {const c=crypto.createDecipheriv('aes-256-gcm',key,iv);c.setAuthTag(b.subarray(0,16));return Buffer.concat([c.update(b.subarray(16)),c.final()]).toString();}};
  const vault=new CardVault(path.join(dir,'cards.enc'),storage), summaries=vault.save({...card,cvv:'123'});
  assert.equal(fs.readFileSync(vault.file).includes(Buffer.from(card.number)),false);
  assert.equal(JSON.stringify(summaries).includes(card.number),false);assert.equal(summaries[0].last4,'4242');
  assert.equal(vault.unlock(summaries[0].id).cvv,undefined);vault.remove(summaries[0].id);assert.equal(vault.list().length,0);
  const insecure=new CardVault(vault.file,{...storage,getSelectedStorageBackend:()=> 'basic_text'});assert.throws(()=>insecure.save(card));
  assert.throws(()=>vault.save({...card,number:'4242424242424243'}));
});
test('run secrets are wiped on stop and expire without persistence',()=> {
  const secret=new RunSecret(card,'123');const buffer=secret.card,cvv=secret.cvv;
  assert.equal(secret.use(c=>c.cvv),'123');secret.clear();assert.ok(buffer.every(b=>b===0));assert.ok(cvv.every(b=>b===0));assert.throws(()=>secret.use(()=>{}));
  const expired=new RunSecret(card,'123');expired.expiresAt=Date.now()-1;assert.throws(()=>expired.use(()=>{}));assert.equal(expired.card,null);
});
function runner(adapter, overrides={}) {return new BookingRunner({adapter,preferences:prefs,eventKey:'event1',notify:()=>{},payment: adapter.paymentVerified ? {verified:true,submit:()=>adapter.pay()} : null,secret:{use:fn=>fn(card),clear(){}},...overrides});}
test('rehearsal runs selection, reservation, review, single payment, 3DS handoff and verified confirmation',async()=> {
  const adapter=new RehearsalAdapter('event1',prefs), r=runner(adapter);
  await r.step();assert.equal(adapter.stage,'offers');await r.step();assert.equal(adapter.stage,'payment');await r.step();assert.equal(r.state.status,'review');
  await r.step();assert.equal(r.submitted,false);await r.step(true);assert.equal(r.submitted,true);await r.step();assert.equal(r.state.status,'awaiting_user');
  adapter.completeChallenge();await r.step();assert.equal(r.state.status,'completed');assert.equal(r.state.receipt,'REHEARSAL-NO-CHARGE');
});
test('automatic checkout respects consented requirements and never retries unknown payment',async()=> {
  let count=0,cleared=0;
  const adapter={paymentVerified:true,read:async()=>({eventKey:'event1',stage:'payment',order:offer}),pay:async()=>{count++;throw new Error('DO NOT LEAK CARD');}};
  const r=runner(adapter,{preferences:{...prefs,checkout:'automatic'},secret:{use:fn=>fn(card),clear(){cleared++;}}});
  await r.step();await r.step();assert.equal(count,1);assert.equal(r.state.status,'payment_unknown');assert.equal(cleared,1);assert.equal(r.state.message.includes('LEAK'),false);
});
test('payment re-read refuses changed totals, unsupported pages, challenges and cross-event navigation',async()=> {
  let count=0;
  const adapter={paymentVerified:true,read:async()=>({eventKey:'event1',stage:'payment',order:{...offer,totalMinor:count++?168000:167000}}),pay:async()=>assert.fail('must not pay')};
  const r=runner(adapter,{preferences:{...prefs,checkout:'automatic'}});await r.step();assert.equal(r.state.status,'awaiting_user');
  for(const page of [{eventKey:'other',stage:'payment',order:offer},{eventKey:'event1',stage:'payment',order:{...offer,adjacent:false}},{eventKey:'event1',stage:'payment',order:offer,challenge:'CAPTCHA'}]) {
    const rr=runner({...adapter,read:async()=>page});await rr.step(true);assert.equal(rr.state.status,'awaiting_user');
  }
  const unverified=runner({...adapter,paymentVerified:false,read:async()=>({eventKey:'event1',stage:'payment',order:offer})});await unverified.step(true);assert.equal(unverified.state.status,'awaiting_user');
});
test('stop while a page read is in flight prevents all subsequent actions',async()=> {
  let resolve;const pending=new Promise(r=>resolve=r);const secret=new RunSecret(card,'123');
  const r=runner({read:()=>pending,selectOptions:()=>assert.fail('must not select')},{secret});
  const step=r.step();r.stop();resolve({eventKey:'event1',stage:'options'});await step;assert.equal(r.state.status,'stopped');assert.equal(secret.card,null);
});
test('concurrent ticks serialize payment and no success is inferred from an arbitrary confirmation page',async()=> {
  let paid=0;
  const adapter={paymentVerified:true,read:async()=>({eventKey:'event1',stage:'payment',order:offer}),pay:async()=>{paid++;}};
  const r=runner(adapter,{preferences:{...prefs,checkout:'automatic'}});await Promise.all([r.step(),r.step(),r.step()]);assert.equal(paid,1);
  const foreign=runner({read:async()=>({eventKey:'event1',stage:'confirmation',order:offer,receipt:'foreign'})});await foreign.step();assert.notEqual(foreign.state.status,'completed');
});
test('observed Cityline controls are read and selected without touching payment or CAPTCHA',async()=> {
  const clicked=[];
  const el=(label,attrs={})=>({textContent:label,disabled:false,getClientRects:()=>[1],getAttribute:k=>attrs[k],click:()=>clicked.push(label)});
  const performances=[el('21 Nov Saturday',{'data-perf-id':'p1'})],prices=[el('800'),el('500')],next=[el('Proceed')];
  const document={title:'Cityline - Test Event',querySelectorAll:s=>s.startsWith('button.date')?performances:s==='button.price-btn'?prices:s==='button.purchase-btn'?next:[]};
  const context={document,location:{href:'https://venue.cityline.com.hk/utsvInternet/internet/eventDetail?event=123'},URL,setTimeout,getComputedStyle:()=>({visibility:'visible'})};
  const page=vm.runInNewContext('('+inspectCityline.toString()+')()',context);assert.equal(page.stage,'options');assert.equal(page.providerEventId,'123');assert.equal(page.options.priceTier[0].id,'800');
  assert.equal(await vm.runInNewContext('('+selectCityline.toString()+')('+JSON.stringify({eventId:'123',performance:'p1',prices:['800'],fallback:false})+')',context),true);assert.deepEqual(clicked,['21 Nov Saturday','800','Proceed']);
  clicked.length=0;assert.equal(await vm.runInNewContext('('+selectCityline.toString()+')('+JSON.stringify({eventId:'other',performance:'p1',prices:['800']})+')',context),false);assert.equal(clicked.length,0);
});

test('missing or expired preparation fails before marking payment as submitted',async()=> {
  const adapter={paymentVerified:true,read:async()=>({eventKey:'event1',stage:'payment',order:offer}),pay:async()=>assert.fail('no submission')};
  const missing=runner(adapter,{preferences:{...prefs,checkout:'automatic'},secret:null});await missing.step();assert.equal(missing.submitted,false);assert.equal(missing.state.status,'failed');
  const secret=new RunSecret(card,'123');secret.expiresAt=Date.now()-1;
  const expired=runner(adapter,{preferences:{...prefs,checkout:'automatic'},secret});await expired.step();assert.equal(expired.submitted,false);assert.equal(expired.state.status,'failed');
});

test('booking IPC authorizes callers, protects duplicate runs, requires payment consent and forbids terminal resumes',async t=> {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tixbam-controller-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const handlers=new Map();let tick;
  const controllerFile=path.join(__dirname,'booking/controller.cjs');
  const module={exports:{}};
  const scopedRequire=name=>name==='electron'?{Notification:{isSupported:()=>false}}:name.startsWith('.')?require(path.resolve(path.dirname(controllerFile),name)):require(name);
  vm.runInNewContext(fs.readFileSync(controllerFile,'utf8'),{require:scopedRequire,module,setInterval:fn=>{tick=fn;return 1;},clearInterval(){}});
  const events=[];
  const lifecycle=new Map();
  const control=module.exports.registerBooking({app:{getPath:()=>dir,on:(name,fn)=>lifecycle.set(name,fn)},safeStorage:{isEncryptionAvailable:()=>false},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dashboardOnly:event=>{if(!event.authorized)throw new Error('Unauthorized');},ticketWindows:new Map(),requireInstalled:()=>addon,resolveAddonUrl:(_id,url)=>({url}),send:(_name,state)=>events.push(state)});
  const invoke=(name,...args)=>handlers.get('tixbam:'+name)({authorized:true},...args);
  assert.throws(()=>handlers.get('tixbam:vault-status')({authorized:false}));
  const ctx=await invoke('booking-context',{providerId:'cityline',eventUrl:addon.url,rehearsal:true});
  const prepared={...prefs,checkout:'automatic',options:{...prefs.options,performance:'demo-evening'}};

  // Young K's registered Cityline sales currently link to an official
  // Live Nation event page. The offline demo must work without Cityline
  // windows, while real booking must never treat that page as Cityline.
  const promoterUrl='https://www.livenation.hk/en/event/young-k-solo-tour-youngest-in-hong-kong-hong-kong-tickets-edp1702449';
  const promoterDemo=await invoke('booking-context',{providerId:'cityline',eventUrl:promoterUrl,rehearsal:true,windowId:314});
  assert.equal(promoterDemo.rehearsal,true);
  assert.equal(promoterDemo.providerEventId,undefined);
  assert.equal(promoterDemo.schema.currency,'HKD');
  control.windowClosed(314); // A demo is not bound to any real ticket window.
  const stored=await invoke('save-booking-preferences',promoterDemo.contextId,prepared);
  assert.equal(stored.options.performance,'demo-evening');
  await assert.rejects(()=>invoke('booking-context',{providerId:'cityline',eventUrl:promoterUrl,windowId:314}),
    /event\/promoter page, not a Cityline booking URL/);
  await assert.rejects(()=>invoke('booking-context',{providerId:'cityline',eventUrl:'https://www.livenation.hk.evil.example/event',rehearsal:true}),
    /No supported TIXBAM add-on/);
  await assert.rejects(()=>invoke('booking-context',{providerId:'cityline',eventUrl:'https://user:pass@www.livenation.hk/event',rehearsal:true}),
    /valid HTTPS booking URL/);
  await assert.rejects(()=>invoke('start-booking',{contextId:ctx.contextId,preferences:prepared,paymentConsent:false}));
  const state=await invoke('start-booking',{contextId:ctx.contextId,preferences:prepared,paymentConsent:true});
  await assert.rejects(()=>invoke('start-booking',{contextId:ctx.contextId,preferences:prepared,paymentConsent:true}));
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  tick();await flush();tick();await flush();tick();await flush();
  assert.equal(events.at(-1).status,'awaiting_user');
  const complete=await invoke('resume-booking',state.id);assert.equal(complete.status,'completed');
  await assert.rejects(()=>invoke('resume-booking',state.id));
  assert.equal(invoke('vault-status').available,false);
  const stopped=await invoke('start-booking',{contextId:ctx.contextId,preferences:prepared,paymentConsent:true});
  control.stopAll();await assert.rejects(()=>invoke('resume-booking',stopped.id));
  lifecycle.get('before-quit')();
});
