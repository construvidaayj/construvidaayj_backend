// app/api/reports/monthly-income-trend/route.ts
import { pool } from "@/app/api/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

// Interfaz para la fila de datos que esperamos de la base de datos
interface MonthlyIncomeTrendRow {
  year: number;
  month: number;
  totalValuePaid: string; // NUMERIC(12,2) se devuelve como string
}

// Interfaz para los datos formateados que devolveremos
interface FormattedMonthlyIncomeTrend {
  year: number;
  month: number;
  monthName: string; // e.g., "Enero"
  totalValuePaid: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const startYearParam = searchParams.get('startYear');
    const endYearParam = searchParams.get('endYear');
    const officeIdParam = searchParams.get('officeId'); // Opcional

    if (!startYearParam || !endYearParam) {
      return NextResponse.json({ message: 'Los parámetros startYear y endYear son requeridos.' }, { status: 400 });
    }

    const startYear = parseInt(startYearParam, 10);
    const endYear = parseInt(endYearParam, 10);

    if (isNaN(startYear) || isNaN(endYear) || startYear < 2000 || endYear < startYear) {
      return NextResponse.json({ message: 'Parámetros de año inválidos.' }, { status: 400 });
    }

    let officeFilter = '';
    let queryValues: (number | string)[] = [startYear, endYear];
    let valueIndex = 3; // El índice para office_id, si se usa

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
          ma.year,
          ma.month,
          SUM(CASE WHEN ma.paid = 'Pagado' THEN ma.value ELSE 0 END)::numeric(12,2) AS "totalValuePaid"
      FROM
          monthly_affiliations ma
      WHERE
          ma.year >= $1
          AND ma.year <= $2
          ${officeFilter}
      GROUP BY
          ma.year,
          ma.month
      ORDER BY
          ma.year ASC,
          ma.month ASC;
    `;

    const result = await pool.query<MonthlyIncomeTrendRow>(query, queryValues);

    // Formatear los resultados para incluir el nombre del mes
    const formattedRows: FormattedMonthlyIncomeTrend[] = result.rows.map(row => ({
      ...row,
      monthName: format(new Date(row.year, row.month - 1, 1), 'MMMM', { locale: es }),
    }));

    return NextResponse.json(formattedRows, { status: 200 });

  } catch (error: unknown) {
    console.error('Error al obtener el reporte de tendencia de ingresos mensuales:', error);
    return NextResponse.json({ message: 'Error interno del servidor al generar el reporte.', error: (error instanceof Error ? error.message : 'Un error desconocido ocurrió.') }, { status: 500 });
  }
}