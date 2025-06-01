
import { NextRequest, NextResponse } from 'next/server';
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../lib/db';

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
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const today = new Date().toISOString();

        let clientId: number;

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1. Verificar si el cliente ya existe
        const [clientRows] = await connection.execute<any[]>(
            'SELECT id FROM clients WHERE identification = ?',
            [identification]
        );

        if (clientRows.length > 0) {
            clientId = clientRows[0].id;

            // Actualizar compañía si se envía nueva
            if (companyId) {
                await connection.execute(
                    'UPDATE clients SET companies_id = ? WHERE id = ?',
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

        // 2. Guardar teléfonos (evitar duplicados)
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

        // 3. Crear afiliación mensual
        const datePaidReceived = affiliation.datePaidReceived || today;
        let govRegistryCompletedAt = affiliation.govRegistryCompletedAt || null;

        if (affiliation.paid === 'Pagado') {
            govRegistryCompletedAt = today;
        }

        const [affiliationResult] = await connection.execute<any[]>(
            `INSERT INTO monthly_affiliations (
    client_id, month, year, value,
    eps_id, arl_id, ccf_id, pension_fund_id,
    risk, observation, user_id, office_id, company_id,
    date_paid_received, gov_record_completed_at, paid_status
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ,
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
                datePaidReceived,
                govRegistryCompletedAt,
                affiliation.paid,
            ]
        );

        await connection.commit();

        const newAffiliation = affiliationResult[0]; // Puede devolver metadata, depende del driver

        return NextResponse.json({
            success: true,
            clientId,
            affiliation: {
                ...affiliation,
                month: currentMonth,
                year: currentYear,
                datePaidReceived: new Date(datePaidReceived).toISOString(),
                govRegistryCompletedAt: govRegistryCompletedAt
                    ? new Date(govRegistryCompletedAt).toISOString()
                    : null,
            },
        });
    } catch (error) {
        console.error('Error al registrar afiliación:', error);
        if (connection) await connection.rollback();
        return NextResponse.json(
            {
                success: false,
                error:
                    'Error al crear/vincular cliente, guardar teléfonos y crear afiliación',
            },
            { status: 500 }
        );
    } finally {
        if (connection) connection.release();
    }
}
