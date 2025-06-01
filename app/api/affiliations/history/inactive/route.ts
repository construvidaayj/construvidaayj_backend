import { NextRequest, NextResponse } from 'next/server';
import type { PoolConnection } from 'mysql2/promise';
import { pool } from '../../../lib/db'; // Ajusta la ruta a tu conexión de base de datos

// Define la estructura de datos que esperas de este endpoint
// Es una extensión de DataClient con campos de desafiliación
export interface UnsubscribedAffiliationData {
    // === Campos de la Afiliación Original ===
    clientId: number;
    affiliationId: number; // ID de la tabla monthly_affiliations
    fullName: string;
    identification: string;
    companyName: string | null; // Nombre de la empresa asociada al cliente
    companyId: number; // ID de la empresa
    phones: string[]; // Array de teléfonos
    datePaidReceived: string | null; // Formato 'YYYY-MM-DD'
    govRegistryCompletedAt: string | null; // Formato 'YYYY-MM-DD'
    value: number;
    eps: string | null; // Nombre de la EPS
    arl: string | null; // Nombre de la ARL
    risk: string | null;
    ccf: string | null; // Nombre de la CCF
    pensionFund: string | null; // Nombre del Fondo de Pensión
    observation: string | null; // Observación de la afiliación original
    paid: 'Pagado' | 'Pendiente' | string; // Estado de pago de la afiliación original

    // === Campos de Desafiliación / Historial ===
    deletedAt: string | null; // Fecha en que la afiliación fue marcada como inactiva (YYYY-MM-DD)
    deletedByUserName: string | null; // Nombre del usuario que la desactivó

    // **¡NUEVO CAMPO CRUCIAL!**
    unsubscriptionRecordId: number | null; // ID del registro en clients_unsubscriptions

    unsubscriptionDate: string | null; // Fecha de la desafiliación del registro clients_unsubscriptions (YYYY-MM-DD)
    unsubscriptionReason: string | null; // Razón de la desafiliación del registro clients_unsubscriptions
    unsubscriptionCost: number | null; // Costo asociado a la desafiliación del registro clients_unsubscriptions
    unsubscriptionObservation: string | null; // Observación específica del registro clients_unsubscriptions
}


export async function GET(req: NextRequest) {
    let connection: PoolConnection | undefined;

    try {
        const { searchParams } = new URL(req.url);
        const month = searchParams.get('month');
        const year = searchParams.get('year');
        const officeIdParam = searchParams.get('officeId'); // ¡Nuevo parámetro!
        const userIdParam = searchParams.get('userId');     // ¡Nuevo parámetro!

        // --- Validaciones de parámetros obligatorios ---
        if (!officeIdParam) {
            return NextResponse.json({ success: false, error: 'The "officeId" parameter is required.' }, { status: 400 });
        }
        if (!userIdParam) {
            return NextResponse.json({ success: false, error: 'The "userId" parameter is required.' }, { status: 400 });
        }

        const officeId = parseInt(officeIdParam, 10);
        const userId = parseInt(userIdParam, 10);

        if (isNaN(officeId)) {
            return NextResponse.json({ success: false, error: 'Invalid "officeId" parameter. Must be a number.' }, { status: 400 });
        }
        if (isNaN(userId)) {
            return NextResponse.json({ success: false, error: 'Invalid "userId" parameter. Must be a number.' }, { status: 400 });
        }
        // --- Fin de validaciones ---

        connection = await pool.getConnection();

        let query = `
            SELECT
                ma.id AS affiliationId,
                ma.client_id AS clientId,
                c.full_name AS fullName,
                c.identification,
                comp.name AS companyName,
                c.company_id AS companyId,
                GROUP_CONCAT(DISTINCT cp.phone_number SEPARATOR ',') AS phones,
                ma.date_paid_received AS datePaidReceived,
                ma.gov_record_completed_at AS govRegistryCompletedAt,
                ma.value,
                eps.name AS eps,
                arl.name AS arl,
                ma.risk,
                ccf.name AS ccf,
                pf.name AS pensionFund,
                ma.observation,
                ma.paid_status AS paid,
                ma.deleted_at AS deletedAt,
                u.username AS deletedByUserName,
                cu.id AS unsubscriptionRecordId,
                cu.unsubscription_date AS unsubscriptionDate,
                cu.reason AS unsubscriptionReason,
                cu.cost AS unsubscriptionCost,
                cu.observation AS unsubscriptionObservation
            FROM
                monthly_affiliations ma
            INNER JOIN
                clients c ON ma.client_id = c.id
            LEFT JOIN
                companies comp ON ma.company_id = comp.id
            LEFT JOIN
                eps_list eps ON ma.eps_id = eps.id
            LEFT JOIN
                arl_list arl ON ma.arl_id = arl.id
            LEFT JOIN
                ccf_list ccf ON ma.ccf_id = ccf.id
            LEFT JOIN
                pension_fund_list pf ON ma.pension_fund_id = pf.id
            LEFT JOIN
                users u ON ma.deleted_by_user_id = u.id
            LEFT JOIN
                clients_unsubscriptions cu ON ma.id = cu.affiliation_id
            LEFT JOIN
                client_phones cp ON c.id = cp.client_id
            WHERE
                ma.is_active = FALSE
                AND ma.office_id = ? -- ¡Filtrado por officeId!
                AND ma.user_id = ?   -- ¡Filtrado por userId!
        `;

        const queryParams: (string | number)[] = [officeId, userId]; // Agrega officeId y userId aquí

        const conditions: string[] = [];

        if (month) {
            conditions.push('ma.month = ?');
            queryParams.push(parseInt(month as string, 10)); // Asegura parseo a base 10
        }
        if (year) {
            conditions.push('ma.year = ?');
            queryParams.push(parseInt(year as string, 10)); // Asegura parseo a base 10
        }

        if (conditions.length > 0) {
            query += ' AND ' + conditions.join(' AND ');
        }

        query += `
            GROUP BY
                ma.id, c.id, comp.id, eps.id, arl.id, ccf.id, pf.id, u.id, cu.id
            ORDER BY
                ma.deleted_at DESC, ma.created_at DESC;
        `;

        const [rows] = await connection.execute<any[]>(query, queryParams);

        const formattedRows: UnsubscribedAffiliationData[] = rows.map((row: any) => ({
            ...row,
            phones: row.phones ? row.phones.split(',') : [],
            datePaidReceived: row.datePaidReceived ? new Date(row.datePaidReceived).toISOString().split('T')[0] : null,
            govRegistryCompletedAt: row.govRegistryCompletedAt ? new Date(row.govRegistryCompletedAt).toISOString().split('T')[0] : null,
            deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString().split('T')[0] : null,
            unsubscriptionDate: row.unsubscriptionDate ? new Date(row.unsubscriptionDate).toISOString().split('T')[0] : null,
            unsubscriptionRecordId: row.unsubscriptionRecordId !== null ? Number(row.unsubscriptionRecordId) : null,
        }));

        if (formattedRows.length === 0) {
            return NextResponse.json({
                success: false,
                message: "No hay afiliaciones inactivas para los criterios seleccionados."
            }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            data: formattedRows,
        }, { status: 200 });

    } catch (error) {
        console.error('Error al obtener afiliaciones inactivas:', error);
        if (connection) await connection.rollback(); // Rollback en caso de error
        return NextResponse.json(
            {
                success: false,
                error: 'Error interno del servidor al obtener afiliaciones inactivas.',
                details: (error as Error).message || 'Error desconocido'
            },
            { status: 500 }
        );
    } finally {
        if (connection) connection.release(); // Siempre liberar la conexión
    }
}