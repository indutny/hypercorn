'use strict';

const assert = require('assert');
const Buffer = require('buffer').Buffer;

const FEED_KEY_SIZE = 32;

const KEY_TYPE = {
  MESSAGE: 0,
};

const KEY_SIZE = {
  MESSAGE: 5
};

const VALUE_TYPE = {
  REPLY: 0
};

const VALUE_SIZE = {
  REPLY: 1 + FEED_KEY_SIZE + 4
};

function Meta() {
}
module.exports = Meta;

// General

Meta.prototype.generate = function generate(key, value) {
  key = this.generateKey(key.type, key.payload);
  value = value ? this.generateValue(value.type, value.payload) :
          Buffer.alloc(0);

  const meta = Buffer.alloc(1 + key.length + 1 + value.length);

  let offset = 0;
  meta[offset] = key.length;
  offset++;
  key.copy(meta, offset);
  offset += key.length;
  meta[offset] = value.length;
  offset++;
  value.copy(meta, offset);
  offset += value.length;
  assert.equal(offset, meta.length);

  return meta;
};

Meta.prototype.parse = function parse(raw) {
  let offset = 0;
  let len = raw.length;

  if (len < 1)
    return false;

  const keyLen = raw[offset];
  offset++;
  len--;
  if (len < keyLen)
    return false;

  const key = raw.slice(offset, offset + keyLen);
  offset += keyLen;
  len -= keyLen;
  if (len < 1)
    return false;

  const valueLen = raw[offset];
  offset++;
  len--;
  if (len < valueLen)
    return false;

  const value = raw.slice(offset, offset + valueLen);
  offset += valueLen;
  len -= valueLen;
  if (len !== 0)
    return false;

  return { key: this.parseKey(key), value: this.parseValue(value) };
};

// Keys/Values

Meta.prototype.generateKey = function generateKey(type, payload) {
  if (type === 'message')
    return this._generateKeyMessage(payload);
  else
    throw new Error(`Unknown key type: ${type}`);
};

Meta.prototype.parseKey = function parseKey(key) {
  if (this.isKey('message', key))
    return { type: 'message', payload: this._parseKeyMessage(key) };
  else
    return { type: 'unknown', payload: key };
};

Meta.prototype.isKey = function isKey(type, key) {
  if (type === 'message')
    return this._isKeyMessage(key);
  else
    return false;
};

Meta.prototype.generateValue = function generateValue(type, payload) {
  if (type === 'reply')
    return this._generateValueReply(payload);
  else
    throw new Error(`Unknown key type: ${type}`);
};

Meta.prototype.parseValue = function parseValue(value) {
  if (this.isValue('reply', value))
    return { type: 'reply', payload: this._parseValueReply(value) };
  else
    return { type: 'unknown', payload: value };
};

Meta.prototype.isValue = function isValue(type, value) {
  if (type === 'reply')
    return this._isValueReply(value);
  else
    return false;
};

// Private

Meta.prototype._generateKeyMessage = function _generateKeyMessage({ index }) {
  assert(isFinite(index), FEED_KEY_SIZE, '`index` must be integer');

  const key = Buffer.alloc(KEY_SIZE.MESSAGE);

  key[0] = KEY_TYPE.MESSAGE;
  key.writeUInt32BE(index, 1);

  return key;
};

Meta.prototype._isKeyMessage = function _isKeyMessage(key) {
  return key.length === KEY_SIZE.MESSAGE && key[0] === KEY_TYPE.MESSAGE;
};

Meta.prototype._parseKeyMessage = function _parseKeyMessage(key) {
  return { index: key.readUInt32BE(1) };
};

Meta.prototype._generateValueReply = function _generateValueReply(options) {
  assert.equal(options.feedKey.length, FEED_KEY_SIZE, 'Invalid `feedKey` size');
  assert(isFinite(options.index), FEED_KEY_SIZE, '`index` must be integer');

  const value = Buffer.alloc(VALUE_SIZE.REPLY);

  let offset = 0;
  value[offset] = VALUE_TYPE.REPLY;
  offset++;

  options.feedKey.copy(value, offset);
  offset += feedKey.length;

  value.writeUInt32BE(options.index, offset);

  return value;
};

Meta.prototype._isValueReply = function _isValueReply(value) {
  return value.length === VALUE_SIZE.REPLY && value[0] === VALUE_TYPE.REPLY;
};

Meta.prototype._parseValueReply = function _parseValueReply(value) {
  return {
    feedKey: value.slice(1, 1 + FEED_KEY_SIZE).toString('base64'),
    index: value.readUInt32BE(1 + FEED_KEY_SIZE)
  };
};
