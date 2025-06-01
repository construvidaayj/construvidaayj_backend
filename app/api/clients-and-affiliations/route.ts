import { NextRequest, NextResponse } from 'next/server';
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../lib/db'; // Asegúrate de que esta ruta sea correcta

interface AffiliationPayload {
    value: number;
    epsId?: number;
    arlId?: number;
    ccfId?: number;
    pensionFundId?: number;
    risk?: string;
    observation?: string;
    datePaidReceived?: string;
    govRegistryCompletedAt?: string;
    paid: 'Pagado' | 'Pendiente' | string;
}

export async function POST(req: NextRequest) {
    let connection: PoolConnection | undefined;

    try {
        const body = await req.json();
        const {
            fullName,
            identification,
            officeId,
            affiliation,
            userId,
            companyId,
            phones,
        }: {
            fullName: string;
            identification: string;
            officeId: number;
            affiliation: AffiliationPayload;
            userId: number;
            companyId: number;
            phones: string[];
        } = body;

        const now = new Date();
        const currentMonth = now.getMonth() + 1; // getMonth() es 0-index, por eso +1
        const currentYear = now.getFullYear();
        // today se usa para valores por defecto de TIMESTAMP, formateamos a 'YYYY-MM-DD HH:MM:SS'
        const currentTimestampFormatted = new Date().toISOString().slice(0, 19).replace('T', ' ');

        let clientId: number;

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Verificar si el cliente ya existe
        const [clientRows] = await connection.execute<any[]>(
            'SELECT id, company_id FROM clients WHERE identification = ?', // También selecciona company_id para la comparación
            [identification]
        );

        if (clientRows.length > 0) {
            clientId = clientRows[0].id;
            const existingCompanyId = clientRows[0].company_id;

            // Actualizar compañía si se envía nueva y es diferente de la actual
            if (companyId && existingCompanyId !== companyId) {
                await connection.execute(
                    'UPDATE clients SET company_id = ? WHERE id = ?',
                    [companyId, clientId]
                );
            }
        } else {
            // Crear nuevo cliente
            const [clientResult] = await connection.execute<ResultSetHeader>(
                `INSERT INTO clients (full_name, identification, company_id)
                VALUES (?, ?, ?)`,
                [fullName, identification, companyId]
            );
            clientId = clientResult.insertId;
        }

        // 2. Guardar teléfonos (INSERT IGNORE evita duplicados a nivel de BD para client_phones)
        if (Array.isArray(phones)) {
            for (const phone of phones) {
                if (phone.trim() !== '') {
                    await connection.execute(
                        `INSERT IGNORE INTO client_phones (client_id, phone_number) VALUES (?, ?)`,
                        [clientId, phone]
                    );
                }
            }
        }

        // **3. VERIFICAR DUPLICADOS ACTIVOS A NIVEL DE LÓGICA DE NEGOCIO (¡Nueva lógica aquí!)**
        const [existingActiveAffiliations] = await connection.execute<any[]>(
            `SELECT id FROM monthly_affiliations
             WHERE client_id = ?
               AND month = ?
               AND year = ?
               AND office_id = ?
               AND user_id = ?
               AND is_active = TRUE`, // Solo buscar las activas
            [clientId, currentMonth, currentYear, officeId, userId]
        );

        if (existingActiveAffiliations.length > 0) {
            // Si se encuentra una afiliación activa para el mismo mes, año, oficina y usuario
            await connection.rollback(); // Deshacer cualquier cambio anterior en la transacción (ej. creación de cliente, teléfonos)
            return NextResponse.json(
                {
                    success: false,
                    error: 'Ya existe una afiliación activa para este cliente en el mes y año actual. Por favor, desactive la afiliación existente antes de crear una nueva.'
                },
                { status: 409 } // Conflict
            );
        }

        // 4. Si no hay duplicados activos, proceder a crear la nueva afiliación
        const datePaidReceivedFormatted = affiliation.datePaidReceived
            ? new Date(affiliation.datePaidReceived).toISOString().slice(0, 19).replace('T', ' ')
            : currentTimestampFormatted;

        let govRegistryCompletedAtFormatted: string | null = null;
        if (affiliation.paid === 'Pagado') {
            govRegistryCompletedAtFormatted = currentTimestampFormatted;
        } else if (affiliation.govRegistryCompletedAt) {
            govRegistryCompletedAtFormatted = new Date(affiliation.govRegistryCompletedAt).toISOString().slice(0, 19).replace('T', ' ');
        }


        const [affiliationResult] = await connection.execute<ResultSetHeader>(
            `INSERT INTO monthly_affiliations (
                client_id, month, year, value,
                eps_id, arl_id, ccf_id, pension_fund_id,
                risk, observation, user_id, office_id, company_id,
                date_paid_received, gov_record_completed_at, paid_status, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`, // is_active es TRUE para la nueva afiliación
            [
                clientId,
                currentMonth,
                currentYear,
                affiliation.value,
                affiliation.epsId || null,
                affiliation.arlId || null,
                affiliation.ccfId || null,
                affiliation.pensionFundId || null,
                affiliation.risk || null,
                affiliation.observation || null,
                userId,
                officeId,
                companyId,
                datePaidReceivedFormatted,
                govRegistryCompletedAtFormatted,
                affiliation.paid,
            ]
        );

        await connection.commit();

        return NextResponse.json({
            success: true,
            message: 'Afiliación creada exitosamente.',
            clientId: clientId,
            affiliationId: affiliationResult.insertId,
        }, { status: 201 });

    } catch (error: any) {
        console.error('Error al registrar afiliación:', error);
        if (connection) await connection.rollback(); // Asegura el rollback en cualquier otro error

        return NextResponse.json(
            {
                success: false,
                error: 'Error interno del servidor al crear la afiliación.',
                details: error.message || 'Error desconocido'
            },
            { status: 500 }
        );
    } finally {
        if (connection) connection.release();
    }
}