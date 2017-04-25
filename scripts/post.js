'use strict';

require('./common')().post('/api/post', [
  'content', 'meta.reply_to.feed_key', 'meta.reply_to.index:i'
], (err, data) => {
  if (err)
    throw err;

  console.log(JSON.stringify(data, null, 2));
});
