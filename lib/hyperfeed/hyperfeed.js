'use strict';

const async = require('async');
const assert = require('assert');
const debug = require('debug')('hyperfeed');
const path = require('path');
const mkdirp = require('mkdirp');
const HyperChain = require('hyperbloom-chain');
const HyperBloom = require('hyperbloom');
const Buffer = require('buffer').Buffer;

const hyperfeed = require('../hyperfeed');
const utils = hyperfeed.utils;
const Feed = hyperfeed.Feed;

const FEED_DIR = 'hypercore';
const BLOOM_DIR = 'hyperbloom';
const TRUST_DIR = 'trust.db';

const DEFAULT_EXPIRATION = 3600 * 24 * 365;  // 1 year

function HyperFeed(options) {
  this.options = Object.assign({}, options);
  assert.equal(typeof this.options.storage, 'string',
               '`options.storage` must be a path to directory');

  this.feedDir = path.join(this.options.storage, FEED_DIR);
  const bloomDir = path.join(this.options.storage, BLOOM_DIR);

  mkdirp.sync(this.feedDir);
  mkdirp.sync(bloomDir);

  let pair = {
    publicKey: this.options.publicKey,
    privateKey: this.options.privateKey
  };

  if (!pair.publicKey || !pair.privateKey)
    pair = utils.loadKey(this.options.storage);

  this.pair = pair;

  this.hyperbloom = new HyperBloom({
    storage: bloomDir,
    publicKey: this.pair.publicKey,
    privateKey: this.pair.privateKey,
    trust: {
      db: path.join(bloomDir, TRUST_DIR)
    }
  });

  this._chain = new HyperChain({ root: this.pair.publicKey });
  this._feeds = new Map();

  this._main = {
    feed: null,
    watcher: null
  };
}
module.exports = HyperFeed;

// Public

HyperFeed.prototype.listen = function listen(callback) {
  const feed = new Feed({
    hyperbloom: this.hyperbloom,
    feedDir: path.join(this.feedDir, this.pair.publicKey.toString('hex')),
    full: true,

    feedKey: this.pair.publicKey,
    privateKey: this.pair.privateKey
  });

  this._main.feed = feed;
  this._feeds.set(this.pair.publicKey.toString('base64'), feed);

  feed.once('ready', () => {
    const watcher = feed.watch({
      start: 0
    });
    watcher.message.on('data', msg => this._onSelfMessage(msg));

    this._main.watcher = watcher;

    callback(null);
  });
};

HyperFeed.prototype.close = function close(callback) {
  this.bloom.close(callback);

  const main = this._main;
  this._main = null;
  if (main.feed && main.watcher)
    main.feed.unwatch(main.watcher);
};

HyperFeed.prototype.getFeedKey = function getFeedKey() {
  return this.pair.publicKey;
};

// Timeline

HyperFeed.prototype.getTimeline = function getTimeline(options, callback) {
  assert(Buffer.isBuffer(options.feedKey),
         '`options.feedKey` must be a Buffer');
  assert.equal(typeof options.offset, 'number',
               '`options.offset` must be a Number');
  assert.equal(typeof options.limit, 'number',
               '`options.limit` must be a Number');

  const hexKey = options.feedKey.toString('base64');
  debug('timeline request key=%s offset=%d limit=%d', hexKey,
        options.offset, options.limit);

  if (this._feeds.has(hexKey)) {
    debug('timeline request hit');
    return this._feeds.get(hexKey).getTimeline(options, callback);
  }

  debug('timeline request miss');

  // No existing feeds, try to get sparse feed
  const feed = new Feed({
    hyperbloom: this.hyperbloom,
    feedDir: path.join(this.feedDir, options.feedKey.toString('hex')),
    full: false,

    feedKey: options.feedKey
  });

  feed.getTimeline(options, (err, data) => {
    feed.close(() => callback(err, data));
  });
};

// Messages

HyperFeed.prototype.trust = function trust(feedKey, options) {
  const base64PublicKey = feedKey.toString('base64');
  debug('trust key=%s', base64PublicKey);

  options = Object.assign({
    expiresIn: DEFAULT_EXPIRATION
  }, options);

  const expiresAt = Date.now() / 1000 + options.expiresIn;

  const link = this._chain.issueLink({
    feedKey,
    expiration: expiresAt
  }, this.pair.privateKey);

  this.feed.append('trust', {
    expires_at: expiresAt,
    feed_key: base64PublicKey,
    link: link.toString('base64')
  });

  return link;
};

HyperFeed.prototype.follow = function follow(feedKey) {
  const base64FeedKey = feedKey.toString('base64');
  debug('follow feed=%s', base64FeedKey);
  this.feed.append('follow', {
    feed_key: base64FeedKey
  });
};

HyperFeed.prototype.unfollow = function unfollow(feedKey) {
  const base64FeedKey = feedKey.toString('base64');
  debug('unfollow feed=%s', base64FeedKey);
  this.feed.append('unfollow', {
    feed_key: base64FeedKey
  });
};

HyperFeed.prototype.post = function post(content, meta) {
  debug('new post');
  this.feed.append('post', {
    content: content,
    reply_to: meta.replyTo
  });
};

// Private

HyperFeed.prototype._onSelfMessage = function _onSelfMessage(message) {
  if (message.type === 'follow')
    this._onFollow(message.payload);
  else if (message.type === 'unfollow')
    this._onUnfollow(message.payload);
  else if (message.type === 'trust')
    this._onTrust(message.payload);
};

HyperFeed.prototype._onFollow = function _onFollow(payload) {
  // TODO(indutny): ignore if invalid
  if (this._feeds.has(payload.feed_key))
    return;

  debug('on follow feed=%s', payload.feed_key);

  // TODO(indutny): load this from separate db
  const feedKey = Buffer.from(payload.feed_key, 'base64');

  const feed = new Feed({
    hyperbloom: this.hyperbloom,
    feedDir: path.join(this.feedDir, feedKey.toString('hex')),
    full: true,

    feedKey: feedKey
  });

  const watcher = feed.watch({
    start: 0
  });
  watcher.message.on('data', msg => this._onExternalMessage(msg, feedKey));

  this._feeds.set(payload.feed_key, feed);
};

HyperFeed.prototype._onUnfollow = function _onUnfollow(payload) {
  // TODO(indutny): ignore if invalid
  if (!this._feeds.has(payload.feed_key))
    return;

  debug('on unfollow feed=%s', payload.feed_key);

  const feed = this._feeds.get(payload_feed_key);
  feed.close(() => {});
};

HyperFeed.prototype._onTrust = function _onTrust(payload) {
  // TODO(indutny): ignore if invalid
  debug('on trust key=%s', payload.feed_key);

  const link = Buffer.from(payload.link, 'base64');
  this.hyperbloom.addLink(this.getFeedKey(), link);
};

HyperFeed.prototype._onExternalMessage = function _onExternalMessage(message,
                                                                     feedKey) {
  if (message.type === 'trust')
    this._onExternalTrust(message.payload, feedKey);
};

HyperFeed.prototype._onExternalTrust = function _onExternalTrust(payload,
                                                                 feedKey) {
  // TODO(indutny): ignore if invalid

  const link = Buffer.from(payload.link, 'base64');
  debug('on external trust key=%s by=%s', payload.feed_key,
        feedKey.toString('base64'));

  // TODO(indutny): refresh feeds to load hyperbloom nodes
  this.hyperbloom.addLink(feedKey, link);
};
