/** Entry shim tại root — prettier tìm .prettierrc ở cwd. Nội dung thật ở packages/config/prettier. */
module.exports = require('./packages/config/prettier/.prettierrc.json');
