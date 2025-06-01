import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '../lib/auth/jwt'; // Asumo que esta función no depende de la DB
import { pool } from '../lib/db'; // ¡Asegúrate de que este 'pool' esté configurado para MySQL!

export async function POST(request: NextRequest) {
  // Hemos recuperado la rama donde teniamos los cambios full y funcionando
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
      return NextResponse.json({ message: 'Token no proporcionado' }, { status: 401 });
    }

    // Asegúrate de que `verifyToken` lanza un error si el token es inválido o no decodifica
    // correctamente `id`. Si no lo hace, deberías añadir esa validación.
    const decoded: { id: number; [key: string]: any } = verifyToken(token); // Tipado para 'decoded'
    const { id: userId } = decoded;

    const { office_id } = await request.json();

    if (!office_id) {
      return NextResponse.json({ message: 'Falta el campo office_id' }, { status: 400 });
    }

    // --- 1. Verificar acceso a la oficina ---
    const checkOfficeQuery = `
      SELECT 1 FROM user_offices WHERE user_id = ? AND office_id = ?;
    `;
    const [checkOfficeRows]: any[] = await pool.query(checkOfficeQuery, [userId, office_id]);

    if (checkOfficeRows.length === 0) { // MySQL: verificar .length
      return NextResponse.json({ message: 'Acceso no autorizado a esta oficina' }, { status: 403 });
    }

    const now = new Date();
    let month = now.getMonth() + 1;
    let year = now.getFullYear();

    let foundAffiliation = false;
    let iterationCount = 0;
    let monthToCopy = month; // Almacena el mes donde se encontraron afiliaciones
    let yearToCopy = year;   // Almacena el año donde se encontraron afiliaciones

    // --- 2. Búsqueda retrocediendo meses hasta encontrar una afiliación activa en la oficina seleccionada ---
    while (!foundAffiliation && iterationCount < 12) {
      const checkAffiliationQuery = `
        SELECT ma.client_id
        FROM monthly_affiliations ma
        WHERE ma.office_id = ?
          AND ma.month = ?
          AND ma.year = ?
          AND ma.is_active = TRUE;
      `;
      const [checkAffiliationRows]: any[] = await pool.query(checkAffiliationQuery, [office_id, month, year]);

      if (checkAffiliationRows.length > 0) { // MySQL: verificar .length
        foundAffiliation = true;
        monthToCopy = month; // Guardar el mes encontrado
        yearToCopy = year;   // Guardar el año encontrado
        break;
      }

      month -= 1;
      if (month <= 0) {
        month = 12;
        year -= 1;
      }
      iterationCount++;
    }

    if (!foundAffiliation) {
      return NextResponse.json({ message: 'No se encontraron afiliaciones activas válidas para copiar en los últimos 12 meses' }, { status: 404 });
    }

    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // --- 3. Verificar si ya existen afiliaciones para el mes actual en esta oficina ---
    const checkCurrentAffiliationsQuery = `
      SELECT 1 FROM monthly_affiliations
      WHERE month = ? AND year = ? AND office_id = ?;
    `;
    const [checkCurrentAffiliationsRows]: any[] = await pool.query(
      checkCurrentAffiliationsQuery,
      [currentMonth, currentYear, office_id]
    );

    if (checkCurrentAffiliationsRows.length > 0) { // MySQL: verificar .length
      return NextResponse.json({ message: 'Ya existen afiliaciones para el mes actual en esta oficina. No se copió nada.' }, { status: 200 });
    }

    // --- 4. Obtener las afiliaciones del mes y año encontrados para copiar ---
    const copyAffiliationsQuery = `
      SELECT
        ma.client_id, ma.value, ma.risk, ma.observation,
        ma.paid_status, -- Correcto: usar 'paid_status' del esquema MySQL
        ma.date_paid_received, ma.gov_record_completed_at,
        ma.eps_id, ma.arl_id, ma.ccf_id, ma.pension_fund_id,
        ma.company_id -- Correcto: usar 'company_id' del esquema MySQL
      FROM monthly_affiliations ma
      WHERE ma.month = ? AND ma.year = ? AND ma.office_id = ? AND ma.is_active = TRUE;
    `;
    const [copyAffiliationsRows]: any[] = await pool.query(
      copyAffiliationsQuery,
      [monthToCopy, yearToCopy, office_id]
    );

    if (copyAffiliationsRows.length > 0) {
      let connection; // Declarar 'connection' fuera del try para que sea accesible en el finally
      try {
        connection = await pool.getConnection(); // Obtener una conexión individual para la transacción
        await connection.beginTransaction(); // Iniciar la transacción

        for (const row of copyAffiliationsRows) {
          // --- Verificar si ya existe una afiliación para el cliente, mes, año y oficina actuales ---
          // Esta verificación es crucial para la cláusula UNIQUE(client_id, month, year, office_id, user_id)
          const existsQuery = `
            SELECT 1 FROM monthly_affiliations
            WHERE client_id = ? AND month = ? AND year = ? AND office_id = ? AND user_id = ?;
          `;
          const [existsRows]: any[] = await connection.query(
            existsQuery,
            [row.client_id, currentMonth, currentYear, office_id, userId]
          );

          if (existsRows.length > 0) { // MySQL: verificar .length
            console.warn(`[COPY_AFFILIATIONS] La afiliación para cliente ${row.client_id} en ${currentMonth}/${currentYear} para oficina ${office_id} y usuario ${userId} ya existe. Saltando.`);
            continue; // Saltar esta fila e ir a la siguiente
          }

          // --- Insertar la nueva afiliación ---
          // NOTA: 'paid' en tu consulta original es ahora 'paid_status' en tu DB.
          //       'companies_id' en tu consulta original es ahora 'company_id' en tu DB.
          const insertQuery = `
            INSERT INTO monthly_affiliations (
              client_id, month, year, value, risk, observation,
              paid_status, -- Columna en tu esquema MySQL
              date_paid_received, gov_record_completed_at,
              eps_id, arl_id, ccf_id, pension_fund_id,
              office_id, user_id, company_id -- Columna en tu esquema MySQL
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
          `;
          await connection.query(
            insertQuery,
            [
              row.client_id,
              currentMonth,
              currentYear,
              row.value,
              row.risk,
              row.observation,
              'Pendiente', // El estado de pago inicial siempre es 'Pendiente'
              null,        // date_paid_received es NULL al copiar
              null,        // gov_record_completed_at es NULL al copiar
              row.eps_id,
              row.arl_id,
              row.ccf_id,
              row.pension_fund_id,
              office_id,
              userId,
              row.company_id // Usar el nombre de columna correcto
            ]
          );
          console.log(`Afiliación insertada para cliente ${row.client_id} en la oficina ${office_id} para ${currentMonth}/${currentYear}`);
        }

        await connection.commit(); // Confirmar la transacción
        return NextResponse.json({ message: 'Afiliaciones copiadas exitosamente' }, { status: 200 });

      } catch (error: unknown) {
        if (connection) {
          await connection.rollback(); // Deshacer la transacción en caso de error
        }
        console.error('🔥 Error durante la transacción de copia de afiliaciones:', error);
        return NextResponse.json({ message: 'Error al copiar las afiliaciones', error: error }, { status: 500 });
      } finally {
        if (connection) {
          connection.release(); // Siempre liberar la conexión
        }
      }
    } else {
      return NextResponse.json({ message: 'No se encontraron afiliaciones activas para copiar en esta oficina' }, { status: 404 });
    }

  } catch (error) {
    console.error('🔥 Error interno del servidor al procesar la solicitud:', error);
    return NextResponse.json({ message: 'Error interno del servidor', error: error }, { status: 500 });
  }
}