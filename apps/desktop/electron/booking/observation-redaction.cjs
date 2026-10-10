'use strict';

/** AB-04: explicit allowlist projection; never forward raw HTML, labels,
 * URLs, account/run/window/provider-event IDs, receipts, cookies or cards.
 * No field from a remote web page is treated as an instruction.
 */
const STAGES = Object.freeze(new Set(['unknown','landing','queue','login','options','offers','cart','checkout','bank_challenge','receipt','access_blocked']));
const CHALLENGES = Object.freeze(new Set(['none','captcha','queue','login','3ds','consent','unknown']));
const HANDLE_KINDS = Object.freeze(new Set(['performance','price_tier','offer','delivery','navigation']));
const isObject = o => o!==null && typeof o==='object' && !Array.isArray(o) &&
  (Object.getPrototypeOf(o)===Object.prototype || Object.getPrototypeOf(o)===null);
const integer = n => Number.isSafeInteger(n) && n>=0;
const MAX_OPTIONS = 30;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,79}$/;

function classifyPage(page) {
  // Generic old adapter stages are mapped without accepting arbitrary words.
  const aliases={payment:'checkout',confirmation:'receipt'};
  const stage=Object.hasOwn(aliases,page?.stage)?aliases[page.stage]:
    (STAGES.has(page?.stage)?page.stage:'unknown');
  const challenge=CHALLENGES.has(page?.challengeType) ? page.challengeType : (
    // Legacy test fixture contains a fixed simulated handoff, not arbitrary HTML.
    page?.challenge ? 'unknown' : 'none');
  return Object.freeze({stage: challenge==='none'?stage:
    (challenge==='queue'?'queue':challenge==='login'?'login':
     challenge==='3ds'?'bank_challenge':stage),challenge});
}

/** Raw provider option identifiers are used ONLY inside host memory.
 * No element labels, raw page text, freeform errors, or unsupported fields.
 * Suspicious or oversized collections are discarded wholesale.
 */
function normalizeOptions(page, source) {
  if(source!=='verified_adapter' || page?.stage!=='options')return [];
  const groups=[['performance','performance'],['priceTier','price_tier']];
  const normalized=[];
  for(const [key,kind] of groups) {
    const choices=page?.options?.[key];
    if(!Array.isArray(choices) || choices.length>MAX_OPTIONS) return [];
    const seen=new Set();
    for(const entry of choices) {
      if(!isObject(entry) || typeof entry.id!=='string' || !ID.test(entry.id) ||
         typeof entry.available!=='boolean' || seen.has(entry.id))return [];
      seen.add(entry.id);
      if(!entry.available) continue; // disabled controls cannot be proposed
      normalized.push(Object.freeze({kind,value:entry.id,available:true}));
    }
  }
  return normalized.slice(0,MAX_OPTIONS);
}

function normalizeOfferTargets(page,source) {
  // Until AB-10 proves each provider's offers and exact fee model, do not
  // create executable offer handles from live pages. Rehearsal fixtures can.
  if(source!=='rehearsal' || page?.stage!=='offers' ||
     !Array.isArray(page.offers) || page.offers.length>MAX_OPTIONS)return [];
  return page.offers.filter(o=>isObject(o)&&o.available===true).slice(0,MAX_OPTIONS)
    .map(o=>({kind:'offer',value:o,available:true}));
}

function safeOrderSummary(page) {
  const o=page?.order;
  if(!isObject(o))return null;
  const count=o.quantity,minor=o.totalMinor,currency=o.currency;
  return Object.freeze({
    ticketCount:integer(count)&&count<=20?count:null,
    currency:typeof currency==='string'&&/^[A-Z]{3}$/.test(currency)?currency:null,
    allInTotalMinor:integer(minor)&&minor>0?minor:null,
    feesIncluded:o.feesIncluded===true,
    merchantVerified:false, // not a provider receipt or order proof
  });
}

/** AI input is a closed, coarse, non-identifying schema.
 * Even host-only IDs and targetRef are excluded. Target choice is enabled
 * through separately generated one-use task tokens, never DOM identities.
 */
function projectAIObservation(host,taskTargets=[]) {
  if(!isObject(host) || !STAGES.has(host.stage) ||
     !CHALLENGES.has(host.challenge) || !Array.isArray(taskTargets))
    throw new TypeError('Invalid host observation');
  const counts={performance:0,price_tier:0,offer:0,delivery:0,navigation:0};
  for(const item of taskTargets) {
    if(!isObject(item) || !HANDLE_KINDS.has(item.kind) ||
       typeof item.token!=='string')throw new TypeError('Unsafe AI handle');
    counts[item.kind]+=1;
  }
  return Object.freeze({
    schemaVersion:1,
    stage:host.stage,
    challenge:host.challenge,
    confidence:host.confidence==='verified'?'verified':
      host.confidence==='partial'?'partial':'unknown',
    optionCounts:Object.freeze({...counts}),
    targets:Object.freeze(taskTargets.map(({token,kind})=>Object.freeze({token,kind}))),
    // No prices/fee totals or arbitrary text from a website are uploaded.
    // AB-08 may add approved non-identifying constraint bands later.
  });
}
module.exports={STAGES,CHALLENGES,isObject,integer,MAX_OPTIONS,
  classifyPage,normalizeOptions,normalizeOfferTargets,safeOrderSummary,projectAIObservation};
