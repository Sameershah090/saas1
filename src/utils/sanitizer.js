const sanitizeFilename = require('sanitize-filename');

function sanitizePhoneNumber(phone) {
  if (!phone) return '';
  return phone.replace(/[^\d+]/g, '');
}

function sanitizeContactName(name) {
  if (!name) return 'Unknown';
  return name.replace(/[\x00-\x1F\x7F]/g, '').trim() || 'Unknown';
}

function escapeHTML(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeFilename(name) {
  return sanitizeFilename(name || 'unnamed');
}

module.exports = {
  sanitizePhoneNumber,
  sanitizeContactName,
  escapeHTML,
  safeFilename,
};
