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

    // Consulta los clientes afiliados en ese mes y año EN ESA OFICINA
    const query = `
     SELECT
      c.id AS client_id,
      c.full_name,
      c.identification,
      comp.name AS company_name, -- Añadir el nombre de la compañía
      ma.id AS affiliation_id,
      ma.value,
      ma.risk,
      ma.observation,
      ma.paid,
      TO_CHAR(ma.date_paid_received, 'YYYY-MM-DD') AS date_paid_received,
      TO_CHAR(ma.gov_registry_completed_at, 'YYYY-MM-DD') AS gov_registry_completed_at,
      eps.name AS eps,
      arl.name AS arl,
      ccf.name AS ccf,
      pf.name AS pension_fund,
      array_agg(cp.phone_number) AS phones -- Agrupar los teléfonos en un array
    FROM monthly_affiliations ma
    INNER JOIN clients c ON c.id = ma.client_id
    AND ma.month = $2
    AND ma.year = $3
    AND ma.is_active = TRUE
    AND ma.deleted_at IS NULL
    INNER JOIN companies comp ON c.companies_id = comp.id -- Join con la tabla companies
    LEFT JOIN eps_list eps ON ma.eps_id = eps.id
    LEFT JOIN arl_list arl ON ma.arl_id = arl.id
    LEFT JOIN ccf_list ccf ON ma.ccf_id = ccf.id
    LEFT JOIN pension_fund_list pf ON ma.pension_fund_id = pf.id
    LEFT JOIN client_phones cp ON c.id = cp.client_id -- Join con la tabla client_phones
    WHERE ma.office_id = $1
    GROUP BY c.id, c.full_name, c.identification, comp.name, ma.id, ma.value, ma.risk, ma.observation, ma.paid, ma.date_paid_received, ma.gov_registry_completed_at, eps.name, arl.name, ccf.name, pf.name
    ORDER BY c.full_name;
    `;

    const res = await pool.query(query, [officeId, monthNum, yearNum]);

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
      companyName: row.company_name, // Nuevo campo
      value: row.value,
      risk: row.risk,
      observation: row.observation,
      paid: row.paid,
      govRegistryCompletedAt: row.govRegistryCompletedAt,
      eps: row.eps,
      arl: row.arl,
      ccf: row.ccf,
      pensionFund: row.pension_fund,
      phones: row.phones || [], // Nuevo campo, asegurar que sea un array (puede ser null si no hay teléfonos)
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
    const { affiliationId, userId } = body; // Todavía recibimos userId para el deleted_by
    console.log(`USUARIO QUE ELIMINA EL REGISTRO: ${userId}
      AFILIACION QUE SE ELIMINA ${affiliationId}`);
    if (!affiliationId || !userId) {
      return new NextResponse(
        JSON.stringify({ message: 'Faltan datos requeridos (affiliationId y userId)' }),
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

    // **Eliminación lógica de la afiliación**
    await pool.query(
      `UPDATE monthly_affiliations
       SET is_active = FALSE,
           deleted_at = CURRENT_TIMESTAMP,
           deleted_by = $1
       WHERE id = $2`,
      [userId, affiliationId]
    );

    return new NextResponse(
      JSON.stringify({ message: 'Afiliación eliminada correctamente' }),
      { status: 200 }
    );

  } catch (error) {
    console.error('Error al eliminar afiliación:', error);
    return new NextResponse(JSON.stringify({ message: 'Error del servidor' }), { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const {
      affiliationId,
      clientId,
      fullName,
      identification,
      companyId,
      phones,
      value,
      eps,
      arl,
      risk,
      ccf,
      pensionFund,
      paid,
      observation,
      govRegistryCompletedAt,
    } = await request.json();

    console.log('DATOS RECIBIDOS PARA ACTUALIZAR:', {
      affiliationId,
      clientId,
      fullName,
      identification,
      companyId,
      phones,
      value,
      eps,
      arl,
      risk,
      ccf,
      pensionFund,
      paid,
      observation,
      govRegistryCompletedAt,
    });

    if (!affiliationId || !clientId) {
      return NextResponse.json(
        { error: 'Faltan el ID de la afiliación o el ID del cliente para actualizar.' },
        { status: 400 }
      );
    }

    const getCatalogId = async (table: string, name: string) => {
      if (!name) return null;
      const res = await pool.query(`SELECT id FROM ${table} WHERE name = $1`, [name]);
      return res.rows[0]?.id || null;
    };

    const epsId = await getCatalogId('eps_list', eps);
    const arlId = await getCatalogId('arl_list', arl);
    const ccfId = await getCatalogId('ccf_list', ccf);
    const pensionFundId = await getCatalogId('pension_fund_list', pensionFund);

    // Actualizar la tabla monthly_affiliations
    const affiliationQuery = `
            UPDATE monthly_affiliations
            SET
                value = $1,
                eps_id = $2,
                arl_id = $3,
                risk = $4,
                ccf_id = $5,
                pension_fund_id = $6,
                paid = $7,
                observation = $8,
                gov_registry_completed_at = $9,
                updated_at = NOW()
            WHERE id = $10
        `;

    const affiliationValues = [
      value,
      epsId,
      arlId,
      risk,
      ccfId,
      pensionFundId,
      paid,
      observation,
      govRegistryCompletedAt || null,
      affiliationId,
    ];

    const affiliationResult = await pool.query(affiliationQuery, affiliationValues);

    if (affiliationResult.rowCount === 0) {
      return NextResponse.json(
        { error: 'No se encontró la afiliación con el ID proporcionado.' },
        { status: 404 }
      );
    }

    // Actualizar la tabla clients
    const clientQuery = `
        UPDATE clients
        SET
            full_name = $1,
            identification = $2,
            companies_id = $3,
            updated_at = NOW()
        WHERE id = $4
    `;
    const clientValues = [fullName, identification, companyId, clientId];
    const clientResult = await pool.query(clientQuery, clientValues);

    if (clientResult.rowCount === 0) {
      return NextResponse.json(
        { error: 'No se encontró el cliente con el ID proporcionado.' },
        { status: 404 }
      );
    }

    // Actualizar la tabla client_phones
    // 1. Eliminar los teléfonos existentes para este cliente
    await pool.query(`DELETE FROM client_phones WHERE client_id = $1`, [clientId]);

    // 2. Insertar los nuevos números de teléfono
    if (phones && phones.length > 0) {
      const insertPhoneQuery = `
                INSERT INTO client_phones (client_id, phone_number)
                VALUES ($1, $2)
            `;
      for (const phone of phones) {
        await pool.query(insertPhoneQuery, [clientId, phone]);
      }
    }

    return NextResponse.json(
      { message: 'Datos del cliente y afiliación actualizados exitosamente.' },
      { status: 200 }
    );

  } catch (error) {
    console.error('🔥 Error al actualizar los datos:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor al actualizar los datos.' },
      { status: 500 }
    );
  }
}