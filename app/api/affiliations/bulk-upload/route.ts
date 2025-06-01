// app/api/affiliations/bulk-upload/route.ts

import { NextRequest, NextResponse } from 'next/server';
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../../lib/db'; // Ajusta la ruta si es necesario

import { parse } from 'csv-parse';
// No necesitamos IncomingForm de 'formidable' ya que usamos req.formData()
import { promises as fs } from 'fs'; // fs se mantiene por si hay manejo de archivos temporales que no borramos

export const config = {
    api: {
        bodyParser: false, // Esto sigue siendo crucial para que Next.js no lea el cuerpo
    },
};

// Interfaces (mantener las mismas que ya tienes)
interface AffiliationRow {
    NOMBRE: string;
    CEDULA: string;
    EMPRESA: string;
    TELEFONO?: string;
    'PAGO RECIBIDO'?: string;
    'Fecha Afiliacion (Plataformas Gob)'?: string;
    VALOR: string | number; // Puede venir como string del CSV, luego se parsea
    EPS?: string;
    ARL?: string;
    RIESGO?: string;
    CCF?: string;
    'F. PENSION'?: string;
    NOVEDAD?: string;
}

interface ProcessedResult {
    totalRows: number;
    importedRows: number;
    errors: { row: number; data: AffiliationRow; error: string; }[];
}

// Función para obtener los IDs de catálogo (sin cambios)
async function getCatalogMap(connection: PoolConnection, tableName: string, nameColumn: string): Promise<Record<string, number>> {
    const [rows] = await connection.execute<any[]>(`SELECT id, ${nameColumn} FROM ${tableName}`);
    const map: Record<string, number> = {};
    rows.forEach(row => {
        if (row[nameColumn]) {
            map[String(row[nameColumn]).toLowerCase()] = row.id;
        }
    });
    return map;
}

