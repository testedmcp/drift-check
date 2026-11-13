'use strict';

const crypto = require('crypto');

function descriptionHash(description) {
  return crypto.createHash('sha256').update(String(description ?? ''), 'utf8').digest('hex');
}

module.exports = { descriptionHash };
