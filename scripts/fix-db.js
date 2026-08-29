// scripts/fix-db.js
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'platform.db');

console.log('🔍 Checking database integrity...');

if (fs.existsSync(DB_PATH)) {
  try {
    const buffer = fs.readFileSync(DB_PATH);
    const header = buffer.toString('utf8', 0, 16);
    
    // Check if it's a valid SQLite database
    if (!header.includes('SQLite format 3')) {
      console.log('🗑️ Removing corrupted database file...');
      fs.unlinkSync(DB_PATH);
      console.log('✅ Database file removed. Will be recreated on next start.');
    } else {
      console.log('✅ Database file is valid.');
    }
  } catch (err) {
    console.log('🗑️ Removing inaccessible database file...');
    fs.unlinkSync(DB_PATH);
  }
} else {
  console.log('ℹ️ Database file does not exist yet.');
}