import { pool } from '../lib/db';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { RowDataPacket } from 'mysql2/promise'; // Importar el tipo RowDataPacket

// Tipos
// Extender RowDataPacket para asegurar compatibilidad con los resultados de la BD
interface ListItem extends RowDataPacket {
  id: number;
  name: string;
}

type ListsResponse = {
  eps: ListItem[];
  arl: ListItem[];
  ccf: ListItem[];
  pensionFunds: ListItem[];
  companies: ListItem[];
};

export async function GET(_req: NextRequest): Promise<NextResponse<ListsResponse | { message: string }>> {
  try {
   
    const [
      [epsRows],
      [arlRows],
      [ccfRows],
      [pensionFundRows],
      [companiesRows]
    ] = await Promise.all([
      pool.query<ListItem[]>('SELECT id, name FROM eps_list ORDER BY name ASC'),
      pool.query<ListItem[]>('SELECT id, name FROM arl_list ORDER BY name ASC'),
      pool.query<ListItem[]>('SELECT id, name FROM ccf_list ORDER BY name ASC'),
      pool.query<ListItem[]>('SELECT id, name FROM pension_fund_list ORDER BY name ASC'),
      pool.query<ListItem[]>('SELECT id, name FROM companies ORDER BY name ASC'),
    ]);

    const response: ListsResponse = {
      eps: epsRows,
      arl: arlRows,
      ccf: ccfRows,
      pensionFunds: pensionFundRows,
      companies: companiesRows,
    };

    return NextResponse.json(response);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('🔥 Error fetching lists:', error.message);
    } else {
      console.error('🔥 Unknown error fetching lists:', error);
    }

    return NextResponse.json({ message: 'Error fetching lists' }, { status: 500 });
  }
}