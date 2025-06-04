import { NextRequest, NextResponse } from "next/server";
import { Pool } from 'mysql2/promise';
import { pool } from "../../lib/db";

type PaymentStatus = 'Pendiente' | 'Pagado' | 'En Proceso';

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const { affiliationId, paid }: { affiliationId?: number; paid?: PaymentStatus } = await req.json();

    if (!affiliationId || typeof affiliationId !== 'number') {
      return NextResponse.json({ message: 'ID de afiliación no proporcionado o inválido.' }, { status: 400 });
    }

    const validPaymentStatuses: PaymentStatus[] = ['Pendiente', 'Pagado', 'En Proceso'];
    if (!paid || !validPaymentStatuses.includes(paid)) {
      return NextResponse.json({ message: `Estado de pago inválido. Debe ser "${validPaymentStatuses.join('" o "')}".` }, { status: 400 });
    }

    let govRecordCompletedAt: string | null = null;
    let datePaidReceived: string | null = null;
    const currentTimestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    switch (paid) {
      case 'Pagado':
        govRecordCompletedAt = currentTimestamp;
        datePaidReceived = currentTimestamp;
        break;
      case 'En Proceso':
        datePaidReceived = currentTimestamp; 
        govRecordCompletedAt = null;
        break;
      case 'Pendiente':
      default:
        govRecordCompletedAt = null;
        datePaidReceived = null;
        break;
    }
    const query = `
      UPDATE monthly_affiliations
      SET 
        paid_status = ?,
        gov_record_completed_at = ?,
        date_paid_received = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE 
        id = ?;
    `;
    const values = [paid, govRecordCompletedAt, datePaidReceived, affiliationId];

    const [result]: any = await (pool as Pool).execute(query, values);

    if (result.affectedRows === 0) {
      return NextResponse.json({ message: 'Afiliación no encontrada o el estado de pago ya está actualizado.' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Estado de pago actualizado correctamente.' }, { status: 200 });

  } catch (error) {
    console.error('🔥 Error al actualizar estado de pago:', error);
    return NextResponse.json({ message: 'Error interno del servidor al actualizar el estado de pago.' }, { status: 500 });
  }
}