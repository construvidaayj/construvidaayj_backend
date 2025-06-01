import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { pool } from '../../lib/db'; // Asegúrate de que este 'pool' esté configurado para MySQL
import { generateToken } from '../../lib/auth/jwt'; // Asumo que esta función no depende de la DB y sigue siendo válida

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json({ message: 'Faltan campos' }, { status: 400 });
    }

    // --- 1. Verificar que el usuario exista ---
    // MySQL usa '?' como placeholder para los parámetros
    const userQuery = `
      SELECT id, username, password_hash, role 
      FROM users 
      WHERE username = ?;
    `;
    const [userRows]: any[] = await pool.query(userQuery, [username]);

    // Para mysql2, el resultado de pool.query es [rows, fields]. Accedemos al primer elemento para las filas.
    const user = userRows[0];

    if (!user) {
      return NextResponse.json({ message: 'Usuario no encontrado' }, { status: 401 });
    }

    // --- 2. Verificar la contraseña ---
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return NextResponse.json({ message: 'Contraseña incorrecta' }, { status: 401 });
    }

    // --- 3. Obtener las oficinas asociadas al usuario con detalles adicionales ---
    // MySQL usa '?' como placeholder para los parámetros
    const officesQuery = `
      SELECT o.id AS office_id, o.name, o.representative_name, o.logo_url
      FROM user_offices uo
      JOIN offices o ON uo.office_id = o.id
      WHERE uo.user_id = ?;
    `;
    const [officesRows]: any[] = await pool.query(officesQuery, [user.id]);

    const offices = officesRows.map((row: any) => ({
      office_id: row.office_id,
      name: row.name,
      representative_name: row.representative_name,
      logo_url: row.logo_url
    }));

    // --- 4. Generar token JWT ---
    // Asumo que generateToken() no necesita cambios, ya que opera con los datos del usuario.
    const token = generateToken({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    // --- 5. Preparar y devolver los datos del usuario ---
    const userData = {
      id: user.id,
      username: user.username,
      role: user.role,
      offices, // Lista de oficinas asociadas al usuario con detalles
      token,   // Token JWT para autenticación
    };

    return NextResponse.json(userData, { status: 200 });

  } catch (error) {
    console.error('🔥 Error en login:', error);
    // En producción, evita exponer detalles internos del error.
    return NextResponse.json({ message: 'Error interno del servidor' }, { status: 500 });
  }
}