/* eslint-disable no-console */

global.Buffer = require("buffer").Buffer;

if (!console.assert) {
  console.assert = () => {};
}

process.browser = true; // for readable-stream/lib/_stream_writable.js
// FIXME shim want to set it to false tho...