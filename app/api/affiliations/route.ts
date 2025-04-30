import { pool } from '@/app/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { month, year, userId, officeId } = await request.json();

    console.log(`🔍 PARAMETROS - MES: ${month}, AÑO: ${year}, USER: ${userId}, OFICINA: ${officeId}`);

    if (!userId || !month || !year || !officeId) {
      return NextResponse.json(
        { error: 'Faltan parámetros: userId, month, year u officeId' },
        { status: 400 }
      );
    }

    const monthNum = parseInt(month);
    const yearNum = parseInt(year);

    if (isNaN(monthNum) || isNaN(yearNum)) {
      return NextResponse.json(
        { error: 'Mes o año inválido' },
        { status: 400 }
      );
    }
    // (Opcional) Validar si el usuario tiene acceso a esa oficina:
    const accessCheck = await pool.query(
      'SELECT 1 FROM user_offices WHERE user_id = $1 AND office_id = $2',
      [userId, officeId]
    );

    if (accessCheck.rowCount === 0) {
      return NextResponse.json(
        { error: 'El usuario no tiene acceso a esta oficina' },
        { status: 403 }
      );
    }

    // Consulta los clientes afiliados en ese mes y año en esa oficina
    const query = `
    SELECT 
      c.id AS client_id, 
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
    INNER JOIN monthly_affiliations ma 
      ON c.id = ma.client_id 
      AND ma.month = $2 
      AND ma.year = $3
      AND ma.is_active = TRUE 
      AND ma.deleted_at IS NULL
    LEFT JOIN eps_list eps ON ma.eps_id = eps.id
    LEFT JOIN arl_list arl ON ma.arl_id = arl.id
    LEFT JOIN ccf_list ccf ON ma.ccf_id = ccf.id
    LEFT JOIN pension_fund_list pf ON ma.pension_fund_id = pf.id
    INNER JOIN user_offices uo ON uo.office_id = c.office_id
    WHERE c.office_id = $1 
      AND uo.user_id = $4
      AND c.is_active = TRUE
    ORDER BY c.full_name;
  `;


    const res = await pool.query(query, [officeId, monthNum, yearNum, userId]);

    if (res.rowCount === 0) {
      return NextResponse.json(
        { message: 'No hay afiliaciones registradas para ese mes, año y oficina' },
        { status: 404 }
      );
    }

    const data = res.rows.map(row => ({
      clientId: row.client_id,
      affiliationId: row.affiliation_id,
      fullName: row.full_name,
      identification: row.identification,
      value: row.value,
      risk: row.risk,
      observation: row.observation,
      paid: row.paid,
      datePaidReceived: row.date_paid_received,
      eps: row.eps,
      arl: row.arl,
      ccf: row.ccf,
      pensionFund: row.pension_fund,
    }));

    return NextResponse.json(data, { status: 200 });

  } catch (error) {
    console.error('🔥 Error en el servidor:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { affiliationId, clientId, userId } = body; // Ahora esperamos recibir clientId

    if (!affiliationId || !clientId || !userId) {
      return new NextResponse(
        JSON.stringify({ message: 'Faltan datos requeridos (affiliationId, clientId y userId)' }),
        { status: 400 }
      );
    }

    // **Verificación de que la afiliación exista y esté activa**
    const affiliationCheck = await pool.query(
      'SELECT 1 FROM monthly_affiliations WHERE id = $1 AND is_active = TRUE',
      [affiliationId]
    );

    if (affiliationCheck.rowCount === 0) {
      return new NextResponse(
        JSON.stringify({ message: 'Afiliación no encontrada o ya eliminada' }),
        { status: 404 }
      );
    }

    // **Verificación de que el usuario tenga permiso para eliminar (es quien creó la afiliación)**
    const userPermissionCheck = await pool.query(
      'SELECT 1 FROM monthly_affiliations WHERE id = $1 AND user_id = $2',
      [affiliationId, userId]
    );

    if (userPermissionCheck.rowCount === 0) {
      return new NextResponse(
        JSON.stringify({ message: 'El usuario no tiene permisos para eliminar esta afiliación' }),
        { status: 403 }
      );
    }

    // **Inicio de una transacción para asegurar la atomicidad de las operaciones**
    await pool.query('BEGIN');

    try {
      // **Eliminación lógica de la afiliación**
      await pool.query(
        `UPDATE monthly_affiliations
         SET is_active = FALSE,
             deleted_at = CURRENT_TIMESTAMP,
             deleted_by = $1
         WHERE id = $2`,
        [userId, affiliationId]
      );

      // **Eliminación lógica del cliente**
      await pool.query(
        `UPDATE clients
         SET is_active = FALSE,
             updated_at = CURRENT_TIMESTAMP -- Puedes agregar una columna deleted_at y deleted_by si lo deseas también para la tabla clients
         WHERE id = $1`,
        [clientId]
      );

      // **Confirmar la transacción**
      await pool.query('COMMIT');

      return new NextResponse(
        JSON.stringify({ message: 'Afiliación y cliente eliminados correctamente' }),
        { status: 200 }
      );
    } catch (transactionError) {
      // **Revertir la transacción en caso de error**
      await pool.query('ROLLBACK');
      console.error('Error al eliminar afiliación y cliente (transacción):', transactionError);
      return new NextResponse(
        JSON.stringify({ message: 'Error al eliminar la afiliación y el cliente' }),
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error al eliminar afiliación y cliente:', error);
    return new NextResponse(JSON.stringify({ message: 'Error del servidor' }), { status: 500 });
  }
}