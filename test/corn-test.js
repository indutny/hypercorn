'use strict';

const path = require('path');
const tape = require('tape');
const rimraf = require('rimraf');

const TMP_DIR = path.join(__dirname, 'tmp');
const A_DIR = path.join(TMP_DIR, 'a');
const B_DIR = path.join(TMP_DIR, 'b');

const HyperCorn = require('../').HyperCorn;

tape('HyperCorn test', (t) => {
  t.timeoutAfter(50000);

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
    }, onPost);
  }

  function onPost(err) {
    t.error(err, '`.post()` should not error');

    // The time to get the message is not deterministic
    setTimeout(() => {
      b.getMessage({ feedKey: b.getFeedKey(), index: 0 }, onMessage);
    }, 1000);
  }

  function onMessage(err, message) {
    t.error(err, '`.getMessage()` should not error');
    t.equal(message.meta.length, 1, 'reply should get through');
    t.equal(message.meta[0].type, 'reply', 'reply should have `reply` type');

    const reply = message.meta[0].payload;
    t.deepEqual(reply.feedKey.toBuffer(), a.getFeedKey(), 'reply link feed');
    t.equal(reply.index, 1, 'reply link index');

    a.follow(b.getFeedKey(), onFollow);
  }

  function onFollow(err) {
    t.error(err, '`.follow()` should not error');

    // Same thing, hyperbloom is eventually consistent
    setTimeout(() => {
      a.getMessage({ feedKey: b.getFeedKey(), index: 0 }, onRemoteMessage);
    }, 1000);
  }

  function onRemoteMessage(err, message) {
    t.error(err, 'remote `.getMessage()` should not error');
    t.equal(message.meta.length, 1, 'reply should get through to remote too');
    end();
  }

  function end() {
    // TODO(indutny): investigate why teardown doesn't work
    t.end();
    process.exit(0);
  }
});
