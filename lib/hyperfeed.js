'use strict';

const async = require('async');
const assert = require('assert');
const debug = require('debug')('hyperfeed');
const http = require('http');
const path = require('path');
const mkdirp = require('mkdirp');
const HyperChain = require('hyperbloom-chain');
const HyperBloom = require('hyperbloom');
const Buffer = require('buffer').Buffer;

const utils = require('./hyperfeed/utils');
const Control = require('./hyperfeed/control');
const Feed = require('./hyperfeed/feed');

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

  this.feed = null;
  this.watcher = null;

  this.control = new Control(this);

  this.chain = new HyperChain({ root: this.pair.publicKey });

  this.following = new Map();
}
module.exports = HyperFeed;

// For testing
HyperFeed.utils = utils;
HyperFeed.Control = Control;
HyperFeed.Feed = Feed;

// Public

HyperFeed.prototype.listen = function listen(port, host, callback) {
  const onFeedReady = () => {
    this.watcher = this.feed.watch({
      start: 0
    });
    this.watcher.message.on('data', msg => this._onSelfMessage(msg));

    callback(null, {
      address: this.control.address().address,
      port: this.control.address().port,
      feedKey: this.pair.publicKey
    });
  };

  async.parallel({
    control: callback => this.control.listen(port, host, callback),
    hyperbloom: callback => this.hyperbloom.listen(callback)
  }, (err) => {
    if (err)
      return callback(err);

    const feed = new Feed({
      hyperbloom: this.hyperbloom,
      feedDir: path.join(this.feedDir, this.pair.publicKey.toString('hex')),
      full: true,

      feedKey: this.pair.publicKey,
      privateKey: this.pair.privateKey
    });

    this.feed = feed;

    feed.once('ready', onFeedReady);
  });
};

HyperFeed.prototype.close = function close(callback) {
  this.bloom.close(callback);
  if (this.feed && this.watcher)
    this.feed.unwatch(this.watcher);
};

// Messages

HyperFeed.prototype.trust = function trust(publicKey, options) {
  const base64PublicKey = publicKey.toString('base64');
  debug('trust key=%s', base64PublicKey);

  options = Object.assign({
    expiresIn: DEFAULT_EXPIRATION
  }, options);

  const expiresAt = Date.now() / 1000 + options.expiresIn;

  const link = this.chain.issueLink({
    publicKey,
    expiration: expiresAt
  }, this.pair.privateKey);

  this.feed.append('trust', {
    expires_at: expiresAt,
    public_key: base64PublicKey,
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
  if (this.following.has(payload.feed_key))
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

  this.following.set(payload.feed_key, feed);
};

HyperFeed.prototype._onUnfollow = function _onUnfollow(payload) {
  if (!this.following.has(payload.feed_key))
    return;

  debug('on unfollow feed=%s', payload.feed_key);

  const feed = this.following.get(payload_feed_key);
  feed.close(() => {});
};

HyperFeed.prototype._onTrust = function _onTrust(payload) {
  debug('on trust key=%s', payload.public_key);

  const link = Buffer.from(payload.link, 'base64');
  this.hyperbloom.addLink(this.pair.publicKey, link);
};

HyperFeed.prototype._onExternalMessage = function _onExternalMessage(message,
                                                                     feedKey) {
  if (message.type === 'trust')
    this._onExternalTrust(message.payload, feedKey);
};

HyperFeed.prototype._onExternalTrust = function _onExternalTrust(payload,
                                                                 feedKey) {
  const link = Buffer.from(payload.link, 'base64');
  debug('on external trust key=%s by=%s', payload.public_key,
        feedKey.toString('base64'));

  // TODO(indutny): refresh feeds to load hyperbloom nodes
  this.hyperbloom.addLink(feedKey, link);
};
