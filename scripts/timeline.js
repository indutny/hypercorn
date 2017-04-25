'use strict';

require('./common')().get('/api/timeline', [
  'feed_key', 'offset:i', 'limit:i'
], (err, data) => {
  if (err)
    throw err;

  console.log(JSON.stringify(data, null, 2));
});
