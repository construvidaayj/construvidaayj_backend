// app/api/validation/route.ts
import { pool } from '@/app/api/lib/db';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';

interface UserPayload {
  username: string;
  password: string;
  role: string;
  office_id?: number;
}

export async function POST(request: Request) {
  let connection: PoolConnection | undefined;

  try {
    const body: UserPayload = await request.json();
    const { username, password, role, office_id } = body;

    if (!username || !password || !role) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos' },
        { status: 400 }
      );
    }

    const password_hash = await bcrypt.hash(password, 10);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Insertar usuario
    const [userResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO users (username, password_hash, role) 
       VALUES (?, ?, ?)`,
      [username, password_hash, role]
    );

    const userId = userResult.insertId;

    // Asociar usuario a oficina si se proporciona
    if (office_id) {
      await connection.execute(
        `INSERT INTO user_offices (user_id, office_id) VALUES (?, ?)`,
        [userId, office_id]
      );
    }

    // Obtener usuario creado
    const [rows] = await connection.execute(
      `SELECT u.id, u.username, u.role, u.created_at, u.updated_at,
              u.is_active, uo.office_id
       FROM users u
       LEFT JOIN user_offices uo ON u.id = uo.user_id
       WHERE u.id = ?`,
      [userId]
    );

    await connection.commit();
    return NextResponse.json({ user: (rows as any)[0] }, { status: 201 });

  } catch (error) {
    console.error('Error al crear usuario:', error);
    if (connection) await connection.rollback();
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  } finally {
    if (connection) connection.release();
  }
}
