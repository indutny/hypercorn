'use strict';

const assert = require('assert');
const async = require('async');
const debug = require('debug')('hypercorn:feed');
const util = require('util');
const ram = require('random-access-memory');
const hypercore = require('hypercore');
const hyperdiscovery = require('hyperdiscovery');

const Buffer = require('buffer').Buffer;
const EventEmitter = require('events').EventEmitter;

const hypercorn = require('../hypercorn');
const Meta = hypercorn.Meta;

const DEFAULT_TIMEOUT = 30000;

const SCRAPE_LIMIT = 100;
const MIN_SPARSE_PEERS = 1;

function Feed(options) {
  EventEmitter.call(this);

  this.writable = !!options.privateKey;
  this.sparse = options.full === false;
  this.feedKey = options.feedKey;
  this.hyperbloom = options.hyperbloom;

  this.meta = new Meta();

  const joinHyperBloom = (callback) => {
    const bloom = {
      full: !this.sparse
    };
    this.hyperbloom.join(this.feedKey, bloom, (err, node) => {
      // Most likely trust chain can't be built yet
      // TODO(indutny): check this exactly
      if (err) {
        assert(!this.writable);
        return callback(null, null);
      }

      this.node = node;
      return callback(null, node);
    });
  };

  const onHyperCore = (err) => {
    if (err)
      return this.emit('error', err);

    debug('hypercore updated');
    if (this.node)
      return this._emitReady();

    // Scrape trust and retry
    this._scrapeTrust(() => {
      joinHyperBloom(() => {
        if (this.node)
          debug('scrape successful');
        else
          debug('scrape not successful');
        this._emitReady();
      });
    });
  };

  const onHyperBloom = () => {
    const feedStorage = this.sparse ? () => ram() : options.feedDir;

    this.hypercore = hypercore(feedStorage, this.feedKey, {
      secretKey: options.privateKey,
      sparse: this.sparse,
      storeSecretKey: false,
      valueEncoding: 'json'
    });

    this.hypercore.ready(() => {
      debug('hypercore ready');
      this.swarm = hyperdiscovery(this.hypercore, { live: true });

      // TODO(indutny): this sounds hacky
      // We need this event to do the first post
      this.emit('hypercore');

      if (this.hypercore.length === 0) {
        debug('hypercore empty, updating');
        this.hypercore.update(onHyperCore);
      } else {
        onHyperCore();
      }
    });
  };

  joinHyperBloom(onHyperBloom);

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

Feed.prototype._onReady = function _onReady(callback) {
  if (this._ready)
    return process.nextTick(callback);

  this._queue.push(callback);
};

Feed.prototype.watch = function watch(range, callback) {
  assert.equal(typeof range, 'object', '`range` must be an Object');
  assert.equal(typeof range.start, 'number', '`range.start` must be a Number');
  assert(typeof range.end === 'number' || !range.end,
         '`range.end` must be a Number or not be present');

  const options = {
    wait: true,
    timeout: DEFAULT_TIMEOUT
  };

  const start = { type: 'message', payload: { index: range.start } };
  const end = range.end && { type: 'message', payload: { index: range.end } };

  this._onReady(() => {
    const watcher = this.node && this.node.watch({
      start: this.meta.generate(start),
      end: range.end && this.meta.generate(end)
    });

    process.nextTick(callback, null, {
      message: this.hypercore.createReadStream({
        start: range.start,
        end: range.end,
        live: !range.end,
        wait: true
      }),
      meta: watcher
    });
  });
};

Feed.prototype.unwatch = function unwatch(obj) {
  if (this.node)
    this.node.unwatch(obj.meta);
};

Feed.prototype.append = function append(type, payload, callback) {
  assert(this.writable, 'Feed not writable');
  assert.equal(typeof type, 'string', '`type` must be a String');
  assert.equal(typeof payload, 'object', '`payload` must be an Object');

  const now = Date.now() / 1000;
  this.hypercore.append({
    type: type,
    created_at: now,
    payload: payload
  }, (err) => {
    // See: https://github.com/mafintosh/hypercore/issues/94
    if (callback)
      callback(err, this.hypercore.length - 1);
  });
};

Feed.prototype.addMeta = function addMeta(index, value, callback) {
  assert.equal(typeof index, 'number', '`index` must be a Number');
  assert.equal(typeof value, 'object', '`value` must be an Object');

  if (!this.node) {
    debug('can\'t add meta');
    process.nextTick(callback, null);
    return;
  }

  debug('adding meta');
  const meta = this.meta.generate({
    type: 'message',
    payload: { index }
  }, value);

  if (this.sparse) {
    debug('sparse hyperbloom, wait for peers');
    this.node.onPeers((err, count) => {
      debug('got hyperbloom peers=%d', count);
      this.node.insert(meta, { minPeers: MIN_SPARSE_PEERS }, callback);
    });
  } else {
    this.node.insert(meta, callback);
  }
};

Feed.prototype.addReply = function addReply(index, reply, callback) {
  assert.equal(typeof index, 'number', '`index` must be a Number');
  assert.equal(typeof reply, 'object', '`reply` must be an Object');
  assert(Buffer.isBuffer(reply.feedKey), '`reply.feedKey` must be a Buffer');
  assert.equal(typeof reply.index, 'number',
               '`reply.index` must be a Number');

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
    debug('closing hypercore');
    this.hypercore.close();
    if (this.node) {
      debug('closing hyperbloom');
      this.hyperbloom.leave(this.feedKey);
    }
    debug('destroying hypercore swarm');
    this.swarm.destroy();

    callback(null);
  });
};

