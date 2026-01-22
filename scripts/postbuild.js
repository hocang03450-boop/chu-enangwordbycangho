const fs = require('fs');
const path = require('path');

const buildDir = 'build';

// Ensure build directory exists
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir);
}

// Copy source TypeScript/JavaScript files that tsc won't copy directly (like index.ts/App.ts if they are in root)
// and other static assets. tsc will handle transpiling .ts(x) files and placing them in build/.
// We need to ensure non-ts(x) files (like HTML, JSON) and potentially directories with only assets are copied.

// List of files to copy directly from root to buildDir
const staticRootFiles = ['index.html', 'metadata.json'];

staticRootFiles.forEach(file => {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(buildDir, file));
  }
});

// Recursively copy directories that might contain assets or non-TypeScript files
// Note: TypeScript files in these directories will be handled by `tsc` to `build/`
// This ensures that if there are any non-ts/tsx files (e.g., images, css not handled by tailwind CDN)
// they are also copied. For this project, it's mostly .ts/.tsx files, but this makes it robust.
const directoriesToCopy = ['components', 'contexts', 'services']; // types.ts will be copied by tsc

function copyDirectoryRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let entries = fs.readdirSync(src, { withFileTypes: true });

  for (let entry of entries) {
    let srcPath = path.join(src, entry.name);
    let destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else {
      // Only copy if it's not a TS/TSX file, as tsc handles those
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

directoriesToCopy.forEach(dir => {
    if (fs.existsSync(dir)) {
        copyDirectoryRecursive(dir, path.join(buildDir, dir));
    }
});


// Modify index.html to point to index.js
const indexPath = path.join(buildDir, 'index.html');
if (fs.existsSync(indexPath)) {
  let indexHtmlContent = fs.readFileSync(indexPath, 'utf8');
  indexHtmlContent = indexHtmlContent.replace('/index.tsx', '/index.js');
  fs.writeFileSync(indexPath, indexHtmlContent);
} else {
  console.warn(`Warning: ${indexPath} not found after copy. Index.html modification skipped.`);
}

console.log('Post-build script finished: Static assets copied and index.html updated.');
