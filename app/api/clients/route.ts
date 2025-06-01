// app/api/clients/route.ts o donde sea que esté tu endpoint POST
// Asegúrate de que el path del archivo refleje la ruta de tu API (ej. /api/clients)

import { NextRequest, NextResponse } from 'next/server';
import { ResultSetHeader } from 'mysql2/promise'; // Importamos el tipo ResultSetHeader
import { pool } from '../lib/db'; // Asumiendo que `db.ts` está en `../lib/db`

export async function POST(request: NextRequest) {
  try {
    // Tipamos explícitamente el cuerpo de la solicitud JSON
    const {
      full_name,
      identification,
      company_id // Cambiado de `office_id` a `company_id` según tu esquema de DB
    }: {
      full_name: string;
      identification: string;
      company_id: number; // Suponemos que `company_id` es un número
    } = await request.json();

    console.log(`
      [CREAR CLIENTE] Datos recibidos:
      NOMBRE: ${full_name},
      IDENTIFICACION: ${identification},
      ID COMPAÑÍA: ${company_id},
    `);

    // Validaciones básicas
    if (!full_name || !identification || !company_id) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos: nombre completo, identificación y ID de la compañía.' },
        { status: 400 }
      );
    }

    // --- Consulta SQL pura para INSERTAR un nuevo cliente ---
    // 1. Usamos '?' como placeholder para MySQL.
    // 2. MySQL no tiene `RETURNING id` como PostgreSQL. Obtenemos el ID insertado
    //    a través de `insertId` en el resultado de la consulta.
    const insertQuery = `
      INSERT INTO clients (full_name, identification, company_id)
      VALUES (?, ?, ?)
    `;
    const insertValues: (string | number)[] = [full_name, identification, company_id];

    console.log('Query para insertar cliente:', insertQuery);
    console.log('Valores para insertar cliente:', insertValues);

    // Ejecutamos la consulta y tipamos el resultado como ResultSetHeader
    const [result]: [ResultSetHeader, any] = await pool.execute(insertQuery, insertValues);

    // Verificamos si la inserción fue exitosa y obtenemos el ID del nuevo cliente
    if (result.affectedRows === 0) {
      // Esto podría indicar una restricción UNIQUE violada u otro problema de DB
      return NextResponse.json(
        { error: 'No se pudo crear el cliente. La identificación podría ya existir.' },
        { status: 409 } // Conflict
      );
    }

    const newClientId = result.insertId;

    // --- Consulta para obtener los datos del cliente recién insertado ---
    // (Opcional, si necesitas todos los campos incluyendo `created_at`)
    const selectQuery = `
      SELECT id, full_name, identification, company_id, created_at, updated_at
      FROM clients
      WHERE id = ?
    `;
    const [rows]: [any[], any[]] = await pool.execute(selectQuery, [newClientId]);

    if (!rows || rows.length === 0) {
      // Debería ser imposible si la inserción fue exitosa, pero es una buena práctica
      throw new Error('No se pudo recuperar el cliente recién creado.');
    }

    const newClient = rows[0];

    return NextResponse.json({ client: newClient }, { status: 201 });

  } catch (error: any) {
    console.error('🔥 Error al crear el cliente:', error);

    // Puedes añadir lógica para manejar errores específicos, como identificaciones duplicadas
    if (error.code === 'ER_DUP_ENTRY') { // Código de error de MySQL para entrada duplicada
      return NextResponse.json(
        { error: 'La identificación proporcionada ya existe.' },
        { status: 409 } // Conflict
      );
    }

    return NextResponse.json(
      { error: 'Error interno del servidor al crear el cliente.' },
      { status: 500 }
    );
  }
}