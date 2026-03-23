const mysql = require('mysql2/promise');
require('dotenv').config();

async function seedCategories() {
  console.log('Conectando a la base de datos...');
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'greg_tracker'
  });

  const constructionCategories = [
    'Building Materials',
    'Tools & Equipment',
    'Subcontractors',
    'Fuel & Mileage',
    'Permits & Inspections',
    'Insurance & Bonds',
    'Vehicle Maintenance',
    'Labor / Payroll',
    'Equipment Rental',
    'Construction Services (Income)',
    'Consulting (Income)',
    'Office Supplies',
    'Utilities',
    'General'
  ];

  try {
    console.log('Borrando categorias anteriores (las transacciones existentes quedaran sin categoria)...');
    await pool.query('DELETE FROM categories');
    await pool.query('ALTER TABLE categories AUTO_INCREMENT = 1');

    console.log('Insertando categorias de construccion...');
    for (const cat of constructionCategories) {
      await pool.query('INSERT INTO categories (name) VALUES (?)', [cat]);
    }

    console.log('✅ Categorias actualizadas exitosamente para Racketty Boom (Construccion).');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error actualizando categorias:', error.message);
    process.exit(1);
  }
}

seedCategories();