export async function POST(req: NextRequest) {
    let connection: PoolConnection | null = null;

    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ success: false, error: 'No se ha subido ningún archivo.' }, { status: 400 });
        }

        const fileContent = await file.text(); // Lee el contenido como texto

        // --- CONEXIÓN A LA BASE DE DATOS Y TRANSACCIÓN ---
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // --- PRECARGAR CATÁLOGOS ---
        console.log('Precargando catálogos...');
        const companyMap = await getCatalogMap(connection, 'companies', 'name');
        const epsMap = await getCatalogMap(connection, 'eps_list', 'name');
        const arlMap = await getCatalogMap(connection, 'arl_list', 'name');
        const ccfMap = await getCatalogMap(connection, 'ccf_list', 'name');
        const pensionFundMap = await getCatalogMap(connection, 'pension_fund_list', 'name');
        console.log('Catálogos precargados.');

        // Constantes para la inserción
        const FIXED_USER_ID = 3; // O el ID del usuario logueado
        const FIXED_OFFICE_ID = 1; // O el ID de la oficina del usuario logueado
        const now = new Date();
        const currentMonth = now.getMonth() + 1; // getMonth() es 0-index
        const currentYear = now.getFullYear();

        const processedResults: ProcessedResult = {
            totalRows: 0,
            importedRows: 0,
            errors: []
        };

        // --- CAMBIO CLAVE: Delimitador forzado a punto y coma ';' ---
        const delimiter = ';';

        const records: AffiliationRow[] = await new Promise((resolve, reject) => {
            parse(fileContent, {
                delimiter: delimiter,
                columns: true, // Asume que la primera fila es el encabezado
                skip_empty_lines: true,
                trim: true,
                cast: (value, context) => {
                    if (context.column === 'VALOR') {
                        // Limpia el valor antes de parsear a float (ej. "110.000" -> 110000.00)
                        if (value === null || value === undefined || String(value).trim() === '') return null;
                        try {
                            // Reemplaza puntos por nada y comas por puntos para parseFloat
                            return parseFloat(String(value).replace(/\./g, '').replace(/,/g, '.'));
                        } catch (e) {
                            console.warn(`Advertencia: No se pudo parsear el valor '${value}' en la columna VALOR.`);
                            return null;
                        }
                    }
                    return value === '' ? null : value; // Convierte cadenas vacías a null
                }
            }, (err, records) => {
                if (err) {
                    console.error("Error al parsear CSV:", err);
                    reject(err);
                }
                resolve(records as AffiliationRow[]); // Asegura el tipo de records
            });
        });

        processedResults.totalRows = records.length;

        for (const [index, row] of records.entries()) {
            const rowNumber = index + 1;
            try {
                // Validación básica de campos requeridos
                if (!row.NOMBRE || !row.CEDULA || !row.EMPRESA || row.VALOR === undefined || row.VALOR === null) {
                    throw new Error('Campos NOMBRE, CEDULA, EMPRESA o VALOR faltantes/vacíos.');
                }

                const fullName = row.NOMBRE;
                const identification = String(row.CEDULA).trim();
                const companyName = row.EMPRESA;
                const phone = row.TELEFONO;
                const value = parseFloat(row.VALOR as any); // Ya viene limpio por el cast de csv-parse

                const epsName = row.EPS;
                const arlName = row.ARL;
                const risk = row.RIESGO;
                const ccfName = row.CCF;
                const pensionFundName = row['F. PENSION'];
                const observation = row.NOVEDAD;
                const datePaidReceivedExcel = row['PAGO RECIBIDO'];
                const govRegistryCompletedAtExcel = row['Fecha Afiliacion (Plataformas Gob)'];

                // Búsqueda de IDs de catálogos
                const companyId = companyMap[companyName.toLowerCase()];
                if (!companyId) {
                    throw new Error(`Empresa '${companyName}' no encontrada en el catálogo.`);
                }
                const epsId = epsName ? epsMap[epsName.toLowerCase()] : null;
                const arlId = arlName ? arlMap[arlName.toLowerCase()] : null;
                const ccfId = ccfName ? ccfMap[ccfName.toLowerCase()] : null;
                const pensionFundId = pensionFundName ? pensionFundMap[pensionFundName.toLowerCase()] : null;

                // --- MANEJO Y CONVERSIÓN DE FECHAS A ISOString (para consistencia con el endpoint 1 a 1) ---
                let datePaidReceived: string | null = null;
                if (datePaidReceivedExcel && String(datePaidReceivedExcel).trim() !== '') {
                    const parts = String(datePaidReceivedExcel).trim().split('/');
                    if (parts.length === 3) {
                        // Se asume DD/MM/YYYY del CSV. Crea una fecha en la zona horaria local.
                        const dateObj = new Date(
                            parseInt(parts[2]),        // Year
                            parseInt(parts[1]) - 1,    // Month (0-indexed)
                            parseInt(parts[0])         // Day
                        );
                        // Convertir a ISOString para insertar en la DB (ej. "2025-05-30T05:00:00.000Z")
                        datePaidReceived = dateObj.toISOString();
                    } else {
                        console.warn(`Advertencia en fila ${rowNumber}: Formato de fecha inesperado para 'PAGO RECIBIDO': ${datePaidReceivedExcel}. Se insertará como NULL.`);
                    }
                }

                let govRecordCompletedAt: string | null = null;
                if (govRegistryCompletedAtExcel && String(govRegistryCompletedAtExcel).trim() !== '') {
                    const parts = String(govRegistryCompletedAtExcel).trim().split('/');
                    if (parts.length === 3) {
                        const dateObj = new Date(
                            parseInt(parts[2]),
                            parseInt(parts[1]) - 1,
                            parseInt(parts[0])
                        );
                        govRecordCompletedAt = dateObj.toISOString();
                    } else {
                        console.warn(`Advertencia en fila ${rowNumber}: Formato de fecha inesperado para 'Fecha Afiliacion (Plataformas Gob)': ${govRegistryCompletedAtExcel}. Se insertará como NULL.`);
                    }
                }
                // --- FIN MANEJO Y CONVERSIÓN DE FECHAS ---

                let paidStatus: string = 'Pendiente';
                if (datePaidReceived) { // Si hay fecha de pago, el estado es 'Pagado'
                    paidStatus = 'Pagado';
                    // Si no se proporcionó fecha de registro de gobierno, usa la de pago
                    if (!govRecordCompletedAt) {
                         govRecordCompletedAt = datePaidReceived;
                    }
                }

                // --- CLIENTE: Búsqueda o Creación ---
                let clientId: number;
                const [clientRows] = await connection.execute<any[]>(
                    'SELECT id, company_id FROM clients WHERE identification = ?',
                    [identification]
                );

                if (clientRows.length > 0) {
                    clientId = clientRows[0].id;
                    // Solo actualiza si la compañía del cliente es diferente o se envía una nueva
                    if (clientRows[0].company_id !== companyId) {
                        await connection.execute(
                            'UPDATE clients SET company_id = ?, full_name = ? WHERE id = ?',
                            [companyId, fullName, clientId] // También actualiza el nombre por si ha cambiado
                        );
                    } else if (clientRows[0].full_name !== fullName) { // Actualiza solo el nombre si la compañía es la misma
                         await connection.execute(
                            'UPDATE clients SET full_name = ? WHERE id = ?',
                            [fullName, clientId]
                        );
                    }
                } else {
                    const [clientResult] = await connection.execute<ResultSetHeader>(
                        `INSERT INTO clients (full_name, identification, company_id) VALUES (?, ?, ?)`,
                        [fullName, identification, companyId]
                    );
                    clientId = clientResult.insertId;
                }

                // --- TELÉFONOS (si existe la columna y hay valor) ---
                if (phone && String(phone).trim() !== '') {
                    await connection.execute(
                        `INSERT IGNORE INTO client_phones (client_id, phone_number) VALUES (?, ?)`,
                        [clientId, String(phone).trim()]
                    );
                }

                // --- INSERCIÓN DE AFILIACIÓN MENSUAL ---
                const insertAffiliationSql = `
                    INSERT INTO monthly_affiliations (
                        client_id, month, year, value,
                        eps_id, arl_id, ccf_id, pension_fund_id,
                        risk, observation, user_id, office_id, company_id,
                        date_paid_received, gov_record_completed_at, paid_status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        value = VALUES(value),
                        eps_id = VALUES(eps_id),
                        arl_id = VALUES(arl_id),
                        ccf_id = VALUES(ccf_id),
                        pension_fund_id = VALUES(pension_fund_id),
                        risk = VALUES(risk),
                        observation = VALUES(observation),
                        date_paid_received = VALUES(date_paid_received),
                        gov_record_completed_at = VALUES(gov_record_completed_at),
                        paid_status = VALUES(paid_status),
                        updated_at = CURRENT_TIMESTAMP;
                `;
                // NOTA: Se añadió 'ON DUPLICATE KEY UPDATE' para manejar el UNIQUE(client_id, month, year, office_id, user_id)
                // Si una afiliación para el mismo cliente, mes, año, oficina y usuario ya existe, la actualiza en lugar de fallar.

                await connection.execute(insertAffiliationSql, [
                    clientId,
                    currentMonth,
                    currentYear,
                    value,
                    epsId,
                    arlId,
                    ccfId,
                    pensionFundId,
                    risk || null,
                    observation || null,
                    FIXED_USER_ID,
                    FIXED_OFFICE_ID,
                    companyId,
                    datePaidReceived,          // YA ESTÁ EN ISOString
                    govRecordCompletedAt,      // YA ESTÁ EN ISOString
                    paidStatus,
                ]);

                processedResults.importedRows++;

            } catch (rowError: any) {
                processedResults.errors.push({
                    row: rowNumber,
                    data: row,
                    error: rowError.message || 'Error desconocido'
                });
                console.error(`Error en la fila ${rowNumber}:`, rowError.message);
            }
        }

        await connection.commit();

        // Si tienes un endpoint para listar afiliaciones en '/dashboard/affiliations', invalídalo
        // import { revalidatePath } from 'next/cache'; // Asegúrate de importar esto arriba si lo usas
        // revalidatePath('/dashboard/affiliations'); // Ejemplo: Ruta del listado de afiliaciones

        return NextResponse.json({
            success: true,
            message: `Proceso de importación completado. ${processedResults.importedRows} de ${processedResults.totalRows} filas importadas.`,
            results: processedResults
        }, { status: 200 });

    } catch (error: any) {
        console.error('Error en el endpoint de carga masiva:', error);
        if (connection) {
            await connection.rollback();
            console.log('Transacción revertida debido a un error.');
        }
        return NextResponse.json(
            { success: false, error: 'Error interno del servidor al procesar la carga masiva', details: error.message || 'Error desconocido' },
            { status: 500 }
        );
    } finally {
        if (connection) {
            connection.release();
        }
    }
}