Feed.prototype.getTimeline = function getTimeline(options, callback) {
  assert.equal(typeof options, 'object', '`options` must be an Object');
  assert.equal(typeof options.offset, 'number',
               '`options.offset` must be a Number');
  assert.equal(typeof options.limit, 'number',
               '`options.limit` must be a Number');

  const onLength = () => {
    const end = Math.max(0, this.hypercore.length - options.offset);
    const start = Math.max(0, end - options.limit);

    debug('downloading start=%d end=%d', start, end);

    async.parallel({
      messages: (callback) => {
        const messages = [];
        this.hypercore.createReadStream({
          start,
          end
        }).on('data', (message) => {
          messages.push(message);
        }).once('end', () => {
          callback(null, messages);
        }).on('error', (err) => {
          callback(err);
        });
      },
      meta: (callback) => {
        if (!this.node)
          return callback(null, []);

        const keyStart = { type: 'message', payload: { index: start } };
        const keyEnd = { type: 'message', payload: { index: end } };

        const values = this.node.request({
          start: this.meta.generate(keyStart),
          end: this.meta.generate(keyEnd)
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

      const messages = result.messages.map((message, index) => {
        return { message, index, meta: [] };
      });

      result.meta.forEach(({ index, value }) => {
        index -= start;
        if (0 <= index && index < messages.length)
          messages[index].meta.push(value);
      });

      callback(null, messages);
    });
  };

  if (this.hypercore.length === 0)
    this.hypercore.update(onLength);
  else
    onLength();
};

Feed.prototype.getMessage = function getMessage(options, callback) {
  assert.equal(typeof options, 'object', '`options` must be an Object');
  assert.equal(typeof options.index, 'number',
               '`options.index` must be a Number');

  const index = options.index;
  debug('get message index=%d', index);

  async.parallel({
    message: callback => this.hypercore.get(index, callback),
    meta: (callback) => {
      if (!this.node)
        return callback(null, []);

      const keyStart = { type: 'message', payload: { index } };
      const keyEnd = { type: 'message', payload: { index: index + 1 } };

      const values = this.node.request({
        start: this.meta.generate(keyStart),
        end: this.meta.generate(keyEnd)
      }).map(value => this.meta.parse(value));

      callback(null, values.filter(({ key }) => {
        return key.type === 'message' && key.payload.index === index;
      }).map(({ key, value }) => {
        return value;
      }));
    }
  }, (err, result) => {
    if (err)
      return callback(err);

    debug('get message done index=%d', index);

    callback(null, {
      message: result.message,
      index,
      meta: result.meta
    });
  });
};

// Private

Feed.prototype._scrapeTrust = function _scrapeTrust(callback) {
  assert(!this.node);

  debug('scraping for trust');
  this.hypercore.createReadStream({
    start: Math.max(0, this.hypercore.length - SCRAPE_LIMIT),
    end: this.hypercore.length
  }).on('data', (message) => {
    if (message.type !== 'trust')
      return;

    this.emit('trust', message);
  }).once('end', () => {
    debug('scraping for trust done');
    callback(null);
  }).on('error', (err) => {
    callback(err);
  });
};

Feed.prototype._emitReady = function _emitReady() {
  this._ready = true;
  const queue = this._queue;
  this._queue = [];
  for (let i = 0; i < queue.length; i++)
    queue[i]();

  this.emit('ready');
};
