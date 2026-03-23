const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const envPath = path.join(__dirname, '.env');

async function main() {
  console.log('Verificando conexión MySQL 8.4 (root/sin contraseña)...');
  try {
    const conn = await mysql.createConnection({
      host: '127.0.0.1',
      user: 'root',
      password: ''
    });
    
    // Si la DB greg_tracker no existe, la creamos
    await conn.query('CREATE DATABASE IF NOT EXISTS greg_tracker');
    console.log('✅ Base de datos greg_tracker verificada.');
    await conn.end();
  } catch (e) {
    console.error("❌ ERROR FATAL conectando a MySQL:", e.message);
    process.exit(1);
  }

  // Actualizar .env explícitamente sin contraseña
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  if (envContent.includes('DB_PASSWORD=')) {
    envContent = envContent.replace(/DB_PASSWORD=.*/g, `DB_PASSWORD=`);
  } else {
    envContent += `\nDB_PASSWORD=`;
  }
  fs.writeFileSync(envPath, envContent);

  console.log('Iniciando el servidor Backend...');
  const server = spawn('node', ['server.js'], {
    cwd: __dirname,
    detached: true,
    stdio: 'ignore'
  });
  server.unref();

  const nets = os.networkInterfaces();
  let localIp = '127.0.0.1';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !name.toLowerCase().includes('wsl') && !name.toLowerCase().includes('vbox') && !name.toLowerCase().includes('vmware') && !name.toLowerCase().includes('hyper')) {
        localIp = net.address;
      }
    }
  }

  console.log(`\n=========================================`);
  console.log(`✅ MOTORES ENCENDIDOS (MySQL 8.4)`);
  console.log(`📱 URL DEL FRONTEND (CELULAR):`);
  console.log(`   http://${localIp}:3000`);
  console.log(`=========================================\n`);
}

main();