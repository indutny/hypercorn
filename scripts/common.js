'use strict';

const http = require('http');
const qs = require('querystring');
const prompt = require('prompt');

function REST(port, host) {
  this.port = port;
  this.host = host;
}
module.exports = REST;

REST.prototype._params = function _params(params, callback) {
  prompt.get(params, (err, result) => {
    const obj = {};
    Object.keys(result).forEach((key) => {
      let value = result[key];
      const parts = key.split('.');

      // Skip
      if (value === '')
        return;

      let last = parts.pop();

      const match = last.match(/:(\w)$/);
      last = last.replace(/:\w$/, '');

      if (match && match[1] === 'i')
        value = parseInt(value, 10);

      let dig = obj;
      for (let i = 0; i < parts.length; i++) {
        if (!dig[parts[i]])
          dig[parts[i]] = {};
        dig = dig[parts[i]];
      }
      dig[last] = value;
    });

    console.log(obj);
    prompt.get([ 'looks good?' ], (err, result) => {
      if (err)
        return callback(err);

      callback(null, obj);
    });
  });
};

REST.prototype._getJSON = function _getJSON(res, callback) {
  let chunks = '';
  res.on('data', chunk => chunks += chunk);
  res.once('end', () => {
    let value;

    try {
      value = JSON.parse(chunks);
    } catch (e) {
      return callback(e);
    }

    return callback(null, value);
  });
};

REST.prototype.get = function get(path, params, callback) {
  this._params(params, (err, query) => {
    if (err)
      return callback(err);

    http.request({
      method: 'GET',
      host: this.host,
      port: this.port,
      path: path + '?' + qs.encode(query)
    }, (res) => {
      this._getJSON(res, callback);
    }).end();
  });
};

REST.prototype.post = function post(path, params, callback) {
  this._params(params, (err, body) => {
    if (err)
      return callback(err);

    http.request({
      method: 'POST',
      host: this.host,
      port: this.port,
      path: path,
      headers: {
        'content-type': 'application/json'
      }
    }, (res) => {
      this._getJSON(res, callback);
    }).end(JSON.stringify(body));
  });
};

module.exports = () => {
  const PORT = parseInt(process.argv[2], 10);
  const HOST = process.argv[3];

  console.log('Request to %s:%d', HOST, PORT);
  return new REST(PORT, HOST);
};
