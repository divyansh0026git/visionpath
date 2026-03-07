const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'node_modules', '@tensorflow', 'tfjs-node', 'dist', 'image.js');
const targetFile2 = path.join(__dirname, 'node_modules', '@tensorflow', 'tfjs-node', 'dist', 'nodejs_kernel_backend.js');

[targetFile, targetFile2].forEach(file => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/util_1\.isNullOrUndefined/g, '(typeof util_1.isNullOrUndefined === "function" ? util_1.isNullOrUndefined : (x => x === null || x === undefined))');
    fs.writeFileSync(file, content);
    console.log('Patched', file);
  }
});
