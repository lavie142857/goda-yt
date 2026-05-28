console.log('process.type', process.type);
console.log('versions.electron', process.versions.electron);
console.log('versions.node', process.versions.node);
try {
  const electron = require('electron');
  console.log('electron typeof', typeof electron);
  console.log('electron value', electron);
} catch (error) {
  console.log('require-electron-error', error.message);
}
