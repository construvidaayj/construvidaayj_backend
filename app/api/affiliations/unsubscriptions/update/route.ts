import { NextRequest, NextResponse } from 'next/server';
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../../../lib/db'; // Ajusta la ruta a tu conexión de base de datos

interface UpdateUnsubscriptionPayload {
    unsubscriptionId: number;
    reason?: string;
    cost?: number;
    observation?: string;
    // user_id que realiza la actualización (opcional, para auditoría)
    updatedByUserId?: number;
}

export async function PUT(req: NextRequest) {
    let connection: PoolConnection | undefined;

    try {
        const body: UpdateUnsubscriptionPayload = await req.json();
        const { unsubscriptionId, reason, cost, observation, updatedByUserId } = body;

        if (!unsubscriptionId) {
            return NextResponse.json(
                { success: false, error: 'El ID de la desafiliación es requerido.' },
                { status: 400 }
            );
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Construir dinámicamente la consulta de actualización
        const updateFields: string[] = [];
        const updateValues: (string | number | null)[] = [];

        if (reason !== undefined) {
            updateFields.push('reason = ?');
            updateValues.push(reason);
        }
        if (cost !== undefined) {
            updateFields.push('cost = ?');
            updateValues.push(cost);
        }
        if (observation !== undefined) {
            updateFields.push('observation = ?');
            updateValues.push(observation);
        }

        // Siempre actualizar updated_at
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        // Si tienes una columna para el usuario que actualiza, puedes añadirla aquí
        // if (updatedByUserId !== undefined) {
        //     updateFields.push('user_id = ?'); // Si user_id en clients_unsubscriptions es para el ultimo que modifico
        //     updateValues.push(updatedByUserId);
        // }

        if (updateFields.length === 0) {
            await connection.rollback(); // No hay nada que actualizar
            return NextResponse.json(
                { success: false, error: 'No se proporcionaron campos para actualizar.' },
                { status: 400 }
            );
        }

        const query = `
            UPDATE clients_unsubscriptions
            SET ${updateFields.join(', ')}
            WHERE id = ?
        `;
        updateValues.push(unsubscriptionId); // Añadir el ID al final de los valores

        const [result] = await connection.execute<ResultSetHeader>(query, updateValues);

        if (result.affectedRows === 0) {
            await connection.rollback();
            return NextResponse.json(
                { success: false, error: 'Desafiliación no encontrada o no se realizaron cambios.' },
                { status: 404 }
            );
        }

        await connection.commit();

        return NextResponse.json(
            {
                success: true,
                message: 'Detalles de desafiliación actualizados exitosamente.',
                unsubscriptionId: unsubscriptionId
            },
            { status: 200 }
        );

    } catch (error) {
        console.error('Error al actualizar detalles de desafiliación:', error);
        if (connection) await connection.rollback();
        return NextResponse.json(
            {
                success: false,
                error: 'Error interno del servidor al actualizar detalles de desafiliación.',
                details: (error as Error).message || 'Error desconocido'
            },
            { status: 500 }
        );
    } finally {
        if (connection) connection.release();
    }
}