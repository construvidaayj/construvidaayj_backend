import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/app/lib/auth/jwt';
import { pool } from '@/app/lib/db';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
      return NextResponse.json({ message: 'Token no proporcionado' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    const { id: userId } = decoded;

    const { office_id } = await request.json();

    if (!office_id) {
      return NextResponse.json({ message: 'Falta el campo office_id' }, { status: 400 });
    }

    // Verificar acceso a la oficina
    const checkOffice = await pool.query(
      'SELECT 1 FROM user_offices WHERE user_id = $1 AND office_id = $2',
      [userId, office_id]
    );

    if (checkOffice.rowCount === 0) {
      return NextResponse.json({ message: 'Acceso no autorizado a esta oficina' }, { status: 403 });
    }

    const now = new Date();
    let month = now.getMonth() + 1;
    let year = now.getFullYear();

    let foundAffiliation = false;
    let iterationCount = 0;

    // Búsqueda retrocediendo meses hasta encontrar una afiliación activa en la oficina seleccionada
    while (!foundAffiliation && iterationCount < 12) {
      const checkAffiliation = await pool.query(
        `SELECT ma.client_id
         FROM monthly_affiliations ma
         WHERE ma.office_id = $1
           AND ma.month = $2
           AND ma.year = $3
           AND ma.is_active = true`,
        [office_id, month, year]
      );

      if (checkAffiliation.rowCount! > 0) {
        foundAffiliation = true;
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

    const checkCurrentAffiliations = await pool.query(
      `SELECT 1 FROM monthly_affiliations
       WHERE month = $1 AND year = $2 AND office_id = $3`,
      [currentMonth, currentYear, office_id]
    );

    if (checkCurrentAffiliations.rowCount! > 0) {
      return NextResponse.json({ message: 'Ya existen afiliaciones para el mes actual en esta oficina. No se copió nada.' }, { status: 200 });
    }

    // Ahora que encontramos una afiliación activa en la oficina seleccionada, vamos a copiarla al mes y año actual con estado "pendiente"
    const copyAffiliations = await pool.query(
      `SELECT ma.client_id, ma.value, ma.risk, ma.observation, ma.paid, ma.date_paid_received,
              ma.eps_id, ma.arl_id, ma.ccf_id, ma.pension_fund_id, ma.companies_id
             FROM monthly_affiliations ma
             WHERE ma.month = $1 AND ma.year = $2 AND ma.office_id = $3 AND ma.is_active = true`,
      [month, year, office_id]
    );

    if (copyAffiliations.rowCount! > 0) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (const row of copyAffiliations.rows) {
          // Verificamos si ya existe una afiliación para el cliente, mes, año y oficina actuales
          const exists = await client.query(
            `SELECT 1 FROM monthly_affiliations
             WHERE client_id = $1 AND month = $2 AND year = $3 AND office_id = $4 AND user_id = $5`,
            [row.client_id, currentMonth, currentYear, office_id, userId]
          );

          if (exists.rowCount! > 0) {
            continue;
          }

          // Insertamos la nueva afiliación
          await client.query(
            `INSERT INTO monthly_affiliations (client_id, month, year, value, risk, observation, paid, date_paid_received, eps_id, arl_id, ccf_id, pension_fund_id, office_id, user_id, companies_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              row.client_id,
              currentMonth,
              currentYear,
              row.value,
              row.risk,
              row.observation,
              'Pending',
              row.date_paid_received,
              row.eps_id,
              row.arl_id,
              row.ccf_id,
              row.pension_fund_id,
              office_id,
              userId,
              row.companies_id // Se copia el companies_id
            ]
          );
          console.log(`Afiliación insertada para cliente ${row.client_id} en la oficina ${office_id}`);
        }

        await client.query('COMMIT');
        return NextResponse.json({ message: 'Afiliaciones copiadas exitosamente' });

      } catch (error: unknown) {
        await client.query('ROLLBACK');
        console.error('Error durante la transacción:', error);
        return NextResponse.json({ message: 'Error al copiar las afiliaciones', error: error }, { status: 500 });
      } finally {
        client.release();
      }
    } else {
      return NextResponse.json({ message: 'No se encontraron afiliaciones activas para copiar en esta oficina' }, { status: 404 });
    }

  } catch (error) {
    console.error('Error interno del servidor:', error);
    return NextResponse.json({ message: 'Error interno del servidor', error: error }, { status: 500 });
  }
}