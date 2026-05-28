const main = require('electron/main');
const common = require('electron/common');
console.log('main keys', Object.keys(main).slice(0, 10));
console.log('has app', !!main.app, typeof main.app);
console.log('has shell', !!common.shell, typeof common.shell);
