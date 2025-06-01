import { NextRequest, NextResponse } from "next/server";
import { pool } from "../../../lib/db"; // Asegúrate de que este 'pool' esté configurado para MySQL

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { affiliationId, reason, cost, processedBy, observation } = body;

        if (!affiliationId || !processedBy) {
            return NextResponse.json( // Usar NextResponse.json para consistencia
                { message: 'Faltan datos requeridos (affiliationId, processedBy)' },
                { status: 400 }
            );
        }

        // --- 1. Verifica si ya tiene una desafiliación registrada para esta afiliación específica ---
        // MySQL usa '?' como placeholder, y el resultado es un array [rows, fields]
        const checkExistingQuery = `
            SELECT 1 FROM clients_unsubscriptions WHERE affiliation_id = ?;
        `;
        const [existingRows]: any[] = await pool.query(
            checkExistingQuery,
            [affiliationId]
        );

        // Para mysql2, el número de filas se verifica con .length
        if (existingRows.length > 0) {
            return NextResponse.json( // Usar NextResponse.json para consistencia
                { message: 'Esta afiliación ya fue desafiliada previamente.' },
                { status: 409 }
            );
        }

        // --- 2. Inserta la nueva desafiliación ---
        // MySQL usa '?' como placeholder
        const insertQuery = `
            INSERT INTO clients_unsubscriptions
            (affiliation_id, reason, cost, user_id, observation)
            VALUES (?, ?, ?, ?, ?);
        `;
        await pool.query(
            insertQuery,
            [
                affiliationId,
                reason || null, // Si reason es falsy, inserta NULL
                cost || 0.00,  // Si cost es falsy, inserta 0.00 (ajusta el tipo de dato DECIMAL en tu DB si es necesario)
                processedBy,
                observation || null // Si observation es falsy, inserta NULL
            ]
        );

        console.log(`Desafiliación registrada correctamente para la afiliación ${affiliationId}: ${JSON.stringify(body)}`); // Mejor log de body
        return NextResponse.json( // Usar NextResponse.json para consistencia
            { message: 'Desafiliación registrada correctamente.' },
            { status: 201 }
        );

    } catch (error) {
        console.error('🔥 Error al registrar la desafiliación:', error);
        return NextResponse.json({ message: 'Error del servidor al registrar la desafiliación' }, { status: 500 });
    }
}

