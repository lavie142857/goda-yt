// Empty signing hook - disables code signing
module.exports = async function (configuration) {
  console.log('Skipping code signing');
  return null;
};
