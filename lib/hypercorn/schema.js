'use strict';

const Joi = require('joi');

exports.Message = Joi.object().keys({
  type: Joi.string().required(),
  timestamp: Joi.number().min(0).required(),
  payload: Joi.object().required()
});

exports.Open = Joi.object().keys({
  protocol: Joi.string().valid('hypercorn').required(),
  version: Joi.number().valid(1).required()
});

exports.Post = Joi.object().keys({
  content: Joi.string().required(),
  reply_to: Joi.object().keys({
    feed_key: Joi.string().base64().required(),
    index: Joi.number().min(0).required()
  }).optional()
});

exports.Trust = Joi.object().keys({
  expires_at: Joi.number().min(0).required(),
  description: Joi.string().optional(),
  feed_key: Joi.string().base64().required(),
  link: Joi.string().base64().required()
});

exports.Follow = Joi.object().keys({
  feed_key: Joi.string().base64().required()
});

exports.Unfollow = Joi.object().keys({
  feed_key: Joi.string().base64().required()
});
