'use strict';

require('./common')().post('/api/follow', [
  'feed_key'
], (err, data) => {
  if (err)
    throw err;

  console.log(JSON.stringify(data, null, 2));
});
