import { pool } from '@/app/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      fullName,
      identification,
      officeId,
      affiliation,
      userId, // Asegúrate de recibir el userId para la afiliación
    } = body;

      console.log(`
        NOMBRE: ${fullName},
        IDENTIFICACION: ${identification},
        ID OFICINA: ${officeId},
        AFILIACION: ${affiliation},
        ID USUARIO: ${userId}
        `);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    let clientId: number;

    // 1. Buscar cliente por identificación
    const existingClientResult = await pool.query(
      'SELECT id FROM clients WHERE identification = $1',
      [identification]
    );

    if (existingClientResult.rows.length > 0) {
      // Cliente ya existe, usar su ID
      clientId = existingClientResult.rows[0].id;
      console.log(`Cliente con identificación ${identification} ya existe. Usando clientId: ${clientId}`);
    } else {
      // Cliente no existe, crear uno nuevo
      const newClientResult = await pool.query(
        `INSERT INTO clients (full_name, identification, office_id)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [fullName, identification, officeId]
      );
      clientId = newClientResult.rows[0].id;
      console.log(`Nuevo cliente creado con clientId: ${clientId}`);
    }

    // 2. Crear la afiliación para el cliente (existente o nuevo)
    await pool.query(
      `INSERT INTO monthly_affiliations (
         client_id, month, year, value,
         eps_id, arl_id, ccf_id, pension_fund_id,
         risk, observation, user_id, office_id
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7, $8,
         $9, $10, $11, $12
       )`,
      [
        clientId,
        currentMonth,
        currentYear,
        affiliation.value,
        affiliation.epsId || null,
        affiliation.arlId || null,
        affiliation.ccfId || null,
        affiliation.pensionFundId || null,
        affiliation.risk || null,
        affiliation.observation || null,
        userId,
        officeId,
      ]
    );

    return NextResponse.json({ success: true, clientId });

  } catch (error) {
    console.error('Error en POST /api/clients:', error);
    return NextResponse.json({ success: false, error: 'Error al crear/vincular cliente y crear afiliación' }, { status: 500 });
  }
}