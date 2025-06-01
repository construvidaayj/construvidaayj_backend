import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../lib/db"; // Asegúrate de que este 'pool' esté configurado para MySQL

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { affiliationId, paid } = body; // 'paid' es el nuevo estado que viene del frontend

    if (!affiliationId) {
      return NextResponse.json({ message: 'ID de afiliación no proporcionado' }, { status: 400 });
    }

    // Validamos que el estado de pago sea uno de los valores permitidos en tu tabla `payment_statuses`
    if (typeof paid !== 'string' || !['Pendiente', 'Pagado'].includes(paid)) {
      return NextResponse.json({ message: 'Estado de pago inválido. Debe ser "Pendiente" o "Pagado".' }, { status: 400 });
    }

    // `gov_record_completed_at` en tu esquema MySQL, no `gov_registry_completed_at`
    let govRecordCompletedAt: string | null = null;
    let datePaidReceived: string | null = null;

    // Si el estado es 'Pagado', actualizamos las fechas. Si es 'Pendiente', las ponemos en NULL.
    if (paid === 'Pagado') {
      // MySQL usa `YYYY-MM-DD HH:MM:SS` para TIMESTAMP, o `YYYY-MM-DD` si solo quieres la fecha.
      // `new Date().toISOString().slice(0, 19).replace('T', ' ')` para un formato de fecha y hora completo.
      // Tu esquema tiene `TIMESTAMP`, así que un formato completo es más apropiado.
      // datePaidReceived = new Date().toISOString().slice(0, 19).replace('T', ' ');
      govRecordCompletedAt = new Date().toISOString().slice(0, 19).replace('T', ' '); // O podrías usar otra lógica para esta fecha
    } else {
      // Si el estado es 'Pendiente', las fechas asociadas deben ser NULL
      // datePaidReceived = null;
      govRecordCompletedAt = null;
    }

    const query = `
      UPDATE monthly_affiliations
      SET 
        paid_status = ?, -- Nombre de columna correcto en tu esquema MySQL
        gov_record_completed_at = ?, -- Nombre de columna correcto en tu esquema MySQL
        updated_at = CURRENT_TIMESTAMP
      WHERE 
        id = ?
    `;

    // Los valores deben coincidir con el orden de los '?' en la consulta
    const values = [paid, govRecordCompletedAt, affiliationId];

    const [result]: any[] = await pool.query(query, values); // mysql2/promise devuelve [rows, fields]

    // Opcional: Puedes verificar si alguna fila fue afectada para dar una respuesta más precisa
    if (result.affectedRows === 0) {
      return NextResponse.json({ message: 'Afiliación no encontrada o no hubo cambios' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Estado de pago actualizado correctamente' }, { status: 200 });

  } catch (error) {
    console.error('🔥 Error al actualizar estado de pago:', error);
    // Considera si quieres exponer el error.message en desarrollo, pero no en producción.
    return NextResponse.json({ message: 'Error del servidor al actualizar el estado de pago' }, { status: 500 });
  }
}