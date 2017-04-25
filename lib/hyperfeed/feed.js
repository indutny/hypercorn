'use strict';

const assert = require('assert');
const async = require('async');
const debug = require('debug')('hyperfeed:feed');
const util = require('util');
const hypercore = require('hypercore');
const hyperdiscovery = require('hyperdiscovery');

const Buffer = require('buffer').Buffer;
const EventEmitter = require('events').EventEmitter;

const hyperfeed = require('../hyperfeed');
const Meta = hyperfeed.Meta;

const DEFAULT_TIMEOUT = 30000;

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

  this.meta = new Meta();

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

  const start = { type: 'message', payload: { index: range.start } };
  const end = range.end && { type: 'message', payload: { index: range.end } };

  const watcher = this.node && this.node.watch({
    start: this.meta.generate(start),
    end: range.end && this.meta.generate(end)
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
    const meta = this.meta({
      type: 'message',
      payload: { index }
    }, value);
    this.node.insert(meta, callback);
  } else {
    debug('can\'t add meta');
    process.nextTick(callback, null);
  }
};

Feed.prototype.addReply = function addReply(index, reply, callback) {
  this.addMeta(index, {
    type: 'reply',
    payload: {
      feedKey: reply.feedKey,
      index: reply.index
    }
  }, callback);
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

      const keyStart = { type: 'message', payload: { index: start } };
      const keyEnd = { type: 'message', payload: { index: end } };

      // end <= start
      const values = this.node.request({
        start: this.meta.generate(keyEnd),
        end: this.meta.generate(keyStart)
      }).map(value => this.meta.parse(value));

      callback(null, values.filter(({ key }) => {
        return key.type === 'message';
      }).map(({ key, value }) => {
        return {
          index: key.payload.index,
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
        posts[index].meta.push(value);
    });

    callback(null, posts);
  });
};
