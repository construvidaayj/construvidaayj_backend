import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { pool } from '@/app/lib/db';
import { generateToken } from '@/app/lib/auth/jwt';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ message: 'Faltan campos' }, { status: 400 });
    }

    // Verificar que el usuario exista
    const result = await pool.query(
      'SELECT id, username, password_hash, role FROM users WHERE username = $1',
      [username]
    );

    const user = result.rows[0];
    console.log(`resultado de la consulta SQL ${result}`);
    if (!user) {
      return NextResponse.json({ message: 'Usuario no encontrado' }, { status: 401 });
    }

    // Verificar la contraseña
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return NextResponse.json({ message: 'Contraseña incorrecta' }, { status: 401 });
    }

    // Obtener las oficinas asociadas al usuario con detalles adicionales (nombre, representante, logo)
    const officesResult = await pool.query(
      `SELECT o.id AS office_id, o.name, o.representative_name, o.logo_url
       FROM user_offices uo
       JOIN offices o ON uo.office_id = o.id
       WHERE uo.user_id = $1`,
      [user.id]
    );
    
    const offices = officesResult.rows.map(row => ({
      office_id: row.office_id,
      name: row.name,
      representative_name: row.representative_name,
      logo_url: row.logo_url
    }));

    // Generar token JWT
    const token = generateToken({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    // Datos del usuario con el token y las oficinas asociadas
    const userData = {
      id: user.id,
      username: user.username,
      role: user.role,
      offices,  // Lista de oficinas asociadas al usuario con detalles
      token,    // Token JWT para autenticación
    };

    return NextResponse.json(userData, { status: 200 });

  } catch (error) {
    console.error('Error en login:', error);
    return NextResponse.json({ message: 'Error interno del servidor' }, { status: 500 });
  }
}
