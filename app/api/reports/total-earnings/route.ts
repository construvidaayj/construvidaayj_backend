import { NextRequest, NextResponse } from 'next/server';
import { pool } from '../../lib/db'; // Asegúrate de que esta ruta sea correcta para tu conexión a la base de datos

// Helper function to calculate month and year for a given number of months ago
function getMonthsAgo(date: Date, monthsAgo: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() - monthsAgo);
  return {
    month: d.getMonth() + 1, // getMonth() is 0-indexed, so add 1
    year: d.getFullYear(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    
    // Obtener parámetros de la URL
    const monthParam = searchParams.get('month');
    const yearParam = searchParams.get('year');
    const officeIdParam = searchParams.get('officeId');
    const userIdParam = searchParams.get('userId'); // ¡Nuevo parámetro userId!

    // --- Validaciones de parámetros obligatorios ---
    if (!officeIdParam) {
      return NextResponse.json({ success: false, error: 'The "officeId" parameter is required.' }, { status: 400 });
    }
    if (!userIdParam) {
      return NextResponse.json({ success: false, error: 'The "userId" parameter is required.' }, { status: 400 });
    }

    const officeId = parseInt(officeIdParam, 10);
    const userId = parseInt(userIdParam, 10);

    if (isNaN(officeId)) {
      return NextResponse.json({ success: false, error: 'Invalid "officeId" parameter. Must be a number.' }, { status: 400 });
    }
    if (isNaN(userId)) {
      return NextResponse.json({ success: false, error: 'Invalid "userId" parameter. Must be a number.' }, { status: 400 });
    }
    // --- Fin de validaciones de parámetros obligatorios ---

    // Determinar el mes y año de referencia
    const today = new Date();
    let referenceMonth = monthParam ? parseInt(monthParam, 10) : today.getMonth() + 1;
    let referenceYear = yearParam ? parseInt(yearParam, 10) : today.getFullYear();

    // Validar parámetros de fecha
    if (isNaN(referenceMonth) || referenceMonth < 1 || referenceMonth > 12) {
      return NextResponse.json({ success: false, error: 'Invalid "month" parameter. Must be between 1 and 12.' }, { status: 400 });
    }
    if (isNaN(referenceYear) || referenceYear < 2000) { // Asumiendo un año mínimo sensato
      return NextResponse.json({ success: false, error: 'Invalid "year" parameter. Must be a valid year (e.g., 2000 or later).' }, { status: 400 });
    }

    // Preparar las fechas para los últimos 4 meses
    const referenceDate = new Date(referenceYear, referenceMonth - 1, 1); // Se establece al 1ro del mes de referencia para el cálculo

    const monthsToReport = [
      { key: 'currentMonth', ...getMonthsAgo(referenceDate, 0) },
      { key: 'monthMinus1', ...getMonthsAgo(referenceDate, 1) },
      { key: 'monthMinus2', ...getMonthsAgo(referenceDate, 2) },
      { key: 'monthMinus3', ...getMonthsAgo(referenceDate, 3) },
    ];

    const reportData: { [key: string]: { month: number; year: number; totalEarnings: number } } = {};

    for (const { key, month, year } of monthsToReport) {
      // SQL query para obtener las ganancias totales para un mes/año/oficina/usuario específico
      // Usa prepared statements para prevenir inyección SQL.
      const query = `
        SELECT SUM(value) as totalEarnings
        FROM monthly_affiliations
        WHERE month = ?
          AND year = ?
          AND paid_status = 'Pagado'
          AND office_id = ?    -- ¡Filtrado por officeId!
          AND user_id = ?      -- ¡Filtrado por userId!
          AND is_active = TRUE -- Solo afiliaciones activas y pagadas
      `;
      const queryParams: (string | number)[] = [month, year, officeId, userId]; // Incluye officeId y userId en los parámetros

      // Ejecutar la consulta
      const [rows] = await pool.query(query, queryParams);
      
      // Castear rows a un array de objetos para acceder a las propiedades de forma segura
      const resultRows = rows as { totalEarnings: number | null }[];

      // Obtener las ganancias totales, por defecto 0 si es nulo o no hay filas
      const totalEarnings = resultRows.length > 0 && resultRows[0].totalEarnings !== null
        ? parseFloat(resultRows[0].totalEarnings.toString()) // Asegúrate de que sea un número
        : 0;

      reportData[key] = { month, year, totalEarnings };
    }

    return NextResponse.json({ success: true, data: reportData }, { status: 200 });

  } catch (error) {
    console.error('Error fetching total earnings report:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch total earnings report due to an internal server error.' },
      { status: 500 }
    );
  }
}