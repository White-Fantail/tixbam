'use strict';
const { ActionValidator, PASSIVE } = require('./action-validator.cjs');
const { RehearsalAdapter } = require('./rehearsal.cjs');
const { chooseOffer } = require('./preferences.cjs');

const MUTATION_HANDLERS = Object.freeze({
  // These are exclusively for offline fixtures. No live provider adapter,
  // downloaded add-on or AI tool may register a JS callback here.
  SELECT_APPROVED_OFFER: async ({adapter,target,scope}) => {
    const offer=target.value;
    if(!chooseOffer([offer],scope.preferences))throw new Error('Offer changed');
    await adapter.reserve(offer);
    const after=await adapter.read();
    if(after.eventKey!==scope.eventKey || after.stage!=='payment' ||
       !after.order || after.order.id!==offer.id ||
       after.order.totalMinor!==offer.totalMinor ||
       after.order.currency!==offer.currency ||
       after.order.quantity!==offer.quantity ||
       after.order.eventKey!==offer.eventKey ||
       after.order.feesIncluded!==true ||
       JSON.stringify(after.order.seats)!==JSON.stringify(offer.seats))
      return {code:'POSTCONDITION_FAILED'};
    return {code:'EXECUTED_REHEARSAL'};
  },
});

/** Independent protection for existing deterministic host-owned adapter calls.
 * This is NOT a backdoor for AI proposals: runner invokes it with its own
 * observed page and FSM only, and never passes a model response.
 */
function assertDeterministicHostAction({action,runner,page,offer}={}) {
  if(!runner || !page || runner.busy!==true ||
     runner.cancelled || runner.submitted ||
     runner.orchestrator?.machine?.phase!=='EXECUTING_ACTION' ||
     page.eventKey!==runner.state.eventKey)
    throw new Error('Unverified host action context');
  if(action==='SELECT_OPTIONS') {
    if(page.stage!=='options' || runner.selectionMade ||
       typeof runner.preferences?.options?.performance!=='string' ||
       !runner.preferences.options.performance ||
       !Array.isArray(runner.preferences.options.priceTier) ||
       runner.preferences.options.priceTier.length<1)
      throw new Error('Selection is not valid for this observed page');
    return true;
  }
  if(action==='RESERVE_OFFER') {
    if(page.stage!=='offers' || !offer ||
       offer.eventKey!==runner.state.eventKey ||
       chooseOffer([offer],runner.preferences)!==offer)
      throw new Error('Offer does not match the approved booking constraints');
    return true;
  }
  // Submission deliberately excluded. Host-owned PaymentExecutor is AB-13.
  throw new Error('Unsupported deterministic host operation');
}

/**
 * Host-only dispatcher for versioned AI/add-on proposals.
 * The first AB-03 release has NO live mutating handler. Non-mutating proposals
 * are advisory outcomes, not browser clicks or cancellation side effects.
 *
 * readCurrent: trusted host observer, not the AI payload. It MUST NOT refresh
 * the merchant page. When AB-04 lands it will supply generation-aware data.
 */
async function executeReviewedProposal({
  validator,proposal,scope,readCurrent,adapter,assertOwner
}={}) {
  const denied = code => Object.freeze({executed:false,code});
  if(!(validator instanceof ActionValidator) || !scope ||
     typeof assertOwner!=='function')return denied('WRONG_OWNER');
  let first=validator.validate(proposal,scope);
  if(!first.allowed)return denied(first.code);
  try {assertOwner();} catch {return denied('WRONG_OWNER');}
  if(PASSIVE.has(proposal.action)) {
    const claim=validator.claim(proposal,scope);
    if(!claim.decision.allowed)return denied(claim.decision.code);
    // STOP is a proposal for user intervention, never an automatic Stop().
    return Object.freeze({executed:false,code:'ADVISORY_ONLY',recommendation:proposal.action});
  }
  // No path for real add-on mutation until permission/review/release gates
  // from AB-01 and AB-12 are verified and separately implemented.
  if(scope.run?.rehearsal!==true || scope.rehearsalPermission!==true ||
     !(adapter instanceof RehearsalAdapter) ||
     !Object.hasOwn(MUTATION_HANDLERS,proposal.action))
    return denied('CAPABILITY_MISSING');
  if(typeof readCurrent!=='function')return denied('STALE_OBSERVATION');
  let page;
  try {page=await readCurrent();assertOwner();}
  catch{return denied('WRONG_OWNER');}
  if(!page || page.eventKey!==scope.eventKey ||
     page.stage!==proposal.expectedStage ||
     page.pageGeneration!==scope.pageGeneration ||
     page.challenge && page.challenge!=='none')return denied('STALE_OBSERVATION');
  // An async observer may have allowed user Stop, navigation or a policy
  // change. Check after the await and claim once before adapter execution.
  const claim=validator.claim(proposal,scope);
  if(!claim.decision.allowed)return denied(claim.decision.code);
  try {
    assertOwner();
    const result=await MUTATION_HANDLERS[proposal.action]({
      adapter,target:claim.target,scope,
    });
    return Object.freeze({executed:result.code==='EXECUTED_REHEARSAL',code:result.code});
  } catch {
    return denied('POSTCONDITION_FAILED');
  }
}

module.exports={assertDeterministicHostAction,executeReviewedProposal};
