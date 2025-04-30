import { pool } from '@/app/lib/db';
import { NextResponse } from 'next/server';

export async function PUT(request: Request) {
  try {
    const {
      affiliationId,
      clientId, // Asegúrate de enviar el clientId desde el formulario
      fullName,
      identification,
      value,
      eps,
      arl,
      risk,
      ccf,
      pensionFund,
      paid,
      observation,
      datePaidReceived,
    } = await request.json();

    console.log('🔄 DATOS RECIBIDOS PARA ACTUALIZAR:', {
      affiliationId,
      clientId,
      fullName,
      identification,
      value,
      eps,
      arl,
      risk,
      ccf,
      pensionFund,
      paid,
      observation,
      datePaidReceived,
    });

    if (!affiliationId || !clientId) {
      return NextResponse.json(
        { error: 'Faltan el ID de la afiliación o el ID del cliente para actualizar.' },
        { status: 400 }
      );
    }

    // Actualizar la tabla monthly_affiliations
    const getCatalogId = async (table: string, name: string) => {
      if (!name) return null;
      const res = await pool.query(`SELECT id FROM ${table} WHERE name = $1`, [name]);
      return res.rows[0]?.id || null;
    };

    const epsId = await getCatalogId('eps_list', eps);
    const arlId = await getCatalogId('arl_list', arl);
    const ccfId = await getCatalogId('ccf_list', ccf);
    const pensionFundId = await getCatalogId('pension_fund_list', pensionFund);

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
        date_paid_received = $9,
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
      datePaidReceived || null,
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
        updated_at = NOW()
      WHERE id = $3
    `;

    const clientValues = [fullName, identification, clientId];
    const clientResult = await pool.query(clientQuery, clientValues);

    if (clientResult.rowCount === 0) {
      return NextResponse.json(
        { error: 'No se encontró el cliente con el ID proporcionado.' },
        { status: 404 }
      );
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