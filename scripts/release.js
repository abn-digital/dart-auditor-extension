#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_OWNER = 'abn-digital';
const REPO_NAME = 'dart-auditor-extension';
const MANIFEST_PATH = path.join(__dirname, '..', 'DART Event Auditor', 'manifest.json');

// Get version from command line
const version = process.argv[2];

if (!version) {
  console.error('Usage: npm run release <version>');
  console.error('Example: npm run release 2.1.0');
  process.exit(1);
}

// Validate version format
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Error: Version must be in format X.Y.Z (e.g., 2.1.0)');
  process.exit(1);
}

function run(cmd, options = {}) {
  console.log(`  > ${cmd}`);
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'inherit', ...options });
  } catch (error) {
    if (!options.ignoreError) {
      console.error(`Command failed: ${cmd}`);
      process.exit(1);
    }
  }
}

console.log(`\n🚀 Releasing DART Event Auditor v${version}\n`);

// 1. Update manifest.json
console.log('📝 Updating manifest.json...');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
manifest.version = version;
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
console.log(`   Version updated to ${version}\n`);

// 2. Update package.json
console.log('📝 Updating package.json...');
const packagePath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
packageJson.version = version;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
console.log(`   Version updated to ${version}\n`);

// 3. Git commit and tag
console.log('📦 Committing changes...');
run('git add .');
run(`git commit -m "Release v${version}"`);
run(`git tag -a v${version} -m "Release v${version}"`);
console.log('');

// 4. Push to GitHub
console.log('⬆️  Pushing to GitHub...');
run('git push origin master');
run(`git push origin v${version}`);
console.log('');

// 5. Create extension ZIP
console.log('📦 Creating extension ZIP...');
const extensionDir = path.join(__dirname, '..', 'DART Event Auditor');
const zipName = `DART-Event-Auditor-v${version}.zip`;
const zipPath = path.join(__dirname, '..', zipName);

// Remove old ZIP if exists
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

// Create ZIP using PowerShell (Windows)
run(`powershell -Command "Compress-Archive -Path '${extensionDir}\\*' -DestinationPath '${zipPath}'"`, { stdio: 'pipe' });
console.log(`   Created ${zipName}\n`);

// 6. Create GitHub release with ZIP asset
console.log('🎉 Creating GitHub release...');
const releaseNotes = `## DART Event Auditor v${version}

### What's New
- [Add release notes here]

### How to Update
1. Download \`${zipName}\` below
2. Extract to your extension folder (overwrite existing files)
3. Go to \`chrome://extensions\` and click the refresh icon
`;

// Write notes to temp file to preserve formatting
const notesFile = path.join(__dirname, '..', 'RELEASE_NOTES.tmp');
fs.writeFileSync(notesFile, releaseNotes);
run(`gh release create v${version} "${zipPath}" --repo ${REPO_OWNER}/${REPO_NAME} --title "DART Event Auditor v${version}" --notes-file "${notesFile}"`);
fs.unlinkSync(notesFile);
fs.unlinkSync(zipPath);

console.log(`\n✅ Release v${version} created successfully!`);
console.log(`🔗 https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${version}\n`);
