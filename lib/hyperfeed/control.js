'use strict';

const http = require('http');
const util = require('util');
const Buffer = require('buffer').Buffer;

function Control(backend) {
  http.Server.call(this, (req, res) => this._onRequest(req, res));

  this.backend = backend;
}
util.inherits(Control, http.Server);
module.exports = Control;

Control.prototype._onRequest = function _onRequest(req, res) {
  function respond(code, data) {
    const body = JSON.stringify(data, null, 2);
    res.writeHead(code || 200, {
      'Content-Type': 'application/json',
      'Content-Length': body.length
    });
    res.end(body);
  };

  // Yes, we trust users that much
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
        return respond(400, { error: 'Invalid body' });
      }
    }

    try {
      this._handleRequest(req, body, respond);
    } catch (e) {
      return respond(500, { error: e.message, stack: e.stack });
    }
  });
};

Control.prototype._handleRequest = function _handleRequest(req, body, respond) {
  if (req.url === '/api/info')
    return respond(200, { feedKey: this.pair.publicKey.toString('hex') });

  if (req.method === 'POST') {
    if (req.url === '/api/trust')
      return this._handleTrust(req, body, respond);
    else if (req.url === '/api/follow')
      return this._handleFollow(req, body, respond);
    else if (req.url === '/api/unfollow')
      return this._handleUnfollow(req, body, respond);
    else if (req.url === '/api/post')
      return this._handlePost(req, body, respond);
  }

  respond(404, { error: 'Not found' });
};

Control.prototype._handleTrust = function _handleTrust(req, body, respond) {
  const options = {};
  if (body.expires_in)
    options.expiresIn = body.expires_in;

  const publicKey = Buffer.from(body.public_key, 'base64');
  const link = this.backend.trust(publicKey, options);

  respond(200, { link: link.toString('hex') });
};

Control.prototype._handleFollow = function _handleFollow(req, body, respond) {
  const feedKey = Buffer.from(body.feed_key, 'base64');
  this.backend.follow(feedKey);
  respond(200, { ok: true });
};

Control.prototype._handleUnfollow = function _handleUnfollow(req, body,
                                                             respond) {
  const feedKey = Buffer.from(body.feed_key, 'base64');
  this.backend.unfollow(feedKey);
  respond(200, { ok: true });
};

Control.prototype._handlePost = function _handlePost(req, body, respond) {
  this.backend.post(body.content, body.meta || {});
  respond(200, { ok: true });
};
