/**
 * AB-01 host-only capability decision. This intentionally cannot grant new
 * live autonomy: server flags, downloaded manifests and AI are not sufficient.
 */
const {localProfile}=require('./provider-runtime.cjs');
// All host-reviewed profiles must come from bundled, version-matched data.
const RELEASE_APPROVED = false; // AB-12 release gate must be independently reviewed.
const ACTIONS = new Set([
  'OBSERVE','SELECT_PERFORMANCE','SELECT_PRICE_TIER','LIST_OFFERS',
  'SELECT_OFFER','READ_ORDER','PREPARE_CHECKOUT','VERIFY_ORDER','PAYMENT_EXECUTOR',
]);

function localReview(providerId,addonVersion) {
  return localProfile(providerId,addonVersion);
}

function evaluateEffectiveCapability({
  providerId, addonVersion, country, capability, server, consent, released = RELEASE_APPROVED
} = {}) {
  const deny = reason => ({ allowed: false, reason });
  if (!ACTIONS.has(capability)) return deny('unknown_capability');
  if (!released || !RELEASE_APPROVED) return deny('host_release_not_approved');
  if (!server || server.schemaVersion !== 1 || server.globalKillSwitch !== false) return deny('kill_switch_or_missing_policy');
  const item = server.items?.find(p => p.providerId === providerId);
  if (!item || item.country !== country || item.ticketAgentRequired ||
      item.published !== true || item.autonomousCheckoutAvailable !== true) return deny('provider_not_authorized');
  const policy = item.policies?.find(p => p.capability === capability && p.country === country);
  if (!policy || policy.permissionState !== 'permitted' || policy.permitted !== true) return deny('permission_missing');
  const reviewed = localReview(providerId, addonVersion);
  if (!reviewed || reviewed.capabilities[capability] !== 'verified') return deny('unverified_implementation');
  if (!consent || consent.providerId !== providerId || consent.country !== country ||
      consent.addonVersion !== addonVersion || consent.capability !== capability ||
      consent.expiresAtMs <= Date.now()) return deny('explicit_consent_missing');
  return {allowed: true, reason: 'permitted'};
}

module.exports = { ACTIONS, localReview, evaluateEffectiveCapability };
