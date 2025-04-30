import { pool } from "@/app/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { affiliationId, paid } = body;

    if (!affiliationId) {
      return NextResponse.json({ message: 'ID de afiliación no proporcionado' }, { status: 400 });
    }

    if (typeof paid !== 'string' || !['Pendiente', 'Pagado'].includes(paid)) {
      return NextResponse.json({ message: 'Estado de pago inválido' }, { status: 400 });
    }

    const datePaidReceived = paid === 'Pagado' ? new Date().toISOString().split('T')[0] : null;

    const query = `
      UPDATE monthly_affiliations
      SET 
        paid = $1,
        date_paid_received = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE 
        id = $3
    `;

    const values = [paid, datePaidReceived, affiliationId];

    await pool.query(query, values);

    return NextResponse.json({ message: 'Estado de pago actualizado correctamente' }, { status: 200 });

  } catch (error) {
    console.error('Error al actualizar estado de pago:', error);
    return NextResponse.json({ message: 'Error del servidor' }, { status: 500 });
  }
}
