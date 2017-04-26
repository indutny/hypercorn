'use strict';

const path = require('path');
const tape = require('tape');
const rimraf = require('rimraf');

const TMP_DIR = path.join(__dirname, 'tmp');
const A_DIR = path.join(TMP_DIR, 'a');
const B_DIR = path.join(TMP_DIR, 'b');

const HyperCorn = require('../').HyperCorn;

tape('HyperCorn test', (t) => {
  t.timeoutAfter(5000);

  rimraf.sync(TMP_DIR);

  const a = new HyperCorn({ storage: A_DIR });
  const b = new HyperCorn({ storage: B_DIR });

  a.listen(() => {
    b.listen(() => {
      a.getTimeline({
        feedKey: b.getFeedKey(),
        offset: 0,
        limit: 10
      }, onBTimeline);
    });
  });

  function onBTimeline(err, timeline) {
    t.error(err, '`.getTimeline()` should not error');

    t.equal(timeline.length, 1, 'one post expected');
    t.equal(timeline[0].message.type, 'open', 'it should be `open`');

    b.trust(a.getFeedKey(), {
      description: 'some info'
    }, onTrust);
  }

  function onTrust(err) {
    t.error(err, '`.trust()` should not error');

    a.post('reply', {
      reply_to: {
        feed_key: b.getFeedKey(),
        index: 0
      }
    }, onReply);
  }

  function onReply(err) {
    setTimeout(() => {
      t.error(err, '`.post()` should not error');
      end();
    }, 2500);
  }

  function end() {
    // TODO(indutny): investigate why teardown doesn't work
    t.end();
    process.exit(0);
  }
});
