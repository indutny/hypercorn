'use strict';

const http = require('http');
const bodyParser = require('body-parser');
const util = require('util');
const express = require('express');
const Buffer = require('buffer').Buffer;

function API(backend) {
  this.app = express();

  this.app.use(bodyParser.json());

  http.Server.call(this, this.app);

  this.backend = backend;

  this._routes();
}
util.inherits(API, http.Server);
module.exports = API;

API.prototype._routes = function _routes() {
  const app = this.app;

  app.get('/api/info', (req, res) => {
    res.json({ feedKey: this.backend.getFeedKey().toString('base64') });
  });

  app.get('/api/timeline', (req, res) => this._handleTimeline(req, res));

  app.post('/api/trust', (req, res) => this._handleTrust(req, res));
  app.post('/api/follow', (req, res) => this._handleFollow(req, res));
  app.post('/api/unfollow', (req, res) => this._handleUnfollow(req, res));
  app.post('/api/post', (req, res) => this._handlePost(req, res));
};

API.prototype._handleTimeline = function _handleTimeline(req, res) {
  const feedKey = Buffer.from(req.query.feed_key, 'base64');

  const options = {
    feedKey,
    offset: parseInt(req.query.offset, 10),
    limit: parseInt(req.query.limit, 10)
  };
  this.backend.getTimeline(options, (err, posts) => {
    if (err)
      return res.json(500, { error: err.message });

    res.json({ ok: true, posts });
  });
};

API.prototype._handleTrust = function _handleTrust(req, res) {
  const body = req.body || {};

  const options = {};
  if (body.expires_in)
    options.expiresIn = body.expires_in;

  const feedKey = Buffer.from(body.feed_key, 'base64');
  const link = this.backend.trust(feedKey, options);

  res.json({ link: link.toString('hex') });
};

API.prototype._handleFollow = function _handleFollow(req, res) {
  const body = req.body || {};
  const feedKey = Buffer.from(body.feed_key, 'base64');
  this.backend.follow(feedKey);
  res.json({ ok: true });
};

API.prototype._handleUnfollow = function _handleUnfollow(req, res) {
  const body = req.body || {};
  const feedKey = Buffer.from(body.feed_key, 'base64');
  this.backend.unfollow(feedKey);
  res.json({ ok: true });
};

API.prototype._handlePost = function _handlePost(req, res) {
  const body = req.body || {};
  this.backend.post(body.content, body.meta || {});
  res.json({ ok: true });
};
