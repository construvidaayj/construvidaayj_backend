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

    // Búsqueda retrocediendo meses hasta encontrar una afiliación
    while (!foundAffiliation && iterationCount < 12) {
      const checkAffiliation = await pool.query(
        `SELECT c.id AS client_id, 
                c.full_name, 
                c.identification, 
                ma.id AS affiliation_id, 
                ma.value, 
                ma.risk, 
                ma.observation, 
                ma.paid, 
                TO_CHAR(ma.date_paid_received, 'YYYY-MM-DD') AS date_paid_received,
                eps.name AS eps, 
                arl.name AS arl, 
                ccf.name AS ccf, 
                pf.name AS pension_fund
         FROM clients c
         INNER JOIN monthly_affiliations ma ON c.id = ma.client_id
         LEFT JOIN eps_list eps ON ma.eps_id = eps.id
         LEFT JOIN arl_list arl ON ma.arl_id = arl.id
         LEFT JOIN ccf_list ccf ON ma.ccf_id = ccf.id
         LEFT JOIN pension_fund_list pf ON ma.pension_fund_id = pf.id
         INNER JOIN user_offices uo ON uo.office_id = c.office_id
         WHERE c.office_id = $1 AND uo.user_id = $2 AND ma.month = $3 AND ma.year = $4`,
        [office_id, userId, month, year]
      );

      if (checkAffiliation.rowCount! > 0) {
        console.log(`Se encontraron afiliaciones para el mes ${month} y año ${year}.`);
        foundAffiliation = true;

        // Verificar si ya existen afiliaciones para el mes y año actual
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();

        const checkCurrentAffiliations = await pool.query(
          `SELECT 1 FROM monthly_affiliations 
           WHERE month = $1 AND year = $2 AND office_id = $3`,
          [currentMonth, currentYear, office_id]
        );

        if (checkCurrentAffiliations.rowCount! > 0) {
          console.log(`Ya existen afiliaciones para el mes ${currentMonth} y año ${currentYear}. No se copian datos.`);
          return NextResponse.json({ message: 'Ya existen afiliaciones para el mes actual. No se copió nada.' }, { status: 200 });
        }

        break;
      }

      // Si no se encuentra, retrocedemos un mes
      console.log(`No se encontraron afiliaciones para el mes ${month} y año ${year}.`);

      month -= 1;
      if (month <= 0) {
        month = 12;
        year -= 1;
      }

      iterationCount++;
    }

    if (!foundAffiliation) {
      return NextResponse.json({ message: 'No se encontraron afiliaciones válidas para copiar en los últimos 12 meses' }, { status: 404 });
    }

    // Ahora que encontramos una afiliación, vamos a copiarla al mes y año actual con estado "pendiente"
    const copyAffiliations = await pool.query(
      `SELECT ma.client_id, ma.value, ma.risk, ma.observation, ma.paid, ma.date_paid_received,
              ma.eps_id, ma.arl_id, ma.ccf_id, ma.pension_fund_id
       FROM monthly_affiliations ma
       WHERE ma.month = $1 AND ma.year = $2`,
      [month, year]
    );

    if (copyAffiliations.rowCount! > 0) {
      // Comenzamos la transacción para insertar las afiliaciones copiadas
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        for (const row of copyAffiliations.rows) {
          await client.query(
            `INSERT INTO monthly_affiliations (client_id, month, year, value, risk, observation, paid, date_paid_received, eps_id, arl_id, ccf_id, pension_fund_id, office_id, user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              row.client_id,
              now.getMonth() + 1,
              now.getFullYear(),
              row.value,
              row.risk,
              row.observation,
              'Pendiente',
              row.date_paid_received,
              row.eps_id,
              row.arl_id,
              row.ccf_id,
              row.pension_fund_id,
              office_id,
              userId
            ]
          );

          console.log(`Afiliación copiada para el cliente ${row.client_id} en el mes ${now.getMonth() + 1} y año ${now.getFullYear()}`);
        }

        await client.query('COMMIT');
        console.log('Afiliaciones copiadas exitosamente.');
        return NextResponse.json({ message: 'Afiliaciones copiadas exitosamente' });

      } catch (error) {
        await client.query('ROLLBACK');
        
        return NextResponse.json({ message: 'Error al copiar las afiliaciones', error: error }, { status: 500 });
      } finally {
        client.release();
      }
    } else {
      return NextResponse.json({ message: 'No se encontraron afiliaciones para copiar' }, { status: 404 });
    }

  } catch (error) {

    return NextResponse.json({ message: 'Error interno del servidor', error: error }, { status: 500 });
  }
}
