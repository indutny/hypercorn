'use strict';

const async = require('async');
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const mkdirp = require('mkdirp');
const signatures = require('sodium-signatures');
const HyperChain = require('hyperbloom-chain');
const HyperBloom = require('hyperbloom');
const Buffer = require('buffer').Buffer;

const Feed = require('./hyperfeed/feed');

const KEY_FILE = 'key.json';
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
    pair = this._loadKey();

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

  this.control = http.createServer((req, res) => this._onRequest(req, res));

  this.chain = new HyperChain({ root: this.pair.publicKey });

  this.feeds = new Map();
}
module.exports = HyperFeed;

// For testing
HyperFeed.Feed = Feed;

// Public

HyperFeed.prototype.listen = function listen(port, host, callback) {
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
    this.feeds.set(this.pair.publicKey.toString('base64'), feed);

    feed.once('ready', () => {
      callback(null, {
        address: this.control.address().address,
        port: this.control.address().port,
        feedKey: this.pair.publicKey
      });
    });
  });
};

HyperFeed.prototype.close = function close(callback) {
  this.bloom.close(callback);
};

HyperFeed.prototype.follow = function follow(publicKey, options) {
  options = Object.assign({
    expiresIn: DEFAULT_EXPIRATION
  }, options);

  const link = this.chain.issueLink({
    publicKey,
    expiration: Date.now() / 1000 + options.expiresIn
  }, this.pair.privateKey);

  this.hyperbloom.addLink(this.pair.publicKey, link);

  this.feed.append({
    type: 'trust',
    payload: {
      publicKey: publicKey.toString('base64'),
      link: link.toString('base64')
    }
  });
  return link;
};

// Private

HyperFeed.prototype._onRequest = function _onRequest(req, res) {
  function json(code, data) {
    const body = JSON.stringify(data, null, 2);
    res.writeHead(code || 200, {
      'Content-Type': 'application/json',
      'Content-Length': body.length
    });
    res.end(body);
  }

  let chunks = '';
  req.on('data', chunk => chunks += chunk);
  req.once('end', () => {
    let body;
    if (req.method === 'POST') {
      try {
        body = JSON.parse(chunks);
        if (body === null || typeof body !== 'object')
          throw new Error('Invalid body');
      } catch (e) {
        return json(400, { error: 'Invalid body' });
      }
    }

    try {
      this._onControl(req, body, json);
    } catch (e) {
      return json(500, { error: e.message, stack: e.stack });
    }
  });
};

HyperFeed.prototype._onControl = function _onControl(req, body, respond) {
  if (req.url === '/')
    return respond(200, { feedKey: this.pair.publicKey.toString('hex') });

  if (req.method === 'POST') {
    if (req.url === '/follow') {
      const options = {};
      if (body.expiresIn)
        options.expiresIn = body.expiresIn;

      const link = this.follow(Buffer.from(body.publicKey, 'hex'), options);

      return respond(200, { link: link.toString('hex') });
    }
  }

  respond(404, { error: 'Not found' });
};

HyperFeed.prototype._loadKey = function _loadKey() {
  const dir = this.options.storage;
  const file = path.join(dir, KEY_FILE);

  if (fs.existsSync(file)) {
    const data = fs.readFileSync(file).toString();
    const json =JSON.parse(
        data.split(/\r\n|\n/g).filter(line => !/^\s*#/.test(line)).join('\n'));

    assert.equal(typeof json['public'], 'string',
                 `missing \`public\` in key file ${file}`);
    assert.equal(typeof json['private'], 'string',
                 `missing \`private\` in key file ${file}`);

    return {
      publicKey: Buffer.from(json['public'], 'base64'),
      privateKey: Buffer.from(json['private'], 'base64')
    };
  }

  const pair = signatures.keyPair();

  const lines = [
    '#',
    '#',
    '#           WARNING',
    '# DO NOT SHARE THIS WITH ANYONE',
    '# THIS IS YOUR HYPERFEED IDENTITY',
    '#',
    '#',
    JSON.stringify({
      'public': pair.publicKey.toString('base64'),
      'private': pair.secretKey.toString('base64')
    }, null, 2),
    '#',
    '#',
    '#    END OF SENSITIVE DATA',
    '#',
    '#'
  ];
  fs.writeFileSync(file, lines.join('\n'));

  return {
    publicKey: pair.publicKey,
    privateKey: pair.secretKey
  };
};
