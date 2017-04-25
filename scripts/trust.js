'use strict';

require('./common')().post('/api/trust', [
  'feed_key', 'expires_in:i'
], (err, data) => {
  if (err)
    throw err;

  console.log(JSON.stringify(data, null, 2));
});
