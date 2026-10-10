const catalog = require('../addons/catalog.json');
const { resolveStartUrl } = require('./security.cjs');
// Accept a document name, never a renderer-supplied destination or executable URL.
function resolveAssistanceGuide(providerId, kind) {
  if (kind !== 'guide' && kind !== 'faq') throw Error('Unknown assistance document.');
  const addon = catalog.find(item => item.id === providerId);
  const destination = addon?.bookingAssistance?.[kind === 'guide' ? 'guideUrl' : 'faqUrl'];
  if (!destination) throw Error('No official assistance document for this provider.');
  return resolveStartUrl(providerId, destination).url;
}
module.exports = { resolveAssistanceGuide };
