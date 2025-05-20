import { pool } from '@/app/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
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
        } = body;

        console.log(`
            NOMBRE: ${fullName},
            IDENTIFICACION: ${identification},
            ID OFICINA: ${officeId},
            AFILIACION: ${affiliation},
            ID USUARIO: ${userId},
            ID EMPRESA: ${companyId},
            TELEFONOS: ${phones}
        `);

        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();
        const today = now; // Obtiene la fecha y hora actual como objeto Date

        let clientId: number;

        // 1. Buscar cliente por identificación
        const existingClientResult = await pool.query(
            'SELECT id FROM clients WHERE identification = $1',
            [identification]
        );

        if (existingClientResult.rows.length > 0) {
            // Cliente ya existe, usar su ID
            clientId = existingClientResult.rows[0].id;
            console.log(`Cliente con identificación ${identification} ya existe. Usando clientId: ${clientId}`);

            // Actualizar la compañía del cliente si se proporciona un nuevo companyId
            if (companyId) {
                await pool.query(
                    'UPDATE clients SET companies_id = $1 WHERE id = $2',
                    [companyId, clientId]
                );
                console.log(`Se actualizó la compañía del cliente ${clientId} al id ${companyId}`);
            }
        } else {
            // Cliente no existe, crear uno nuevo
            const newClientResult = await pool.query(
                `INSERT INTO clients (full_name, identification, companies_id)
                VALUES ($1, $2, $3)
                RETURNING id`,
                [fullName, identification, companyId]
            );
            clientId = newClientResult.rows[0].id;
            console.log(`Nuevo cliente creado con clientId: ${clientId}`);
        }

        // 2. Guardar los números de teléfono del cliente
        if (phones && Array.isArray(phones) && phones.length > 0) {
            for (const phone of phones) {
                if (phone) { // Evitar guardar cadenas vacías
                    await pool.query(
                        'INSERT INTO client_phones (client_id, phone_number) VALUES ($1, $2) ON CONFLICT (client_id, phone_number) DO NOTHING',
                        [clientId, phone]
                    );
                    console.log(`Teléfono ${phone} guardado para el cliente ${clientId}`);
                }
            }
        }

        // 3. Crear la afiliación para el cliente (existente o nuevo)
        const datePaidReceived = affiliation.datePaidReceived || today; // Usa la fecha y hora actual si no se proporciona
        let govRegistryCompletedAt = affiliation.govRegistryCompletedAt || null; // Inicializa con el valor del frontend o null
        const paid = affiliation.paid; // Recibe el estado de pago del body

        // Si el pago está marcado como "Pagado", establece govRegistryCompletedAt a la fecha actual
        if (paid === 'Pagado') {
            govRegistryCompletedAt = today;
        }

        const affiliationResult = await pool.query( // Cambiado a affiliationResult
            `INSERT INTO monthly_affiliations (
                client_id, month, year, value,
                eps_id, arl_id, ccf_id, pension_fund_id,
                risk, observation, user_id, office_id, companies_id,
                date_paid_received, gov_registry_completed_at, paid
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8,
                $9, $10, $11, $12, $13,
                $14, $15, $16
            )
            RETURNING *`, // Devuelve todas las columnas de la inserción
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
                paid, // Pasa el estado de pago a la consulta
            ]
        );

        // 4. Construir la respuesta incluyendo los datos de la afiliación creada.
        const newAffiliation = affiliationResult.rows[0];  // Accedemos a la primera fila del resultado
        const formattedDatePaidReceived = newAffiliation.date_paid_received
            ? new Date(newAffiliation.date_paid_received).toISOString()
            : null;
        const formattedGovRegistryCompletedAt = newAffiliation.gov_registry_completed_at
            ? new Date(newAffiliation.gov_registry_completed_at).toISOString()
            : null;

        const responseData = {
            success: true,
            clientId,
            affiliation: { // Incluimos los datos de la nueva afiliación
                id: newAffiliation.id,
                month: newAffiliation.month,
                year: newAffiliation.year,
                value: newAffiliation.value,
                epsId: newAffiliation.eps_id,
                arlId: newAffiliation.arl_id,
                ccfId: newAffiliation.ccf_id,
                pensionFundId: newAffiliation.pension_fund_id,
                risk: newAffiliation.risk,
                observation: newAffiliation.observation,
                userId: newAffiliation.user_id,
                officeId: newAffiliation.office_id,
                companiesId: newAffiliation.companies_id,
                paid: newAffiliation.paid,
                datePaidReceived: formattedDatePaidReceived,
                govRegistryCompletedAt: formattedGovRegistryCompletedAt,
            },
        };

        return NextResponse.json(responseData);

    } catch (error) {
        console.error('Error en POST /api/clients-and-affiliations:', error);
        return NextResponse.json({ success: false, error: 'Error al crear/vincular cliente, guardar teléfonos y crear afiliación' }, { status: 500 });
    }
}