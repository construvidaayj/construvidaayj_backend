// app/api/users/route.ts
import { pool } from '@/app/lib/db';
import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password, role, office_id } = body;

    if (!username || !password || !role) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (username, password_hash, role, office_id) 
       VALUES ($1, $2, $3, $4) RETURNING id, username, role, office_id, created_at`,
      [username, password_hash, role, office_id ?? null]
    );

    return NextResponse.json({ user: result.rows[0] }, { status: 201 });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
