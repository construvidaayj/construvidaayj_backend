import { pool } from "@/app/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { affiliationId, reason, cost, processedBy, observation } = body;

        if (!affiliationId || !processedBy) {
            return new NextResponse(
                JSON.stringify({ message: 'Faltan datos requeridos (affiliationId, processedBy)' }),
                { status: 400 }
            );
        }

        // Verifica si ya tiene una desafiliación registrada para esta afiliación específica
        const existing = await pool.query(
            'SELECT 1 FROM clients_unsubscriptions WHERE affiliation_id = $1',
            [affiliationId]
        );

        if (existing.rowCount !== null && existing.rowCount > 0) {
            return new NextResponse(
                JSON.stringify({ message: 'Esta afiliación ya fue desafiliada previamente.' }),
                { status: 409 }
            );
        }

        await pool.query(
            `
            INSERT INTO clients_unsubscriptions
            (affiliation_id, reason, cost, user_id, observation)
            VALUES ($1, $2, $3, $4, $5)
        `,
            [affiliationId, reason || null, cost || 0, processedBy, observation || null]
        );
        console.log(`Desafiliación registrada correctamente para la afiliación ${affiliationId}: ${body}`);
        return new NextResponse(
            JSON.stringify({ message: 'Desafiliación registrada correctamente.' }),
            { status: 201 }
        );

    } catch (error) {
        console.error('Error al registrar la desafiliación:', error);
        return new NextResponse(JSON.stringify({ message: 'Error del servidor' }), { status: 500 });
    }
}