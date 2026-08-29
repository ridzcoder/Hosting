// src/services/seedAdmin.js
const bcrypt = require('bcryptjs');
const { getUserByEmail, createUser, setAdmin } = require('../db');

async function seedAdmin() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    
    // Check if admin already exists
    let admin = getUserByEmail(adminEmail);
    
    if (!admin) {
      // Create admin user
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      admin = createUser({
        email: adminEmail,
        passwordHash,
        startingCoins: 999999,
      });
      
      // Set as admin
      setAdmin(admin.id, true);
      console.log('✅ Admin user created:', adminEmail);
    } else {
      // Ensure existing admin has admin privileges
      if (!admin.is_admin) {
        setAdmin(admin.id, true);
        console.log('✅ Admin privileges granted to:', adminEmail);
      }
      console.log('✅ Admin user already exists:', adminEmail);
    }
    
    return admin;
  } catch (error) {
    console.error('❌ Error seeding admin:', error);
    throw error;
  }
}

module.exports = { seedAdmin };