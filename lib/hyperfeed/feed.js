'use strict';

const assert = require('assert');
const async = require('async');
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

  const bloom = {
    full: options.full !== false
  };

  async.parallel({
    hypercore: callback => this.hypercore.ready(callback),
    hyperbloom: (callback) => {
      this.hyperbloom.join(this.feedKey, bloom, (err, node) => {
        if (err)
          return callback(null, null);
        else
          return callback(null, node);
      });
    }
  }, (err, data) => {
    if (err)
      return this.emit('error', err);

    this.swarm = hyperdiscovery(this.hypercore);
    assert(!this.writable || data.hyperbloom);
    this.node = data.hyperbloom;

    this._ready = true;
    const queue = this._queue;
    this._queue = [];
    for (let i = 0; i < queue.length; i++)
      queue();

    this.emit('ready');
  });
  this._ready = false;
  this._queue = [];

  this.swarm = null;
  this.node = null;
}
util.inherits(Feed, EventEmitter);
module.exports = Feed;

Feed.prototype.getLength = function getLength() {
  return this.hypercore.length;
};

Feed.prototype._onReady = function _onReady(cb) {
  if (this._ready)
    return process.nextTick(cb);

  this._queue.push(cb);
};

Feed.prototype.watch = function watch(range, callback) {
  const options = {
    wait: true,
    timeout: DEFAULT_TIMEOUT
  };

  const watcher = this.node && this.node.watch({
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
  if (this.node)
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
  if (this.node)
    this.node.insert([ meta ]);
};

Feed.prototype.close = function close() {
  this._onReady(() => {
    this.hypercore.close();
    this.swarm.destroy();
  });
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
