const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env.local');

if (!fs.existsSync(envPath)) {
  console.log('❌ .env.local file does not exist');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const lines = envContent.split('\n');

let clientId = '';
let clientSecret = '';

lines.forEach(line => {
  const trimmed = line.trim();
  if (trimmed.startsWith('GOOGLE_CLIENT_ID=')) {
    clientId = trimmed.split('=').slice(1).join('=');
  }
  if (trimmed.startsWith('GOOGLE_CLIENT_SECRET=')) {
    clientSecret = trimmed.split('=').slice(1).join('=');
  }
});

console.log('\n🔍 Current Configuration:');
console.log(`   Client ID length: ${clientId.length} characters`);
console.log(`   Client ID ends with: ${clientId.slice(-30)}`);
console.log(`   Client Secret length: ${clientSecret.length} characters`);
console.log(`   Client Secret starts with: ${clientSecret.slice(0, 10)}`);

if (clientId.length < 50) {
  console.log('\n❌ Client ID is too short! Should be ~70-80 characters');
  console.log('   Make sure you copied the FULL Client ID from Google Cloud Console');
}

if (!clientId.includes('.apps.googleusercontent.com')) {
  console.log('\n❌ Client ID is missing .apps.googleusercontent.com');
  console.log('   This means it\'s not a valid Google OAuth Client ID');
}

if (clientSecret.length < 30) {
  console.log('\n❌ Client Secret is too short! Should be ~40-50 characters');
}

if (!clientSecret.startsWith('GOCSPX-')) {
  console.log('\n❌ Client Secret doesn\'t start with GOCSPX-');
  console.log('   This means it\'s not a valid Google OAuth Client Secret');
}

if (clientId.length >= 50 && clientId.includes('.apps.googleusercontent.com') && 
    clientSecret.length >= 30 && clientSecret.startsWith('GOCSPX-')) {
  console.log('\n✅ Credentials look valid!');
  console.log('   If you\'re still getting errors, try:');
  console.log('   1. Restart your dev server (npm run dev)');
  console.log('   2. Clear browser cache or use incognito mode');
  console.log('   3. Verify the OAuth client is enabled in Google Cloud Console');
}
