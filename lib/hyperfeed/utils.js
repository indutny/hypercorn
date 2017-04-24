'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const signatures = require('sodium-signatures');
const Buffer = require('buffer').Buffer;

const KEY_FILE = 'key.json';

exports.loadKey = function loadKey(dir) {
  const file = path.join(dir, KEY_FILE);

  if (fs.existsSync(file)) {
    const data = fs.readFileSync(file).toString();
    const json = JSON.parse(
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
