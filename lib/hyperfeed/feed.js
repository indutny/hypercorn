'use strict';

const assert = require('assert');
const async = require('async');
const debug = require('debug')('hyperfeed:feed');
const util = require('util');
const hypercore = require('hypercore');
const hyperdiscovery = require('hyperdiscovery');

const Buffer = require('buffer').Buffer;
const EventEmitter = require('events').EventEmitter;

const DEFAULT_TIMEOUT = 30000;

const FEED_KEY_SIZE = 32;

const KEY_TYPE_MESSAGE = 0;
const KEY_SIZE_MESSAGE = 5;

const VALUE_TYPE_REPLY = 0;
const VALUE_SIZE_REPLY = 1 + 32 + 4;

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
        // Most likely trust chain can't be built yet
        // TODO(indutny): check this exactly
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
      queue[i]();

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

  // TODO(indutny): figure out proper way to do this
  // XXX(indutny): THIS IS INCORRECT, AND WORKS ONLY BY A MIRACLE OF MANUAL
  // USER INPUT
  return this.hypercore.length;
};

Feed.prototype.addMeta = function addMeta(index, value, callback) {
  if (this.node) {
    debug('adding meta');
    const meta = this._meta(this._messageKey(index), value);
    this.node.insert(meta, callback);
  } else {
    debug('can\'t add meta');
    process.nextTick(callback, null);
  }
};

Feed.prototype.addReply = function addReply(index, reply, callback) {
  const value = this._replyValue(reply.feedKey, reply.index);
  this.addMeta(index, value, callback);
};

Feed.prototype.close = function close(callback) {
  debug('close');
  this._onReady(() => {
    this.hypercore.close();
    if (this.node)
      this.hyperbloom.leave(this.feedKey);
    this.swarm.destroy();
    callback(null);
  });
};

Feed.prototype.getTimeline = function getTimeline(options, callback) {
  const start = Math.max(0, this.hypercore.length - options.offset);
  const end = Math.max(0, start - options.limit);

  debug('downloading start=%d end=%d', start, end);
  async.parallel({
    posts: (callback) => {
      async.times(start - end, (i, callback) => {
        this.hypercore.get(end + i, callback);
      }, callback);
    },
    meta: (callback) => {
      if (!this.node)
        return callback(null, []);

      // end <= start
      const values = this.node.request({
        start: this._meta(this._messageKey(end)),
        end: this._meta(this._messageKey(start))
      }).map(value => this._parseMeta(value));

      callback(null, values.filter(v => v).filter(({ key }) => {
        return this._isMessageKey(key);
      }).map(({ key, value }) => {
        return {
          index: this._parseMessageKey(key),
          value
        };
      }));
    }
  }, (err, result) => {
    if (err)
      return callback(err);

    debug('downloaded start=%d end=%d', start, end);
    // Filter out `NaN`s
    const posts = result.posts.map(post => ({ post, meta: [] }));
    result.meta.forEach(({ index, value }) => {
      index -= end;
      if (0 <= index && index < posts.length)
        posts[index].meta.push(this._parseMetaValue(value));
    });

    callback(null, posts);
  });
};

// Private

Feed.prototype._messageKey = function _messageKey(index) {
  const key = Buffer.alloc(KEY_SIZE_MESSAGE);

  key[0] = KEY_TYPE_MESSAGE;
  key.writeUInt32BE(index, 1);

  return key;
};

Feed.prototype._isMessageKey = function _isMessageKey(key) {
  return key.length === KEY_SIZE_MESSAGE && key[0] === KEY_TYPE_MESSAGE;
};

Feed.prototype._parseMessageKey = function _parseMessageKey(key) {
  return key.readUInt32BE(1);
};

Feed.prototype._replyValue = function _replyValue(feedKey, index) {
  assert.equal(feedKey.length, FEED_KEY_SIZE, 'Invalid `feedKey` size');

  const value = Buffer.alloc(VALUE_SIZE_REPLY);

  let offset = 0;
  value[offset] = VALUE_TYPE_REPLY;
  offset++;

  feedKey.copy(value, offset);
  offset += feedKey.length;

  value.writeUInt32BE(index, offset);

  return value;
};

Feed.prototype._isReplyValue = function _isReplyValue(value) {
  return value.length === VALUE_SIZE_REPLY && value[0] === VALUE_TYPE_REPLY;
};

Feed.prototype._parseReplyValue = function _parseReplyValue(value) {
  return {
    feedKey: value.slice(1, 1 + 32).toString('base64'),
    index: value.readUInt32BE(33)
  };
};

Feed.prototype._parseMetaValue = function _parseMetaValue(value) {
  if (this._isReplyValue(value)) {
    return {
      type: 'reply',
      body: this._parseReplyValue(value)
    };
  } else {
    return value.toString('base64');
  }
};

Feed.prototype._meta = function _meta(key, value) {
  if (typeof key === 'string')
    key = Buffer.from(key);
  if (typeof value === 'string')
    value = Buffer.from(value);
  else if (!value)
    value = Buffer.alloc(0);

  assert(key.length < 128 && value.length < 256,
         'meta keys and values can\'t be greater than 127 and 255');

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

Feed.prototype._parseMeta = function _parseMeta(raw) {
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

  return { key, value };
};
