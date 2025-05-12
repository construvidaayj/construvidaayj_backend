import { pool } from "@/app/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { clientId, reason, cost, processedBy, observation } = body;

        if (!clientId || !processedBy) {
            return new NextResponse(
                JSON.stringify({ message: 'Faltan datos requeridos (clientId, processedBy)' }),
                { status: 400 }
            );
        }

        // Verifica si ya tiene una desafiliación registrada
        const existing = await pool.query(
            'SELECT 1 FROM client_unsubscriptions WHERE client_id = $1',
            [clientId]
        );

        if (existing.rowCount !== null && existing.rowCount > 0) {
            return new NextResponse(
                JSON.stringify({ message: 'Este cliente ya fue desafiliado previamente.' }),
                { status: 409 }
            );
        }

        await pool.query(
            `
        INSERT INTO client_unsubscriptions
          (client_id, reason, cost, processed_by, observation)
        VALUES ($1, $2, $3, $4, $5)
      `,
            [clientId, reason || null, cost || 0, processedBy, observation || null]
        );

        return new NextResponse(
            JSON.stringify({ message: 'Desafiliación registrada correctamente.' }),
            { status: 201 }
        );

    } catch (error) {
        console.error('Error al registrar la desafiliación:', error);
        return new NextResponse(JSON.stringify({ message: 'Error del servidor' }), { status: 500 });
    }
}