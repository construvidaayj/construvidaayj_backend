import { pool } from '@/app/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { full_name, identification, office_id } = body;
    console.log(`
      NOMBRE: ${full_name},
      IDENTIFICACION: ${identification},
      ID OFICINA: ${office_id},

      `);

    if (!full_name || !identification || !office_id) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 });
    }

    const result = await pool.query(
      `INSERT INTO clients (full_name, identification, office_id)
       VALUES ($1, $2, $3)
       RETURNING id, full_name, identification, office_id, created_at`,
      [full_name, identification, office_id]
    );

    return NextResponse.json({ client: result.rows[0] }, { status: 201 });

  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
