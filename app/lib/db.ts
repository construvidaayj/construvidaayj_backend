// lib/db.ts
import { Pool } from 'pg';


declare global {
  var pgPool: Pool | undefined;
}

const pool = global.pgPool ?? new Pool({
  user: 'postgres',
  host: 'shinkansen.proxy.rlwy.net',
  database: 'railway',
  password: 'MVzEveEWbtmGadKWnBkdwXLVCPORrJcA',
  port: 17835,
});

if (process.env.NODE_ENV !== 'production') global.pgPool = pool;

export { pool };