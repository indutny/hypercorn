'use strict';

const Buffer = require('buffer').Buffer;

function FeedKey(value) {
  this.value = value;
}
module.exports = FeedKey;

FeedKey.from = function from(value) {
  if (value instanceof FeedKey)
    return value;
  else if (typeof value === 'string')
    return new FeedKey(Buffer.from(value, 'base64'));
  else
    return new FeedKey(value);
};

FeedKey.prototype.toJSON = function toJSON() {
  return this.value.toString('base64');
};

FeedKey.prototype.toBuffer = function toBuffer() {
  return this.value;
};
