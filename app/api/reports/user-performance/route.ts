import { pool } from "@/app/api/lib/db";
import { NextRequest, NextResponse } from "next/server";

// 1. Define una interfaz para la estructura de cada fila del reporte
interface UserPerformanceReportRow {
  userId: number;
  username: string;
  totalAffiliationsRegistered: number;
  totalValueBrute: string; // NUMERIC(12,2) de PostgreSQL a menudo se devuelve como string en JS
  totalValuePaid: string;   // NUMERIC(12,2) de PostgreSQL a menudo se devuelve como string en JS
  percentagePaid: string;   // NUMERIC(5,2) de PostgreSQL a menudo se devuelve como string en JS
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const monthParam = searchParams.get('month');
    const yearParam = searchParams.get('year');
    const officeIdParam = searchParams.get('officeId'); // Opcional

    if (!monthParam || !yearParam) {
      return NextResponse.json({ message: 'Mes y año son parámetros requeridos.' }, { status: 400 });
    }

    // 2. Parseo y validación de parámetros con tipado estricto
    const monthNum = parseInt(monthParam, 10);
    const yearNum = parseInt(yearParam, 10);

    if (isNaN(monthNum) || monthNum < 1 || monthNum > 12 || isNaN(yearNum) || yearNum < 2000) {
      return NextResponse.json({ message: 'Parámetros de mes o año inválidos.' }, { status: 400 });
    }

    // Construcción dinámica de la cláusula WHERE para officeId
    let officeFilter = '';
    // 3. Tipado explícito para queryValues
    let queryValues: (number | string)[] = [monthNum, yearNum];
    let valueIndex = 3; // El índice para los valores de la query

    if (officeIdParam) {
      const officeIdNum = parseInt(officeIdParam, 10);
      if (isNaN(officeIdNum)) {
        return NextResponse.json({ message: 'El ID de oficina es inválido.' }, { status: 400 });
      }
      officeFilter = `AND ma.office_id = $${valueIndex}`;
      queryValues.push(officeIdNum);
    }

    const query = `
      SELECT
          u.id AS "userId",
          u.username,
          COUNT(ma.id)::int AS "totalAffiliationsRegistered",
          SUM(ma.value)::numeric(12,2) AS "totalValueBrute",
          SUM(CASE WHEN ma.paid = 'Pagado' THEN ma.value ELSE 0 END)::numeric(12,2) AS "totalValuePaid",
          (SUM(CASE WHEN ma.paid = 'Pagado' THEN ma.value ELSE 0 END) * 100.0 / NULLIF(SUM(ma.value), 0))::numeric(5,2) AS "percentagePaid"
      FROM
          monthly_affiliations ma
      JOIN
          users u ON ma.user_id = u.id
      WHERE
          ma.month = $1
          AND ma.year = $2
          ${officeFilter}
      GROUP BY
          u.id, u.username
      ORDER BY
          "totalValuePaid" DESC;
    `;

    // 4. Casteo del resultado de la consulta a la interfaz definida
    const result = await pool.query<UserPerformanceReportRow>(query, queryValues);

    return NextResponse.json(result.rows, { status: 200 });

  } catch (error: unknown) { // 5. Tipado del error como 'unknown' y luego aserción
    console.error('Error al obtener el reporte de rendimiento por usuario:', error);
    // Aseguramos que 'error' es un objeto Error para acceder a 'message'
    return NextResponse.json({ message: 'Error interno del servidor al generar el reporte.', error: (error instanceof Error ? error.message : 'Un error desconocido ocurrió.') }, { status: 500 });
  }
}