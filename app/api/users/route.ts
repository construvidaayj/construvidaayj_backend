// app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { PoolConnection, ResultSetHeader } from 'mysql2/promise'; // Importamos tipos específicos
import { pool } from '@/app/api/lib/db'; // Importamos el pool directamente

// Definimos la interfaz para el cuerpo de la solicitud JSON
interface CreateUserRequestBody {
  username: string;
  password: string;
  role: string; // Espera un valor de 'user_roles' (admin, office_manager, viewer)
  office_id?: number | null; // Opcional, si el usuario se asocia a una oficina
}

export async function POST(request: NextRequest) {
  let connection: PoolConnection | undefined; // Tipamos la conexión para el bloque finally
  try {
    const { username, password, role, office_id }: CreateUserRequestBody = await request.json();

    console.log(`
      [CREAR USUARIO] Datos recibidos:
      USERNAME: ${username},
      ROLE: ${role},
      OFFICE_ID: ${office_id},
    `);

    // Validaciones básicas
    if (!username || !password || !role) {
      return NextResponse.json({ error: 'Faltan campos requeridos: username, password y role.' }, { status: 400 });
    }

    // Asegurarse de que el rol sea válido
    const [roleRows]: [any[], any[]] = await pool.execute(
      `SELECT role_name FROM user_roles WHERE role_name = ?`,
      [role]
    );

    if (roleRows.length === 0) {
      return NextResponse.json(
        { error: `El rol '${role}' no es válido. Roles permitidos: admin, office_manager, viewer.` },
        { status: 400 }
      );
    }

    // Hashear la contraseña
    const password_hash: string = await bcrypt.hash(password, 10);

    connection = await pool.getConnection(); // Obtenemos una conexión del pool
    await connection.beginTransaction(); // --- INICIO DE LA TRANSACCIÓN ---
    console.log('Transacción iniciada para crear usuario.');

    let newUserId: number;

    try {
      // 1. Insertar en la tabla 'users'
      const insertUserQuery = `
        INSERT INTO users (username, password_hash, role)
        VALUES (?, ?, ?)
      `;
      const insertUserValues: (string | number)[] = [username, password_hash, role];

      console.log('Query para insertar usuario:', insertUserQuery);
      console.log('Valores para insertar usuario:', insertUserValues);

      const [userResult]: [ResultSetHeader, any] = await connection.execute(
        insertUserQuery,
        insertUserValues
      );

      newUserId = userResult.insertId;
      console.log(`Usuario '${username}' creado con ID: ${newUserId}`);

      // 2. Si se proporciona 'office_id', insertar en la tabla 'user_offices'
      if (office_id) {
        const insertUserOfficeQuery = `
          INSERT INTO user_offices (user_id, office_id)
          VALUES (?, ?)
        `;
        const insertUserOfficeValues: number[] = [newUserId, office_id];

        console.log('Query para insertar user_offices:', insertUserOfficeQuery);
        console.log('Valores para insertar user_offices:', insertUserOfficeValues);

        await connection.execute(insertUserOfficeQuery, insertUserOfficeValues);
        console.log(`Usuario ${newUserId} asociado a la oficina ${office_id}`);
      }

      // --- COMMIT DE LA TRANSACCIÓN ---
      await connection.commit();
      console.log('Transacción de creación de usuario completada y cambios guardados.');

      // 3. Obtener los datos completos del usuario recién creado para la respuesta
      // (sin la contraseña hasheada, por seguridad)
      const [newUserDetailsRows]: [any[], any[]] = await pool.execute(
        `SELECT id, username, role, created_at, updated_at FROM users WHERE id = ?`,
        [newUserId]
      );

      if (newUserDetailsRows.length === 0) {
        throw new Error('No se pudo recuperar el usuario recién creado.');
      }

      const newUser = newUserDetailsRows[0];
      // Si office_id fue proporcionado, lo incluimos en la respuesta para el contexto
      if (office_id) {
        (newUser as any).office_id = office_id; // Agregamos office_id al objeto de respuesta
      }


      return NextResponse.json({ user: newUser }, { status: 201 });

    } catch (transactionError: any) {
      // --- ROLLBACK DE LA TRANSACCIÓN ---
      await connection.rollback();
      console.error('🔥 Transacción revertida debido a un error al crear el usuario:', transactionError);

      // Manejo de errores específicos
      if (transactionError.code === 'ER_DUP_ENTRY') {
        // Código de error de MySQL para entrada duplicada (ej. username único)
        return NextResponse.json(
          { error: 'El nombre de usuario ya existe. Por favor, elige otro.' },
          { status: 409 } // Conflict
        );
      }
      // Si el rol es inválido por alguna razón que no fue capturada antes (ej. FK constraint)
      if (transactionError.code === 'ER_NO_REFERENCED_ROW_2') {
        return NextResponse.json(
          { error: 'El rol proporcionado no existe.' },
          { status: 400 }
        );
      }
      throw transactionError; // Relanzamos para ser capturado por el catch externo
    }

  } catch (error: any) {
    console.error('🔥 Error general en POST /api/users:', error);
    return NextResponse.json({ error: 'Error interno del servidor al crear el usuario.' }, { status: 500 });
  } finally {
    if (connection) {
      connection.release(); // ¡Siempre liberar la conexión!
      console.log('Conexión liberada.');
    }
  }
}