// lib/db.ts
import { Pool } from 'pg';

declare global {
  var pgPool: Pool | undefined;
}

const pool = global.pgPool ?? new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT),
});

if (process.env.NODE_ENV !== 'production') global.pgPool = pool;

export { pool };