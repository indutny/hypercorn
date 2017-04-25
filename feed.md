# Feed

All messages MUST have following structure:

```js
{
  "type": "message-type",
  "timestamp": 123, // seconds since `1970-01-01T00:00:00.000Z`
  "payload": {
    // custom payload
  }
}
```

Some standard messages (skipping common fields):

## Open

```js
{
  "type": "open",
  "payload": {
    "protocol": "hypercorn",
    "version": 1
  }
}
```

First message!

## Post

```js
{
  "type": "post",
  "payload": {
    "content": "text content",
    "reply_to": /* optional */ {
      "feed_key": "...",
      "index": 0
    }
  }
}
```

## Trust

```js
{
  "type": "trust",
  "payload": {
    "expires_at": 123, // seconds since `1970-01-01T00:00:00.000Z`
    "description": "optional description",
    "feed_key": "base64-encoded Trustee's key",
    "link": "base64-encoded Trust Link"
  }
}
```

See [Trust Link][0] for details.

## Follow

```js
{
  "type": "follow",
  "payload": {
    "feed_key": "base64-encoded feed key"
  }
}
```

## Unfollow

```js
{
  "type": "follow",
  "payload": {
    "feed_key": "base64-encoded feed key"
  }
}
```

# Meta

HyperBloom is used for storing replies and other public editable information.
The values are encoded this way:

- `key_len` - 1 byte key length
- `key` - bytes of key
- `value_len` - 1 byte value length
- `value` - bytes of value

`key_len` must be between 0 and 127 (both inclusive).

## Keys

### Messages

For the messages key MUST have following structure:

- `0` - 1 byte
- `index` - 4 byte big endian integer

## Values

### Reply

- `0` - 1 byte
- `feed_key` - 32 byte feed key
- `index` - 4 byte big endian integer

[0]: https://github.com/hyperbloom/hyperbloom-protocol/blob/master/spec.md#signature-chain
