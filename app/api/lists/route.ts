import { pool } from '@/app/lib/db';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Tipos
type ListItem = {
  id: number;
  name: string;
};

type ListsResponse = {
  eps: ListItem[];
  arl: ListItem[];
  ccf: ListItem[];
  pensionFunds: ListItem[];
};

export async function GET(_req: NextRequest): Promise<NextResponse<ListsResponse | { message: string }>> {
  try {
    const [epsResult, arlResult, ccfResult, pensionFundResult] = await Promise.all([
      pool.query<ListItem>('SELECT id, name FROM eps_list ORDER BY name ASC'),
      pool.query<ListItem>('SELECT id, name FROM arl_list ORDER BY name ASC'),
      pool.query<ListItem>('SELECT id, name FROM ccf_list ORDER BY name ASC'),
      pool.query<ListItem>('SELECT id, name FROM pension_fund_list ORDER BY name ASC'),
    ]);

    const response: ListsResponse = {
      eps: epsResult.rows,
      arl: arlResult.rows,
      ccf: ccfResult.rows,
      pensionFunds: pensionFundResult.rows,
    };

    return NextResponse.json(response);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Error fetching lists:', error.message);
    } else {
      console.error('Unknown error fetching lists:', error);
    }

    return NextResponse.json({ message: 'Error fetching lists' }, { status: 500 });
  }
}
