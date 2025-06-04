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

    // --- Inicio del cambio para la hora local de Colombia ---
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false, // Formato de 24 horas
      timeZone: 'America/Bogota' // Zona horaria de Colombia (GMT-5)
    };
    const formatter = new Intl.DateTimeFormat('es-CO', options);
    // Formatea y ajusta el string para que se parezca a 'YYYY-MM-DD HH:MM:SS'
    // Primero, obtén la fecha y hora con el formato local: 'DD/MM/YYYY, HH:MM:SS'
    const formattedDate = formatter.format(now);
    // Luego, reordena y limpia para obtener 'YYYY-MM-DD HH:MM:SS'
    const [datePart, timePart] = formattedDate.split(', ');
    const [day, month, year] = datePart.split('/');
    const currentTimestamp = `${year}-${month}-${day} ${timePart}`;
    // --- Fin del cambio ---
    
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
        // Si es 'Pendiente', ambas fechas deben ser NULL
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