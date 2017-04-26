'use strict';

const http = require('http');
const bodyParser = require('body-parser');
const util = require('util');
const express = require('express');
const Buffer = require('buffer').Buffer;
const Joi = require('joi');
const Celebrate = require('celebrate');

const hypercorn = require('../hypercorn');
const schema = hypercorn.schema;

const DEFAULT_TIMELINE_LIMIT = 64;

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

  // GET

  app.get('/api/info', (req, res) => {
    res.json({ feedKey: this.backend.getFeedKey().toString('base64') });
  });

  app.get('/api/timeline', Celebrate({
    query: {
      feed_key: Joi.string().base64().optional(),
      offset: Joi.number().min(0).optional(),
      limit: Joi.number().min(1).optional()
    }
  }), (req, res) => this._handleTimeline(req, res));

  app.get('/api/message', Celebrate({
    query: {
      feed_key: Joi.string().base64().optional(),
      index: Joi.number().min(0).required()
    }
  }), (req, res) => this._handleMessage(req, res));

  // POST

  app.post('/api/post', Celebrate({
    body: schema.Post
  }), (req, res) => this._handlePost(req, res));

  app.post('/api/trust', Celebrate({
    body: schema.Trust
  }), (req, res) => this._handleTrust(req, res));

  app.post('/api/follow', Celebrate({
    body: schema.Follow
  }), (req, res) => this._handleFollow(req, res));

  app.post('/api/unfollow', Celebrate({
    body: schema.Unfollow
  }), (req, res) => this._handleUnfollow(req, res));

  this.app.use(Celebrate.errors());
};

API.prototype._feedKey = function _feedKey(raw) {
  if (raw)
    return Buffer.from(raw, 'base64');
  else
    return this.backend.getFeedKey();
};

API.prototype._handleTimeline = function _handleTimeline(req, res) {
  const feedKey = this._feedKey(req.query.feed_key);
  const offset = req.query.offset;
  const limit = req.query.limit;

  const options = {
    offset,
    limit,
    feedKey
  };

  if (!options.offset)
    options.offset = 0;
  if (!options.limit)
    options.limit = DEFAULT_TIMELINE_LIMIT;

  this.backend.getTimeline(options, (err, messages) => {
    if (err)
      return res.json(500, { error: err.message });

    res.json({ ok: true, messages });
  });
};

API.prototype._handleMessage = function _handleMessage(req, res) {
  const feedKey = this._feedKey(req.query.feed_key);
  const index = req.query.index;

  const options = {
    feedKey,
    index
  };

  if (!options.index)
    options.index = 0;

  this.backend.getMessage(options, (err, message) => {
    if (err)
      return res.json(500, { error: err.message });

    res.json({ ok: true, message });
  });
};

API.prototype._handleTrust = function _handleTrust(req, res) {
  const body = req.body;

  const options = {};
  if (body.expires_in)
    options.expiresIn = body.expires_in;
  if (body.description)
    options.description = body.description;

  const trusteeKey = Buffer.from(body.feed_key, 'base64');
  const link = this.backend.trust(trusteeKey, options);

  res.json({ link: link.toString('hex') });
};

API.prototype._handleFollow = function _handleFollow(req, res) {
  const body = req.body;
  const feedKey = Buffer.from(body.feed_key, 'base64');
  this.backend.follow(feedKey);
  res.json({ ok: true });
};

API.prototype._handleUnfollow = function _handleUnfollow(req, res) {
  const body = req.body;
  const feedKey = Buffer.from(body.feed_key, 'base64');
  this.backend.unfollow(feedKey);
  res.json({ ok: true });
};

API.prototype._handlePost = function _handlePost(req, res) {
  const body = req.body;
  this.backend.post({
    content: body.content,
    replyTo: body.reply_to && {
      feedKey: Buffer.from(body.reply_to.feed_key, 'base64'),
      index: body.reply_to.index
    }
  });
  res.json({ ok: true });
};
