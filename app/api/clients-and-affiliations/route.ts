import { pool } from '@/app/lib/db';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();

  const {
    fullName,
    identification,
    value,
    eps,
    arl,
    risk,
    ccf,
    pensionFund,
    observation,
    paid,
    datePaidReceived,
    office_id,
  } = body;

  if (!fullName || !identification || value === undefined || !eps || !risk || !office_id) {
    return new Response(JSON.stringify({ message: 'Faltan campos obligatorios' }), { status: 400 });
  }

  try {
    const existingClientResult = await pool.query(
      'SELECT id FROM clients WHERE identification = $1',
      [identification]
    );

    if (existingClientResult.rows.length > 0) {
      return new Response(JSON.stringify({ message: 'Ya existe un cliente con esta identificación' }), { status: 409 });
    }

    const newClientResult = await pool.query(
      'INSERT INTO clients (full_name, identification, office_id) VALUES ($1, $2, $3) RETURNING id',
      [fullName, identification, office_id]
    );

    const clientId = newClientResult.rows[0].id;

    const epsResult = await pool.query('SELECT id FROM eps_list WHERE name = $1', [eps]);
    const arlResult = arl ? await pool.query('SELECT id FROM arl_list WHERE name = $1', [arl]) : { rows: [] };
    const ccfResult = ccf ? await pool.query('SELECT id FROM ccf_list WHERE name = $1', [ccf]) : { rows: [] };
    const pensionFundResult = pensionFund ? await pool.query('SELECT id FROM pension_fund_list WHERE name = $1', [pensionFund]) : { rows: [] };

    const epsId = epsResult.rows[0]?.id;
    const arlId = arlResult.rows[0]?.id || null;
    const ccfId = ccfResult.rows[0]?.id || null;
    const pensionFundId = pensionFundResult.rows[0]?.id || null;

    if (!epsId) {
      return new Response(JSON.stringify({ message: 'La EPS seleccionada no existe' }), { status: 400 });
    }

    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    const loggedInUserId = 1;

    await pool.query(
      `INSERT INTO monthly_affiliations 
        (client_id, month, year, value, eps_id, arl_id, ccf_id, pension_fund_id, risk, observation, paid, date_paid_received, office_id, user_id) 
       VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        clientId,
        currentMonth,
        currentYear,
        value,
        epsId,
        arlId,
        ccfId,
        pensionFundId,
        risk,
        observation || null,
        paid,
        datePaidReceived || null,
        office_id,
        loggedInUserId,
      ]
    );

    return new Response(JSON.stringify({ message: 'Cliente y afiliación creados exitosamente', clientId }), { status: 201 });

  } catch (error: any) {
    console.error('Error al crear cliente y afiliación:', error);
    return new Response(JSON.stringify({ message: 'Error al crear cliente y afiliación', error: error.message }), { status: 500 });
  }
}
