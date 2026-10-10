'use strict';
/**
 * AB-05 durable, append-only local payment safety journal.
 *
 * This is NOT a payment processor, receipt verifier or distributed lock.
 * A journal failure, truncated tail, invalid permissions, or orphan lock is
 * deliberately a HARD DENIAL of any additional payment side effect.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const VERSION=2, MAX_BYTES=8*1024*1024;
const DIGEST=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES=new Set(['RUN_CREATED','OFFER_LOCKED','COMMIT_INTENT_RECORDED',
  'PAYMENT_SUBMISSION_RETURNED','PAYMENT_UNKNOWN','PURCHASE_CONFIRMED','RUN_STOPPED',
  'RECONCILIATION_REVIEWED','CLAIM_REQUESTED','RESERVATION_REQUESTED',
  'RESERVATION_HELD','RESERVATION_UNKNOWN']);
const BASIC=new Set(['version','seq','prevHash','hash','type','atMs','scopeDigest',
  'runId','attemptId','permitDigest','orderDigest','receiptDigest','rehearsal',
  'reviewDigest','reviewOutcome','purchaseScopeVersion']);
const cleanRecord=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const sortedJson=value=>JSON.stringify(value);
const hash=payload=>crypto.createHash('sha256').update(payload).digest('hex');

class JournalUnavailable extends Error {
  constructor(code){super('Local payment safety journal unavailable ('+code+'). Automatic submission is blocked.');this.name='JournalUnavailable';this.code=code;}
}
function validEvent(e){
  if(!cleanRecord(e)||Reflect.ownKeys(e).some(k=>typeof k!=='string'||!BASIC.has(k))||
     ![1,2].includes(e.version)||!Number.isSafeInteger(e.seq)||e.seq<1||
     !Number.isSafeInteger(e.atMs)||e.atMs<1||!TYPES.has(e.type)||
     !DIGEST.test(e.scopeDigest)||!UUID.test(e.runId)||typeof e.rehearsal!=='boolean'||
     !DIGEST.test(e.prevHash)||!DIGEST.test(e.hash))return false;
  const has=k=>Object.hasOwn(e,k);
  if(e.version===1&&(has('purchaseScopeVersion')||e.type==='CLAIM_REQUESTED'))return false;
  if(e.version===1&&e.type.startsWith('RESERVATION_'))return false;
  if(e.version===2&&e.purchaseScopeVersion!==2)return false;
  if(e.type==='RUN_CREATED')return has('permitDigest')&&DIGEST.test(e.permitDigest)&&
    !has('attemptId')&&!has('orderDigest')&&!has('receiptDigest');
  if(e.type==='OFFER_LOCKED')return has('orderDigest')&&DIGEST.test(e.orderDigest)&&
    !has('attemptId')&&!has('permitDigest')&&!has('receiptDigest');
  if(e.type==='RESERVATION_HELD')return e.version===2&&UUID.test(e.attemptId)&&
    DIGEST.test(e.orderDigest)&&!has('permitDigest')&&!has('receiptDigest');
  if(['COMMIT_INTENT_RECORDED','CLAIM_REQUESTED','RESERVATION_REQUESTED'].includes(e.type))return UUID.test(e.attemptId)&&
    DIGEST.test(e.permitDigest)&&DIGEST.test(e.orderDigest)&&!has('receiptDigest');
  if(e.type==='RECONCILIATION_REVIEWED')return UUID.test(e.attemptId)&&
    DIGEST.test(e.reviewDigest)&&
    ['reported_paid','reported_not_paid','inconclusive'].includes(e.reviewOutcome)&&
    !has('receiptDigest')&&!has('permitDigest')&&!has('orderDigest');
  if(e.type==='PURCHASE_CONFIRMED')return UUID.test(e.attemptId)&&
    DIGEST.test(e.receiptDigest)&&!has('permitDigest')&&!has('orderDigest');
  if(e.type==='RUN_STOPPED')return !has('attemptId')&&!has('permitDigest')&&
    !has('orderDigest')&&!has('receiptDigest');
  return UUID.test(e.attemptId)&&!has('permitDigest')&&!has('orderDigest')&&!has('receiptDigest');
}
class DurableBookingJournal {
  #dir;#file;#lock;#key;#poisoned=false;#fault;
  constructor(parentDir,{fault=null,maxBytes=MAX_BYTES}={}){
    if(typeof parentDir!=='string'||!path.isAbsolute(parentDir)||!Number.isInteger(maxBytes)||
       maxBytes<4096||maxBytes>MAX_BYTES)throw new JournalUnavailable('invalid_configuration');
    this.maxBytes=maxBytes;this.#fault=typeof fault==='function'?fault:()=>{};
    this.#dir=path.join(parentDir,'booking-safety');
    this.#file=path.join(this.#dir,'journal-v1.ndjson');
    this.#lock=path.join(this.#dir,'journal-v1.lock');
    this.#key=path.join(this.#dir,'journal-v1.key');
    try {
      const exists=fs.existsSync(this.#dir);
      if(!exists){fs.mkdirSync(this.#dir,{recursive:false,mode:0o700});
        this.#syncDir(parentDir);}
      this.#checkDir();
      // Prevent a deleted ledger/key from silently resetting prior attempts.
      // Fresh installation is only the state where BOTH files are absent.
      const hadKey=fs.existsSync(this.#key),hadJournal=fs.existsSync(this.#file);
      if(hadKey!==hadJournal)throw new JournalUnavailable('incomplete_or_deleted_journal');
      this.#ensureKey();
      if(!hadJournal){
        const fd=this.#secureFd(this.#file,
          fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL);
        fs.fsyncSync(fd);fs.closeSync(fd);this.#syncDir(this.#dir);
      }
      // Validate on startup; never attempt to repair a possibly committed tail.
      this.read();
    } catch(e){this.#poisoned=true;throw e instanceof JournalUnavailable?e:new JournalUnavailable('initialization_failed');}
  }
  get file(){return this.#file;}
  get locked(){return this.#poisoned||fs.existsSync(this.#lock);}
  assertWritable(){
    if(this.locked)throw new JournalUnavailable(this.#poisoned?'poisoned':'journal_locked');
  }
  #checkpoint(name){this.#fault(name);}
  #syncDir(dir){
    const fd=fs.openSync(dir,fs.constants.O_RDONLY| (fs.constants.O_DIRECTORY||0));
    try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
  #checkDir(){
    const st=fs.lstatSync(this.#dir);
    if(!st.isDirectory()||st.isSymbolicLink()||
       (process.platform!=='win32'&&(st.mode&0o077)!==0))throw new JournalUnavailable('directory_permissions');
  }
  #secureFd(file,flags,mode=0o600){
    const noFollow=fs.constants.O_NOFOLLOW||0;
    if(fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
      throw new JournalUnavailable('unsafe_symlink');
    const fd=fs.openSync(file,flags|noFollow,mode);
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.nlink!==1||
       (process.platform!=='win32'&&(stat.mode&0o077)!==0)){
      fs.closeSync(fd);throw new JournalUnavailable('unsafe_file_permissions');
    }
    return fd;
  }
  #ensureKey(){
    if(!fs.existsSync(this.#key)){
      let fd;
      try {
        fd=this.#secureFd(this.#key,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL);
        const secret=crypto.randomBytes(32);
        if(fs.writeSync(fd,secret)!==32)throw Error('partial key write');
        fs.fsyncSync(fd);this.#syncDir(this.#dir);
      } finally {if(fd!==undefined)fs.closeSync(fd);}
    }
    const fd=this.#secureFd(this.#key,fs.constants.O_RDONLY);
    try {
      const secret=fs.readFileSync(fd);
      if(secret.length!==32)throw new JournalUnavailable('invalid_fingerprint_key');
      this.secret=secret;
    }finally{fs.closeSync(fd);}
  }
  digest(value){
    if(this.#poisoned)throw new JournalUnavailable('poisoned');
    if(!this.secret)throw new JournalUnavailable('not_ready');
    return crypto.createHmac('sha256',this.secret).update(sortedJson(value)).digest('hex');
  }
  #parse(raw){
    if(raw.length>this.maxBytes)throw new JournalUnavailable('journal_full');
    if(raw.length>0 && raw[raw.length-1]!==10)throw new JournalUnavailable('truncated_record');
    const lines=raw.toString('utf8').split('\n').filter(Boolean);
    if(lines.length>25000)throw new JournalUnavailable('record_limit');
    const out=[];let prev='0'.repeat(64);
    for(const line of lines){
      let e;try{e=JSON.parse(line);}catch{throw new JournalUnavailable('corrupt_json');}
      if(!validEvent(e)||e.seq!==out.length+1||e.prevHash!==prev)
        throw new JournalUnavailable('invalid_sequence');
      const {hash:given,...unsigned}=e;
      if(hash(sortedJson(unsigned))!==given)throw new JournalUnavailable('integrity_mismatch');
      prev=given;out.push(e);
    }
    return out;
  }
  #readOpen(){
    if(!fs.existsSync(this.#file))return [];
    const fd=this.#secureFd(this.#file,fs.constants.O_RDONLY);
    try {return this.#parse(fs.readFileSync(fd));}finally{fs.closeSync(fd);}
  }
  read(){
    if(this.#poisoned)throw new JournalUnavailable('poisoned');
    try{return this.#readOpen();}
    catch(e){this.#poisoned=true;throw e instanceof JournalUnavailable?e:new JournalUnavailable('read_failed');}
  }
  /**
   * Acquire an exclusive, never automatically stale-reclaimed lock.
   * Writes are durable before returning. Crashes can strand the lock; an
   * operator must inspect/reconcile before ever removing it. Fail closed.
   */
  transact(makeEvents){
    this.assertWritable();
    let lockFd,fd,poison=false;
    try {
      lockFd=this.#secureFd(this.#lock,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY);
      fs.writeSync(lockFd,String(process.pid));fs.fsyncSync(lockFd);this.#syncDir(this.#dir);
      this.#checkpoint('lock_acquired');
      this.#checkDir();
      const previous=this.#readOpen();
      const batch=makeEvents(Object.freeze([...previous]));
      if(!Array.isArray(batch)||batch.length<1||batch.length>8)
        throw new JournalUnavailable('invalid_batch');
      let last=previous.length?previous[previous.length-1].hash:'0'.repeat(64);
      let number=previous.length;
      const built=[];
      for(const part of batch){
        if(!cleanRecord(part)||Object.hasOwn(part,'hash')||
           Object.hasOwn(part,'seq')||Object.hasOwn(part,'prevHash')||
           Object.hasOwn(part,'version'))throw new JournalUnavailable('unsafe_event');
        const unsigned={version:VERSION,seq:++number,prevHash:last,purchaseScopeVersion:2,...part};
        const record={...unsigned,hash:hash(sortedJson(unsigned))};
        if(!validEvent(record))throw new JournalUnavailable('invalid_event');
        last=record.hash;built.push(record);
      }
      const data=Buffer.from(built.map(e=>sortedJson(e)+'\n').join(''));
      let oldLen=0;
      if(fs.existsSync(this.#file))oldLen=fs.statSync(this.#file).size;
      if(oldLen+data.length>this.maxBytes)throw new JournalUnavailable('journal_full');
      fd=this.#secureFd(this.#file,fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_WRONLY);
      this.#checkpoint('before_append');poison=true;
      let offset=0;
      while(offset<data.length){
        const n=fs.writeSync(fd,data,offset,data.length-offset);
        if(n<=0)throw new JournalUnavailable('write_failed');
        offset+=n;
      }
      this.#checkpoint('before_fsync');fs.fsyncSync(fd);
      this.#syncDir(this.#dir);this.#checkpoint('after_fsync');
      poison=false;
      return Object.freeze(built);
    }catch(e){
      if(poison)this.#poisoned=true;
      if(e instanceof JournalUnavailable)throw e;
      throw new JournalUnavailable('storage_io_failure');
    }finally{
      if(fd!==undefined)try{fs.closeSync(fd);}catch{this.#poisoned=true;}
      if(lockFd!==undefined){
        try{fs.closeSync(lockFd);}catch{this.#poisoned=true;}
        // Never remove an ambiguous lock after failed/durable-uncertain IO.
        if(!this.#poisoned){
          try{fs.unlinkSync(this.#lock);this.#syncDir(this.#dir);}
          catch{this.#poisoned=true;}
        }
      }
    }
  }
}
module.exports={DurableBookingJournal,JournalUnavailable,VERSION,MAX_BYTES};
