// app/api/lib/db.ts
import mysql, { Pool, PoolOptions } from 'mysql2/promise';

declare global {
  var mysqlPool: Pool | undefined;
}

const poolOptions: PoolOptions = {
  host: process.env.DB_HOST,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: Number(process.env.DB_PORT),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

const pool = global.mysqlPool ?? mysql.createPool(poolOptions);

// --- BLOQUE DE PRUEBA DE CONEXIÓN AÑADIDO ---
async function testDbConnection() {
  try {
    const connection = await pool.getConnection(); // Intenta obtener una conexión del pool
    console.log('¡Conexión a la base de datos MySQL exitosa!');
    connection.release(); // Libera la conexión de vuelta al pool
  } catch (error) {
    console.error('ERROR CRÍTICO: No se pudo conectar a la base de datos MySQL.');
    console.error('Verifica tus variables de entorno (.env) y los permisos de IP en el hosting.');
    console.error('Detalles del error:', error);
    // Opcional: podrías querer salir del proceso si la conexión es crítica para el inicio de la app
    // process.exit(1);
  }
}

// Ejecuta la prueba de conexión solo si estamos en desarrollo y no es una reconstrucción en caliente
// Para Next.js, a menudo los módulos se importan varias veces en desarrollo,
// así que nos aseguramos de que no se ejecute múltiples veces innecesariamente.
if (process.env.NODE_ENV !== 'production' && !global.mysqlPool) {
    // Si mysqlPool no existe, significa que es la primera vez que se inicializa en esta ejecución
    // y es un buen momento para probar la conexión.
    testDbConnection();
}
// --- FIN DEL BLOQUE DE PRUEBA DE CONEXIÓN ---


if (process.env.NODE_ENV !== 'production') global.mysqlPool = pool;

export { pool };


// // lib/db.ts
// import { Pool } from 'pg';

// declare global {
//   var pgPool: Pool | undefined;
// }

// const pool = global.pgPool ?? new Pool({
//   user: process.env.DB_USER,
//   host: process.env.DB_HOST,
//   database: process.env.DB_NAME,
//   password: process.env.DB_PASSWORD,
//   port: Number(process.env.DB_PORT),
// });

// if (process.env.NODE_ENV !== 'production') global.pgPool = pool;

// export { pool };