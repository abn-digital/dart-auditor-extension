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
run('git push origin main');
run(`git push origin v${version}`);
console.log('');

// 5. Create GitHub release
console.log('🎉 Creating GitHub release...');
const releaseNotes = `## DART Event Auditor v${version}

### What's New
- [Add release notes here]

### How to Update
1. Pull the latest changes: \`git pull origin main\`
2. Go to \`chrome://extensions\`
3. Click the refresh icon on the DART Event Auditor card
`;

run(`gh release create v${version} --repo ${REPO_OWNER}/${REPO_NAME} --title "DART Event Auditor v${version}" --notes "${releaseNotes.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);

console.log(`\n✅ Release v${version} created successfully!`);
console.log(`🔗 https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${version}\n`);
