// fix-admin-password.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./src/db');

async function fixAdminPassword() {
  const adminEmail = process.env.ADMIN_EMAIL || 'devkelvin903@gmail.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!@#';
  
  console.log('═══════════════════════════════════════');
  console.log('  🔑 Fix Admin Password');
  console.log('═══════════════════════════════════════\n');
  
  console.log(`📧 Admin Email: ${adminEmail}`);
  
  // Get user from database
  const user = db.getUserByEmail(adminEmail);
  
  if (!user) {
    console.log('❌ Admin user not found!');
    console.log('   Creating admin user...');
    
    // Create admin user
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const newUser = db.createUser({
      email: adminEmail,
      passwordHash,
      startingCoins: 999999,
      referredBy: null,
    });
    
    // Set as admin
    db.setAdmin(newUser.id, true);
    
    console.log('✅ Admin user created!');
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Password: ${adminPassword}`);
    console.log('   ⚠️  Please change this password after first login!');
    return;
  }
  
  console.log(`✅ Found user: ${user.email}`);
  console.log(`   ID: ${user.id}`);
  console.log(`   Has password_hash: ${!!user.password_hash}`);
  console.log(`   Is Admin: ${!!user.is_admin}`);
  
  if (!user.password_hash) {
    console.log('\n🔑 Generating new password hash...');
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    
    db.db.prepare(`
      UPDATE users SET password_hash = ? WHERE id = ?
    `).run(passwordHash, user.id);
    
    console.log('✅ Admin password updated!');
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Password: ${adminPassword}`);
    console.log('   ⚠️  Please change this password after first login!');
  } else {
    console.log('\n✅ Admin already has a password hash');
    console.log('   You can login with your existing password.');
  }
  
  // Ensure admin privileges
  if (!user.is_admin) {
    console.log('\n🔑 Granting admin privileges...');
    db.setAdmin(user.id, true);
    console.log('✅ Admin privileges granted!');
  }
  
  console.log('\n═══════════════════════════════════════');
  console.log('  ✅ Fix complete');
  console.log('═══════════════════════════════════════');
}

// Run the function
fixAdminPassword()
  .then(() => {
    console.log('\n✅ Done! You can now login with:');
    console.log(`   Email: ${process.env.ADMIN_EMAIL || 'devkelvin903@gmail.com'}`);
    console.log(`   Password: ${process.env.ADMIN_PASSWORD || 'Kelvin##??256'}`);
    console.log('\n   🔗 https://hosting-xzkg.onrender.com/login');
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });