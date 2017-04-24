'use strict';

const assert = require('assert');
const util = require('util');
const hypercore = require('hypercore');
const hyperdiscovery = require('hyperdiscovery');

const Buffer = require('buffer').Buffer;
const EventEmitter = require('events').EventEmitter;

const DEFAULT_TIMEOUT = 30000;
const MESSAGE_PREFIX = 'p/';

function Feed(options) {
  EventEmitter.call(this);

  this.writable = !!options.privateKey;
  this.feedKey = options.feedKey;
  this.hyperbloom = options.hyperbloom;

  this.hypercore = hypercore(options.feedDir, this.feedKey, {
    secretKey: options.privateKey,
    sparse: options.full === false,
    storeSecretKey: false,
    valueEncoding: 'json'
  });

  this.hypercore.ready(() => {
    hyperdiscovery(this.hypercore);
  });

  this.node = null;

  this.hyperbloom.join(options.feedKey, {
    full: options.full !== false
  }, (err, node) => {
    if (err)
      return this.emit('error', err);

    this.node = node;
    this.emit('ready');
  });
}
util.inherits(Feed, EventEmitter);
module.exports = Feed;

Feed.prototype.getLength = function getLength() {
  return this.hypercore.length;
};

Feed.prototype.watch = function watch(range, callback) {
  const options = {
    wait: true,
    timeout: DEFAULT_TIMEOUT
  };

  const watcher = this.node.watch({
    start: this._meta(this._messageKey(range.start)),
    end: range.end && this._meta(this._messageKey(range.end))
  });

  return {
    message: this.hypercore.createReadStream({
      start: range.start,
      end: range.end,
      live: !range.end,
      wait: true
    }),
    meta: watcher
  };
};

Feed.prototype.unwatch = function unwatch(obj) {
  this.node.unwatch(obj.meta);
};

Feed.prototype.append = function append(type, payload) {
  assert(this.writable, 'Feed not writable');
  const now = Date.now() / 1000;
  this.hypercore.append({
    type: type,
    created_at: now,
    payload: payload
  });
};

Feed.prototype.addMeta = function addMeta(key, value) {
  const meta = this._meta(key, value);
  this.node.insert([ meta ]);
};

// Private

Feed.prototype._messageKey = function _messageKey(index) {
  // Pad to 32-bit hex value
  let str = index.toString(16);
  while (str.length < 8)
    str = '0' + str;
  return MESSAGE_PREFIX + str;
};

Feed.prototype._meta = function _meta(key, value) {
  if (typeof key === 'string')
    key = Buffer.from(key);
  if (typeof value === 'string')
    value = Buffer.from(value);
  else if (!value)
    value = Buffer.alloc(0);

  assert(key.length < 256 && value.length < 256,
         'meta keys and values can\'t be bigger than 255');

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
